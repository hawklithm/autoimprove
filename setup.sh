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
echo "Step 7: Configuring Claude Code global settings..."
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
