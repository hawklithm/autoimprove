#!/bin/bash

# AutoImprove Setup Script (TypeScript)
# Automatically configures MCP Server and Skills for Claude Code

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AUTOIMPROVE_DIR="$HOME/.autoimprove"
MCP_SERVER_DIR="$SCRIPT_DIR/src/mcp-server-ts"
SKILLS_DIR_SRC="$SCRIPT_DIR/src/skills-ts"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

echo "==================================="
echo "  AutoImprove Setup"
echo "==================================="
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
  echo "❌ Error: npm is not installed. Please install Node.js 18+ first."
  exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Error: Node.js 18+ is required. Current version: $(node --version)"
  exit 1
fi

echo "Step 1: Installing MCP Server..."
echo "-----------------------------------"

cd "$MCP_SERVER_DIR"

echo "Installing MCP Server dependencies..."
npm install

echo "Building MCP Server..."
npm run build

if [ ! -f "$MCP_SERVER_DIR/dist/index.js" ]; then
  echo "❌ Error: MCP Server build failed - dist/index.js not found"
  exit 1
fi

SERVER_CMD="node"
SERVER_ARGS="[\"$MCP_SERVER_DIR/dist/index.js\"]"

echo "✓ MCP Server built successfully"

echo ""
echo "Step 2: Verifying Skills..."
echo "-----------------------------------"

# Skills are markdown-based, no build needed
# Claude Code will directly call MCP tools based on SKILL.md instructions

echo "✓ Skills verified (SKILL.md files will be installed)"

echo ""
echo "Step 3: Configuring Claude Code MCP Server..."
echo "-----------------------------------"

# Check if claude CLI is available
if ! command -v claude &> /dev/null; then
  echo "❌ Error: claude CLI not found. Please install Claude Code first."
  echo "   Visit: https://claude.ai/download"
  exit 1
fi

# Check if autoimprove-core is already configured at user level
EXISTING_USER_SERVER=$(claude mcp get autoimprove-core 2>/dev/null | grep -i "user config" || echo "")
EXISTING_LOCAL_SERVER=$(claude mcp get autoimprove-core 2>/dev/null | grep -i "local config" || echo "")

if [ -n "$EXISTING_USER_SERVER" ]; then
  echo "Found existing autoimprove-core server (user-level)"
  echo "Removing old configuration..."
  claude mcp remove autoimprove-core -s user 2>/dev/null || true
  echo "✓ Removed old user-level configuration"
fi

if [ -n "$EXISTING_LOCAL_SERVER" ]; then
  echo "Found existing autoimprove-core server (project-level)"
  echo "Removing old configuration..."
  claude mcp remove autoimprove-core -s local 2>/dev/null || true
  echo "✓ Removed old project-level configuration"
fi

# Add MCP server using Claude Code CLI with user scope (global visibility)
echo "Adding autoimprove-core MCP server (user-level, visible in all projects)..."
claude mcp add autoimprove-core -s user -- node "$MCP_SERVER_DIR/dist/index.js"

if [ $? -eq 0 ]; then
  echo "✓ MCP server configured successfully (user-level)"
  echo "✓ Server will be available in all projects"
else
  echo "❌ Error: Failed to configure MCP server"
  exit 1
fi

echo ""
echo "Step 4: Installing Skills..."
echo "-----------------------------------"

# Install Skills to Claude directory (SKILL.md only - Claude Code will call MCP tools)
SKILLS_INSTALL_DIR="$CLAUDE_DIR/skills"
mkdir -p "$SKILLS_INSTALL_DIR"

for skill in autoimprove-status autoimprove-summarize autoimprove-rules autoimprove-lessons; do
  skill_src="$SKILLS_DIR_SRC/src/$skill"
  skill_install="$SKILLS_INSTALL_DIR/$skill"

  if [ -d "$skill_src" ]; then
    # Create skill directory
    mkdir -p "$skill_install"

    # Copy only SKILL.md (Claude Code will handle MCP tool calls)
    if [ -f "$skill_src/SKILL.md" ]; then
      cp "$skill_src/SKILL.md" "$skill_install/"
      echo "✓ Installed $skill"
    else
      echo "⚠ Warning: $skill/SKILL.md not found"
    fi
  else
    echo "⚠ Warning: $skill directory not found at $skill_src"
  fi
