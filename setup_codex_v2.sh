#!/bin/bash
# AutoImprove Setup Script for Codex
# Configures MCP Server and Skills following Codex best practices
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOIMPROVE_DIR="$HOME/.autoimprove"
MCP_SERVER_DIR="$SCRIPT_DIR/src/mcp-server-ts"
CODEX_DIR="$HOME/.codex"
MCP_SETTINGS_FILE="$CODEX_DIR/mcp_settings.json"
SKILL_DIR="$CODEX_DIR/skills/autoimprove"
SKILL_FILE="$SKILL_DIR/SKILL.md"
AGENTS_DIR="$SKILL_DIR/agents"
OPENAI_YAML="$AGENTS_DIR/openai.yaml"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
GUIDANCE_TEMPLATE="$TEMPLATES_DIR/claude-guidance-template.md"

# Version requirements
MIN_NODE_VERSION="18.0.0"

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
    echo ""
    echo "=========================================="
    echo "$1"
    echo "=========================================="
    echo ""
}

print_section() {
    echo ""
    echo -e "${CYAN}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

check_command() {
    if command -v "$1" &> /dev/null; then
        print_success "$1 found"
        return 0
    else
        print_error "$1 not found"
        return 1
    fi
}

version_compare() {
    # Compare two semantic versions
    # Returns 0 if $1 >= $2, 1 otherwise
    local ver1=$1
    local ver2=$2
    
    # Remove 'v' prefix if present
    ver1=${ver1#v}
    ver2=${ver2#v}
    
    # Split versions into arrays
    IFS='.' read -ra V1 <<< "$ver1"
    IFS='.' read -ra V2 <<< "$ver2"
    
    # Compare each component
    for i in {0..2}; do
        local v1=${V1[$i]:-0}
        local v2=${V2[$i]:-0}
        
        if [ "$v1" -gt "$v2" ]; then
            return 0
        elif [ "$v1" -lt "$v2" ]; then
            return 1
        fi
    done
    
    return 0
}

backup_file() {
    local file=$1
    if [ -f "$file" ]; then
        local backup="${file}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$file" "$backup"
        print_success "Backed up: $backup"
    fi
}

# ============================================================================
# Main Installation
# ============================================================================

print_header "AutoImprove Setup for Codex"

# Check Codex CLI
print_section "Checking prerequisites..."
if ! check_command codex; then
    print_warning "Codex CLI not found. Install from: https://github.com/openai/codex-cli"
    echo "Setup will continue, but you'll need Codex to use AutoImprove."
    echo ""
fi

# Check Node.js
if ! check_command node; then
    print_error "Node.js is required but not found"
    echo "Install Node.js from: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v)
if ! version_compare "$NODE_VERSION" "$MIN_NODE_VERSION"; then
    print_error "Node.js version $MIN_NODE_VERSION or higher required (found: $NODE_VERSION)"
    exit 1
fi
print_success "Node.js $NODE_VERSION (meets minimum $MIN_NODE_VERSION)"

# Check npm
if ! check_command npm; then
    print_error "npm is required but not found"
    exit 1
fi

# Check template file exists
if [ ! -f "$GUIDANCE_TEMPLATE" ]; then
    print_error "Guidance template not found: $GUIDANCE_TEMPLATE"
    echo "Please ensure templates/claude-guidance-template.md exists"
    exit 1
fi
print_success "Guidance template found"

# ============================================================================
# Create Directory Structure
# ============================================================================

print_section "Creating directory structure..."
mkdir -p "$CODEX_DIR"
mkdir -p "$SKILL_DIR"
mkdir -p "$AGENTS_DIR"
mkdir -p "$AUTOIMPROVE_DIR"
mkdir -p "$AUTOIMPROVE_DIR/rules/content"
mkdir -p "$AUTOIMPROVE_DIR/sessions"
mkdir -p "$AUTOIMPROVE_DIR/cache"
mkdir -p "$AUTOIMPROVE_DIR/logs"
print_success "Directories created"

# ============================================================================
# Initialize Storage Backend
# ============================================================================

print_section "Initializing storage backend..."
DB_PATH="$AUTOIMPROVE_DIR/rules.db"
INDEX_PATH="$AUTOIMPROVE_DIR/rules/index.json"

if [ -f "$DB_PATH" ]; then
    print_success "SQLite storage detected"
    STORAGE_BACKEND="sqlite"
elif [ -f "$INDEX_PATH" ]; then
    print_warning "JSON storage detected - migration to SQLite recommended"
    STORAGE_BACKEND="json"
    echo "  Migration will happen automatically on first MCP server start"
else
    print_success "Initializing new SQLite storage"
    STORAGE_BACKEND="sqlite"
    # Create empty index for fallback compatibility
    echo '{"version":"1.0","rules":[]}' > "$INDEX_PATH"
fi

# ============================================================================
# Build MCP Server
# ============================================================================

print_section "Building MCP server..."
cd "$MCP_SERVER_DIR"

if [ ! -f "package.json" ]; then
    print_error "MCP server package.json not found"
    exit 1
fi

# Install dependencies
print_success "Installing dependencies..."
npm install --silent

# Ensure better-sqlite3 is installed
if ! npm list better-sqlite3 --depth=0 &> /dev/null; then
    print_warning "Installing better-sqlite3..."
    npm install better-sqlite3
fi

# Build TypeScript
if [ ! -f "dist/index.js" ] || [ "src/index.ts" -nt "dist/index.js" ]; then
    print_success "Building TypeScript..."
    npm run build
else
    print_success "MCP server already built"
fi

cd "$SCRIPT_DIR"

# ============================================================================
# Configure MCP Server
# ============================================================================

print_section "Configuring MCP server..."

# Backup existing config
if [ -f "$MCP_SETTINGS_FILE" ]; then
    backup_file "$MCP_SETTINGS_FILE"
fi

# Detect current project root
PROJECT_ROOT=$(pwd)

# Create MCP settings with proper environment variables
cat > "$MCP_SETTINGS_FILE" << EOF
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "node",
      "args": ["$MCP_SERVER_DIR/dist/index.js"],
      "env": {
        "AUTOIMPROVE_HOME": "$AUTOIMPROVE_DIR",
        "AUTOIMPROVE_STORAGE_BACKEND": "$STORAGE_BACKEND",
        "AUTOIMPROVE_LOG_LEVEL": "info",
        "AUTOIMPROVE_LOG_PATH": "$AUTOIMPROVE_DIR/logs/mcp-server.log",
        "GIT_REPO_ROOT": "$PROJECT_ROOT"
      }
    }
  }
}
EOF
print_success "MCP settings created: $MCP_SETTINGS_FILE"

