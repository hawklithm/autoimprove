#!/bin/bash
# AutoImprove Setup Script for Codex
# Automatically configures MCP Server and Skills for OpenAI Codex CLI
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOIMPROVE_DIR="$SCRIPT_DIR/src/mcp-server-ts"
CODEX_DIR="$HOME/.codex"
CODEX_GUIDANCE="$CODEX_DIR/guidance.md"
MCP_SETTINGS_FILE="$CODEX_DIR/mcp_settings.json"
SKILL_DIR="$CODEX_DIR/skills/autoimprove"
SKILL_FILE="$SKILL_DIR/skill.md"

echo "=========================================="
echo "AutoImprove Setup for Codex"
echo "=========================================="
echo ""

# Check if Codex CLI is installed
if ! command -v codex &> /dev/null; then
    echo -e "${YELLOW}[WARNING]${NC} OpenAI Codex CLI not found"
    echo "Setup will continue, but you'll need to install Codex to use it:"
    echo "  https://github.com/openai/codex"
    echo ""
else
    echo -e "${GREEN}[OK]${NC} Codex CLI found"
fi

# Create Codex directories
echo ""
echo "Creating Codex directories..."
mkdir -p "$CODEX_DIR"
mkdir -p "$SKILL_DIR"
echo -e "${GREEN}[OK]${NC} Directories created"

# Copy guidance template
echo ""
echo "Configuring Codex guidance..."
if [ -f "$SCRIPT_DIR/templates/claude-guidance-template.md" ]; then
    cp "$SCRIPT_DIR/templates/claude-guidance-template.md" "$CODEX_GUIDANCE"
    echo -e "${GREEN}[OK]${NC} Guidance file created: $CODEX_GUIDANCE"
else
    echo -e "${YELLOW}[WARNING]${NC} Template not found, creating basic guidance..."
    cat > "$CODEX_GUIDANCE" << 'EOF'
<!-- AUTOIMPROVE_START -->
## AutoImprove - CRITICAL FIRST STEP
⚠️ **BLOCKING**: Call `search_knowledge` BEFORE:
1. Write/Edit/Create files (code/config/docs/tests)
2. Debug/Diagnose/Analyze (search BEFORE reading logs)
3. Fix/Resolve/Repair (bugs/errors/crashes/performance)
4. Investigate/Troubleshoot ("why X broken/slow/failing")
No exceptions. Search <10ms, skips risk repeating mistakes.

### Usage
Always start with: \`search_knowledge({keywords:"<issue>,<context>"})\`
Then: Review matched rules → Apply fixes → Cite rules in response
<!-- AUTOIMPROVE_END -->
EOF
fi

# Create MCP settings for Codex
echo ""
echo "Configuring MCP Server settings..."
cat > "$MCP_SETTINGS_FILE" << EOF
{
  "mcpServers": {
    "autoimprove": {
      "command": "node",
      "args": ["$AUTOIMPROVE_DIR/dist/index.js"],
      "env": {
        "AUTOIMPROVE_DIR": "$AUTOIMPROVE_DIR"
      }
    }
  }
}
EOF
echo -e "${GREEN}[OK]${NC} MCP settings created: $MCP_SETTINGS_FILE"

# Create Skill file
echo ""
echo "Creating AutoImprove skill..."
cat > "$SKILL_FILE" << 'EOF'
---
name: autoimprove
description: AutoImprove knowledge management - search rules, learn lessons, improve code quality
trigger: ["/autoimprove", "search_knowledge", "add_rule", "add_lesson"]
---

# AutoImprove Skill

Automatically search knowledge base before making changes.

## Available Commands

- `/autoimprove-search <keywords>` - Search knowledge rules
- `/autoimprove-add-rule <title> <content> <tags>` - Add new rule
- `/autoimprove-add-lesson <title> <content> <tags>` - Add new lesson
- `/autoimprove-list` - List all rules
- `/autoimprove-sync` - Sync knowledge to remote

## Usage

Always call `search_knowledge` before:
1. Writing/editing code
2. Debugging issues
3. Fixing bugs
4. Making configuration changes

Example:
```
User: "Fix the memory leak in cache"
→ First: search_knowledge({keywords:"memory,leak,cache"})
→ Review matched rules
→ Apply fixes with citations
```
EOF
echo -e "${GREEN}[OK]${NC} Skill file created: $SKILL_FILE"

# Build MCP server if needed
echo ""
echo "Checking MCP Server build..."
if [ ! -f "$AUTOIMPROVE_DIR/dist/index.js" ]; then
    echo "Building MCP Server..."
    cd "$AUTOIMPROVE_DIR"
    npm run build
    echo -e "${GREEN}[OK]${NC} MCP Server built"
else
    echo -e "${GREEN}[OK]${NC} MCP Server already built"
fi

# Final summary
echo ""
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Configuration files created:"
echo "  • Guidance: $CODEX_GUIDANCE"
echo "  • MCP Settings: $MCP_SETTINGS_FILE"
echo "  • Skill: $SKILL_FILE"
echo ""
echo "Next steps:"
echo "  1. Restart Codex CLI"
echo "  2. AutoImprove will automatically load"
echo "  3. Test with: /autoimprove-search test"
echo ""
echo "Available commands in Codex:"
echo "  • /autoimprove-search - Search knowledge rules"
echo "  • /autoimprove-add-rule - Add new rule"
echo "  • /autoimprove-add-lesson - Add new lesson"
echo "  • /autoimprove-list - List all rules"
echo "  • /autoimprove-sync - Sync knowledge"
echo ""
echo "Documentation: $SCRIPT_DIR/README.md"
echo ""