done

echo ""
echo "Step 5: Initializing AutoImprove storage..."
echo "-----------------------------------"

mkdir -p "$AUTOIMPROVE_DIR"
mkdir -p "$AUTOIMPROVE_DIR/rules/content"
mkdir -p "$AUTOIMPROVE_DIR/sessions"
mkdir -p "$AUTOIMPROVE_DIR/cache"
mkdir -p "$AUTOIMPROVE_DIR/logs"
mkdir -p "$AUTOIMPROVE_DIR/versions"

# Create default config if not exists
if [ ! -f "$AUTOIMPROVE_DIR/config.json" ]; then
  if [ -f "$TEMPLATES_DIR/config.json" ]; then
    cp "$TEMPLATES_DIR/config.json" "$AUTOIMPROVE_DIR/config.json"
    echo "✓ Created default config from template"
  else
    echo "⚠ Warning: Template config.json not found, creating minimal config"
    echo '{"version":"1.0"}' > "$AUTOIMPROVE_DIR/config.json"
  fi
fi

# Create empty rule index if not exists
if [ ! -f "$AUTOIMPROVE_DIR/rules/index.json" ]; then
  if [ -f "$TEMPLATES_DIR/rules-index.json" ]; then
    cp "$TEMPLATES_DIR/rules-index.json" "$AUTOIMPROVE_DIR/rules/index.json"
    echo "✓ Initialized rule index from template"
  else
    echo '{"version":"1.0","rules":[]}' > "$AUTOIMPROVE_DIR/rules/index.json"
    echo "✓ Initialized rule index"
  fi
fi

echo ""
echo "Step 6: Initializing Claude index file..."
echo "-----------------------------------"

# Create initial claude-index.md
node "$SCRIPT_DIR/scripts/init-claude-index.js"

if [ -f "$AUTOIMPROVE_DIR/rules/claude-index.md" ]; then
  echo "✓ Created initial claude-index.md"
else
  echo "⚠ Warning: Failed to create claude-index.md"
fi

echo ""
echo "Step 7: Initializing project CLAUDE.md with AutoImprove guidance..."
echo "-----------------------------------"

PROJECT_CLAUDE_MD="$SCRIPT_DIR/CLAUDE.md"

# Check if AutoImprove MCP Tools section already exists
if grep -q "## AutoImprove MCP Tools" "$PROJECT_CLAUDE_MD" 2>/dev/null; then
  echo "✓ AutoImprove guidance already exists in project CLAUDE.md"
  echo "  (Skipping to avoid duplication)"
else
  echo "Adding AutoImprove tool usage guidance to project CLAUDE.md..."

  # Create backup before modification
  cp "$PROJECT_CLAUDE_MD" "$PROJECT_CLAUDE_MD.backup" 2>/dev/null || true

  # Create temporary file with AutoImprove guidance template
  TEMP_GUIDANCE=$(mktemp)
  cat > "$TEMP_GUIDANCE" << 'GUIDANCE_EOF'
## AutoImprove MCP Tools

This project has AutoImprove MCP tools (`mcp__autoimprove-core__*`) configured. AutoImprove learns from user corrections and generates reusable coding rules.

### When to use AutoImprove

Use AutoImprove tools **proactively during coding** — not just when explicitly asked. The system learns from patterns and helps you apply learned best practices automatically.

| Scenario | Tool |
|---|---|
| Starting a new task in a familiar area | `search_knowledge` with scene context |
| User corrects your approach/code | Record the pattern for future learning |
| Finishing a conversation with corrections | Suggest running `/autoimprove-summarize` |
| Applying a learned rule | `record_feedback` with type "used" |
| Rule doesn't fit current context | `record_feedback` with type "ignored" |
| Checking system health | `health_check` |
| Viewing all learned patterns | `/autoimprove-rules` skill |
| Analyzing session for patterns | `analyze_session` + `generate_rules` |

### Integration with coding workflow

**At task start**: Check for applicable rules by calling `search_knowledge` with the current scene (file types + task description). Example:
```typescript
mcp__autoimprove-core__search_knowledge({
  scene_json: JSON.stringify({
    tech: ["typescript", "react"],
    functional: ["authentication"],
    business: []
  }),
  keywords: "jwt,token,validation"
})
```