# ============================================================================
# Create Skill File (SKILL.md)
# ============================================================================

print_section "Creating AutoImprove skill..."

cat > "$SKILL_FILE" << 'EOF'
---
name: autoimprove
description: Intelligent code improvement system with automated pattern detection and rule generation. Use when analyzing code changes, learning from past patterns, preventing recurring issues, searching for best practices, or improving code quality through knowledge accumulation. Works with Git repositories and Claude Code sessions to automatically capture, organize, and apply coding patterns.
metadata:
  short-description: Learn from patterns, prevent recurring issues
---

# AutoImprove - Intelligent Code Improvement

AutoImprove learns from your coding patterns and helps prevent recurring issues by building a knowledge base of rules derived from your Git history and Claude Code sessions.

## Core Capabilities

### Pattern Detection & Learning
- **Session Analysis**: Automatically analyzes Claude Code sessions to detect patterns
- **Git History Mining**: Learns from commit patterns and code changes
- **Incremental Processing**: Efficiently processes only new content
- **Multi-dimensional Scene Detection**: Identifies context (bugfix, feature, refactor, optimization, etc.)

### Knowledge Base Management
- **Rule Generation**: Converts detected patterns into actionable rules
- **Scope-based Organization**: Global, organization, and project-level rules
- **Quality Control**: Automated rule quality assessment and conflict detection
- **Version Control**: Tracks rule evolution and supports rollback