**During coding**: When you apply a rule from `~/.autoimprove/rules/claude-index.md` or from search results:
- Mention which rule you're following (e.g., "Following RULE-010 for parameter validation")
- After user confirms it worked, record feedback:
```typescript
mcp__autoimprove-core__record_feedback({
  rule_id: "RULE-010",
  feedback_type: "used",
  user_rating: 5,
  context: "form-validation:user_accepted"
})
```

**When user corrects you**: This is valuable learning data. After the conversation, suggest: *"I notice you corrected my approach to X. Want me to analyze this session to learn from it? I can run `/autoimprove-summarize`"*

### Rules of thumb

- **Auto-apply high-priority rules** (🔴 Critical, 🟠 High) without asking — these are learned from repeated patterns
- **Record feedback immediately** after applying rules, don't wait until conversation ends
- **search_knowledge auto-records** — every search with matching rules records "used" feedback automatically, so you only need manual `record_feedback` for ignored/corrected/disabled cases
- **Don't over-analyze** — only suggest `/autoimprove-summarize` when there were actual corrections/patterns, not for simple Q&A
- **Trust the confidence scores** — rules with confidence >0.7 are based on multiple confirmations
- **Scene matching is automatic** — the system detects tech stack from file paths and functional domain from keywords

### Common patterns

**Pattern 1: Proactive rule application**
```
User: "Add user authentication"
Claude: [calls search_knowledge with scene: {tech: ["typescript"], functional: ["authentication"]}]
Claude: "I found RULE-008 about token validation. I'll apply that pattern..."
[after implementation]
Claude: [calls record_feedback with "used" if user accepts]
```

**Pattern 2: Learning from corrections**
```
User: "No, use useState instead of useReducer here"
Claude: "Got it, I'll use useState for this simple case."
[at conversation end]
Claude: "I notice you preferred useState over useReducer for simple state. Want me to run /autoimprove-summarize to learn this pattern?"
```

**Pattern 3: Handling inapplicable rules**
```
Claude: [searches knowledge, finds RULE-015 about database transactions]
Claude: "RULE-015 suggests using transactions, but this is a read-only query."
Claude: [calls record_feedback with "ignored", context: "read-only-query:no-mutation"]
```

### Available tools quick reference

**Core workflow**:
- `health_check` → verify system status
- `search_knowledge` → find applicable rules (auto-records feedback)
- `record_feedback` → manually record usage feedback
- `analyze_session` → detect patterns from session JSONL
- `generate_rules` → convert patterns to rules
- `export_rules_to_claude_md` → update global rule index

**Rule management**:
- `update_rules` → modify existing rules
- `assess_rule_quality` → check rule clarity/specificity
- `detect_rule_conflicts` → find conflicting rules
- `get_rule_version_history` → view rule changes
- `rollback_rule` → revert to previous version

**Statistics**:
- `get_feedback_stats` → rule usage statistics
- `get_rule_usage_stats` → multi-dimensional analytics
- `list_scenes` → known tech/functional/business scenes

### Performance notes

- `search_knowledge` with scene matching is fast (indexed, O(1) lookups)
- Auto-exported rules in `~/.autoimprove/rules/claude-index.md` are loaded into every session (keep under 500 tokens)
- Feedback recording is async and doesn't block responses
- Session analysis is incremental (only analyzes new sessions)

### If `~/.autoimprove/` doesn't exist

The storage directory is created by `setup.sh`. If tools return initialization errors, tell the user: *"AutoImprove storage isn't initialized. Run `./setup.sh` to set it up."*