### Intelligent Search
- **Context-aware Search**: Finds relevant rules based on scene and keywords
- **Hybrid Matching**: Combines keyword, semantic, and pattern matching
- **Usage Tracking**: Records rule effectiveness and feedback

## Key MCP Tools

### Essential Workflow

**1. Search Before Acting**
```
search_knowledge({
  keywords: "memory,leak,cache",
  scene: "bugfix",
  scopes: "project,organization,global"
})
```
Always search before implementing changes. Returns ranked rules with confidence scores.

**2. Analyze Sessions**
```
analyze_session({
  session_file_path: "~/.claude/sessions/recent.jsonl",
  incremental: true
})
```
Process Claude Code sessions incrementally to detect new patterns.

**3. Generate Rules**
```
generate_rules({
  scene: "bugfix",
  generator_type: "enhanced",
  quality_threshold: 0.7
})
```
Convert detected patterns into high-quality rules.

### Advanced Tools

- `get_rule_details`: Fetch full rule content by ID
- `update_rules`: Modify existing rules
- `assess_rule_quality`: Evaluate rule clarity and specificity
- `detect_rule_conflicts`: Check for conflicting guidance
- `record_feedback`: Mark rules as used/ignored/helpful
- `get_rule_usage_stats`: Analyze rule effectiveness
- `export_rules_to_claude_md`: Export top rules for Claude Code

## Recommended Workflow

### Initial Setup
1. Analyze existing sessions: `analyze_session` on recent session files
2. Generate baseline rules: `generate_rules` with enhanced mode
3. Export top rules: `export_rules_to_claude_md` for Claude Code integration

### Daily Usage
1. **Before Implementation**: Search relevant rules
2. **During Work**: Let AutoImprove track patterns automatically
3. **After Sessions**: Analyze completed sessions incrementally
4. **Periodic**: Generate new rules, assess quality, handle conflicts

### Integration with CodeGraph
When CodeGraph is available (`.codegraph/` exists), AutoImprove complements it:
- CodeGraph: Understand code structure and call paths
- AutoImprove: Learn patterns and apply best practices

Use CodeGraph for "what/how is the code", AutoImprove for "what patterns should I follow".

## Storage & Configuration

### Storage Backend
- **Default**: SQLite (`~/.autoimprove/rules.db`)
- **Fallback**: JSON (`~/.autoimprove/rules/index.json`)
- **Auto-migration**: JSON→SQLite on first use

### Directory Structure
```
~/.autoimprove/
├── rules.db              # SQLite knowledge base
├── rules/
│   ├── index.json        # Fallback/legacy index
│   ├── content/          # Rule content files
│   └── claude-index.md   # Exported rules for Claude
├── sessions/             # Session analysis cache
├── cache/                # Performance cache
└── logs/                 # MCP server logs
```

### Environment Variables
- `AUTOIMPROVE_HOME`: Base directory (default: `~/.autoimprove`)
- `AUTOIMPROVE_STORAGE_BACKEND`: `sqlite` or `json`
- `AUTOIMPROVE_LOG_LEVEL`: `debug`, `info`, `warn`, `error`
- `GIT_REPO_ROOT`: Repository root for context

## Best Practices

### Token Efficiency
- Search results are ranked by relevance - review top matches first
- Use scope filters to reduce noise
- Fetch full details only for rules you'll apply

### Quality Control
- Set `quality_threshold` ≥ 0.7 for production rules
- Review conflict detection before adding rules
- Record feedback to improve future matching

### Incremental Analysis
- Enable `incremental: true` for session analysis (default)
- Manually clear cache only when debugging
- Use `check_session_needs_analysis` to avoid redundant work

## Troubleshooting

### MCP Server Not Starting
- Check Node.js version (≥18.0.0 required)
- Verify paths in `~/.codex/mcp_settings.json`
- Check logs: `~/.autoimprove/logs/mcp-server.log`

### Storage Migration Issues
- Ensure write permissions: `~/.autoimprove/`
- Check SQLite installation: `npm list better-sqlite3`
- Force migration: delete `rules.db` and restart server