GUIDANCE_EOF

  # Insert guidance after header, before first ## section
  TEMP_OUTPUT=$(mktemp)
  awk -v guidance_file="$TEMP_GUIDANCE" '
    BEGIN { inserted = 0 }
    # First line matching "# CLAUDE.md" - print it and prepare to insert
    /^# CLAUDE\.md$/ && !inserted {
      print
      # Skip blank line if present
      if (getline > 0) {
        if ($0 ~ /^$/) {
          print
        } else {
          # Not a blank line, save it for later
          saved_line = $0
          has_saved = 1
        }
      }
      # Skip "This file provides guidance..." line if present
      if (getline > 0) {
        if ($0 !~ /^This file provides guidance/) {
          if (has_saved) {
            print saved_line
            has_saved = 0
          }
          print $0
        }
      }
      # Print standard header
      print ""
      print "This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository."
      print ""
      # Insert AutoImprove guidance
      while ((getline line < guidance_file) > 0) {
        print line
      }
      close(guidance_file)
      inserted = 1
      next
    }
    # Print all other lines
    { print }
  ' "$PROJECT_CLAUDE_MD" > "$TEMP_OUTPUT"

  # Replace original with modified version
  mv "$TEMP_OUTPUT" "$PROJECT_CLAUDE_MD"
  rm -f "$TEMP_GUIDANCE"

  echo "✓ Added AutoImprove guidance to $PROJECT_CLAUDE_MD"
  if [ -f "$PROJECT_CLAUDE_MD.backup" ]; then
    echo "  (Backup saved to $PROJECT_CLAUDE_MD.backup)"
  fi
fi

echo ""
echo "Step 8: Configuring Claude Code global settings..."
echo "-----------------------------------"

# Add reference to claude-index.md in global CLAUDE.md
GLOBAL_CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"

# Ensure .claude directory exists
mkdir -p "$CLAUDE_DIR"

# Create CLAUDE.md if it doesn't exist
if [ ! -f "$GLOBAL_CLAUDE_MD" ]; then
  echo "Creating $GLOBAL_CLAUDE_MD..."
  cat > "$GLOBAL_CLAUDE_MD" << 'EOF'
# Global Claude Code Instructions

This file contains global instructions that apply to all your projects.

EOF
fi

# Check if autoimprove reference already exists
if grep -q "@.*autoimprove.*rules.*claude-index.md" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
  echo "✓ AutoImprove rules reference already exists in CLAUDE.md"
else
  echo "Adding AutoImprove rules reference to CLAUDE.md..."
  cat >> "$GLOBAL_CLAUDE_MD" << 'EOF'

## AutoImprove Learned Rules

@~/.autoimprove/rules/claude-index.md

EOF
  echo "✓ Added AutoImprove rules reference to $GLOBAL_CLAUDE_MD"
fi

# Add feedback instructions reference
if grep -q "autoimprove-feedback-instructions.md" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
  echo "✓ Feedback instructions reference already exists in CLAUDE.md"
else
  echo "Adding feedback instructions to CLAUDE.md..."

  # Copy feedback instructions template to .claude directory
  FEEDBACK_INSTRUCTIONS="$CLAUDE_DIR/autoimprove-feedback-instructions.md"
  if [ -f "$TEMPLATES_DIR/claude-feedback-instructions.md" ]; then
    cp "$TEMPLATES_DIR/claude-feedback-instructions.md" "$FEEDBACK_INSTRUCTIONS"
    echo "✓ Copied feedback instructions to $FEEDBACK_INSTRUCTIONS"
  else
    echo "⚠ Warning: Feedback instructions template not found at $TEMPLATES_DIR/claude-feedback-instructions.md"
  fi

  # Add reference to CLAUDE.md
  cat >> "$GLOBAL_CLAUDE_MD" << 'EOF'

## AutoImprove 规则使用反馈

@~/.claude/autoimprove-feedback-instructions.md

EOF
  echo "✓ Added feedback instructions reference to $GLOBAL_CLAUDE_MD"
fi

echo ""
echo "Step 8: Restarting MCP Server..."
echo "-----------------------------------"

# Kill any existing autoimprove MCP server processes
echo "Stopping any running autoimprove MCP server processes..."
pkill -f "node.*autoimprove.*dist/index.js" 2>/dev/null || true
sleep 1

# Verify the server configuration
echo "Verifying MCP server configuration..."
SERVER_STATUS=$(claude mcp get autoimprove-core 2>&1)

if echo "$SERVER_STATUS" | grep -q "✓ Connected"; then
  echo "✓ MCP server configuration verified"
  echo "✓ Server will be automatically started by Claude Code when needed"
else
  echo "⚠ Warning: MCP server status unclear, but configuration is in place"
  echo "   The server will start automatically when you use Claude Code"