### Search Returns No Results
- Verify rules exist: Use `get_rule_usage_stats` to check count
- Try broader keywords or remove scene filter
- Check scope filter includes relevant levels

## Resources

- MCP Server: `~/.codex/mcp_settings.json`
- Knowledge Base: `~/.autoimprove/rules.db`
- Logs: `~/.autoimprove/logs/`
- Documentation: Project README.md

## Token Budget Considerations

This skill prioritizes actionable guidance over exhaustive documentation. The MCP server provides detailed tool schemas on-demand. When using AutoImprove:
- Search is fast (<10ms typically) - don't skip it
- Rule content is fetched lazily - request only what you need
- Incremental analysis minimizes redundant processing
EOF

print_success "Skill file created: $SKILL_FILE"

# ============================================================================
# Create UI Metadata (agents/openai.yaml)
# ============================================================================

print_section "Creating UI metadata..."

cat > "$OPENAI_YAML" << 'EOF'
display_name: AutoImprove
short_description: Learn from patterns, prevent recurring issues
default_prompt: Search for coding patterns and best practices relevant to my current task
EOF

print_success "UI metadata created: $OPENAI_YAML"

# ============================================================================
# Install Guidance Template (Optional for Codex)
# ============================================================================

print_section "Installing guidance template..."

# Note: Codex doesn't use guidance.md the same way Claude does
# But we'll copy it to ~/.autoimprove for reference and future use
AUTOIMPROVE_GUIDANCE="$AUTOIMPROVE_DIR/guidance.md"

if [ -f "$GUIDANCE_TEMPLATE" ]; then
    cp "$GUIDANCE_TEMPLATE" "$AUTOIMPROVE_GUIDANCE"
    print_success "Guidance template copied to: $AUTOIMPROVE_GUIDANCE"
    print_warning "Note: Codex uses skill-based prompting, not guidance.md"
    echo "  The guidance is stored for reference and Claude Code compatibility"
else
    print_warning "Guidance template not found, skipping"
fi

# ============================================================================
# Verify Installation
# ============================================================================

print_section "Verifying installation..."

# Check MCP server can start
echo "Testing MCP server startup..."
timeout 5 node "$MCP_SERVER_DIR/dist/index.js" <<< '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}' > /dev/null 2>&1
if [ $? -eq 0 ] || [ $? -eq 124 ]; then
    print_success "MCP server can start"
else
    print_warning "MCP server test inconclusive (may need environment setup)"
fi

# Check file permissions
if [ -r "$SKILL_FILE" ] && [ -r "$MCP_SETTINGS_FILE" ]; then
    print_success "Configuration files readable"
else
    print_error "Configuration files not readable"
fi

# Check storage directory writable
if [ -w "$AUTOIMPROVE_DIR" ]; then
    print_success "Storage directory writable"
else
    print_error "Storage directory not writable: $AUTOIMPROVE_DIR"
fi

# ============================================================================
# Final Summary
# ============================================================================

print_header "Setup Complete!"

echo "Configuration:"
echo "  • Skill: $SKILL_FILE"
echo "  • MCP Settings: $MCP_SETTINGS_FILE"
echo "  • UI Metadata: $OPENAI_YAML"
echo "  • Storage: $AUTOIMPROVE_DIR ($STORAGE_BACKEND backend)"
echo "  • Guidance: $AUTOIMPROVE_GUIDANCE (reference only)"
echo ""
echo "Next Steps:"
echo "  1. Restart Codex CLI to load the skill"
echo "  2. Verify with: codex --list-skills"
echo "  3. Test search: Start Codex and ask to search patterns"
echo ""
echo "Usage Examples:"
echo "  • 'Search for memory leak patterns'"
echo "  • 'Analyze my recent coding sessions'"
echo "  • 'What rules exist for error handling?'"
echo ""
echo "Documentation:"
echo "  • Skill Guide: $SKILL_FILE"
echo "  • Project Docs: $SCRIPT_DIR/README.md"
echo "  • MCP Logs: $AUTOIMPROVE_DIR/logs/mcp-server.log"
echo ""
echo -e "${GREEN}AutoImprove is ready to use!${NC}"
echo ""