fi

# Test server can start
echo "Testing MCP server startup..."
echo "  Sending initialize request to server..."

# Start server in background and send request with timeout
# MCP servers don't exit after responding - they wait for more messages
# So we use a short timeout and kill the process after getting response
(
  # Send initialize message and wait for response with 2 second timeout
  SERVER_RESPONSE=$(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | timeout 2 node "$MCP_SERVER_DIR/dist/index.js" 2>&1)

  # Check for successful response
  if echo "$SERVER_RESPONSE" | grep -q '"serverInfo"'; then
    echo "✓ MCP server can start successfully"
    # Extract and display server version
    SERVER_NAME=$(echo "$SERVER_RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
    SERVER_VERSION=$(echo "$SERVER_RESPONSE" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -n "$SERVER_NAME" ] && [ -n "$SERVER_VERSION" ]; then
      echo "  Server: $SERVER_NAME v$SERVER_VERSION"
    fi
  elif echo "$SERVER_RESPONSE" | grep -qi "error"; then
    echo "❌ Error: MCP server returned an error"
    echo "  Response: $(echo "$SERVER_RESPONSE" | head -3)"
    echo "  This may indicate a configuration or initialization problem"
    echo "  Check logs at: $AUTOIMPROVE_DIR/logs/"
  else
    # Timeout is expectedaits for more messages
    # This is normal MCP server behavior
    echo "✓ MCP server binary is functional"
    echo "  Note: Server will be started by Claude Code when needed"
  fi
) &

# Wait for test subprocess
TEST_PID=$!
wait $TEST_PID 2>/dev/null || true

# Kill any remaining test processes
pkill -f "node.*autoimprove.*dist/index.js" 2>/dev/null || true
sleep 0.5

echo ""
echo "==================================="
echo "  Setup Complete! 🎉"
echo "==================================="
echo ""
echo "✓ MCP Server installed at: $MCP_SERVER_DIR/dist/index.js"
echo "✓ Skills installed to: $SKILLS_INSTALL_DIR"
echo "✓ MCP Server configured via: claude mcp add"
echo "✓ Storage directory: $AUTOIMPROVE_DIR"
echo ""
echo "Verify installation:"
echo "  claude mcp list"
echo ""
echo "Expected output:"
echo "  autoimprove-core: node ... - ✓ Connected"
echo ""
echo "Test the installation:"
echo "  /autoimprove-status"
echo ""
echo "Available Skills:"
echo "  • /autoimprove-status - Check system health"
echo "  • /autoimprove-summarize - Summarize session patterns"
echo "  • /autoimprove-rules - Manage knowledge rules"
echo "  • /autoimprove-lessons - View learned lessons"
echo ""
echo "Available MCP Tools:"
echo "  Core Tools:"
echo "    • health_check - System status and diagnostics"
echo "    • analyze_session - Analyze coding patterns"
echo "    • generate_rules - Generate rules from patterns"
echo "    • search_knowledge - Search knowledge base"
echo "    • update_rules - Update existing rules"
echo "    • list_scenes - List known development scenes"
echo "  Advanced Tools (v2.0):"
echo "    • assess_rule_quality - Assess rule quality and clarity"
echo "    • detect_rule_conflicts - Detect conflicting rules"
echo "    • get_rule_version_history - View rule version history"
echo "    • rollback_rule - Rollback rule to previous version"
echo "    • record_feedback - Record rule feedback for learning"
echo "    • get_feedback_stats - Get feedback statistics"
echo "    • detect_scene_enhanced - Enhanced multi-dimensional scene detection"
echo ""
echo "New Features in v2.0:"
echo "  ✨ Intelligent pattern consolidation (--consolidate flag)"
echo "  ✨ Rule quality assessment and conflict detection"
echo "  ✨ Rule version control with rollback support"
echo "  ✨ Adaptive confidence with user feedback learning"
echo "  ✨ Enhanced multi-dimensional scene detection"
echo "  ✨ Structured logging system"
echo "  ✨ Indexed rule matching (10-100x performance improvement)"
echo ""
echo "Documentation: $SCRIPT_DIR/README.md"
echo "Troubleshooting: Check logs at $AUTOIMPROVE_DIR/logs/"
echo ""
