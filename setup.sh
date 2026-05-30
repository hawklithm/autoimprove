#!/bin/bash
# AutoImprove Automatic Setup Script
# Automatically configures Claude Code MCP Server and Skills

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 AutoImprove Automatic Setup${NC}"
echo ""

# Get project root directory (script's directory)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR"

echo -e "${GREEN}✓${NC} Project path: $PROJECT_ROOT"
echo ""

# Check Python version
echo "Checking Python version..."
python_version=$(python3 --version 2>&1 | awk '{print $2}')
required_version="3.10"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" != "$required_version" ]; then
    echo -e "${RED}❌ Error: Python 3.10+ required (current: $python_version)${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Python $python_version"
echo ""

# Install MCP Server dependencies
echo "📦 Installing MCP Server dependencies..."
cd "$PROJECT_ROOT/src/mcp-server"
pip install -e . --quiet
echo -e "${GREEN}✓${NC} MCP Server dependencies installed"
echo ""

# Initialize storage
echo "💾 Initializing storage..."
python3 -c "
import sys
sys.path.insert(0, '$PROJECT_ROOT/src/mcp-server')
from storage import init_storage
result = init_storage()
print(f'Storage initialized: {result[\"root\"]}')
"
echo -e "${GREEN}✓${NC} Storage initialized"
echo ""

# Configure Claude Code
echo "⚙️  Configuring Claude Code..."

# Detect Claude Code config directory
CLAUDE_CONFIG_DIR="$HOME/.claude"
CLAUDE_CONFIG_FILE="$CLAUDE_CONFIG_DIR/config.json"

# Create config directory
mkdir -p "$CLAUDE_CONFIG_DIR"

# Generate MCP Server config
MCP_CONFIG=$(cat <<EOF
{
  "autoimprove-core": {
    "command": "python3",
    "args": [
      "$PROJECT_ROOT/src/mcp-server/server.py"
    ],
    "env": {
      "PYTHONPATH": "$PROJECT_ROOT/src/mcp-server"
    }
  }
}
EOF
)

# Read or create config file
if [ -f "$CLAUDE_CONFIG_FILE" ]; then
    echo -e "${YELLOW}⚠${NC}  Existing config file detected"

    # Check if mcpServers config exists
    if grep -q '"mcpServers"' "$CLAUDE_CONFIG_FILE"; then
        echo -e "${YELLOW}⚠${NC}  mcpServers config already exists"

        # Check if autoimprove-core exists
        if grep -q '"autoimprove-core"' "$CLAUDE_CONFIG_FILE"; then
            echo -e "${YELLOW}⚠${NC}  autoimprove-core already configured, skipping"
        else
            echo -e "${BLUE}ℹ${NC}  Manual addition required: add autoimprove-core to mcpServers"
            echo ""
            echo "Please add the following config to mcpServers section in $CLAUDE_CONFIG_FILE:"
            echo ""
        echo "$MCP_CONFIG"
            echo ""
        fi
    else
        # Add mcpServers config
        echo -e "${BLUE}ℹ${NC}  Adding mcpServers config..."

        # Use Python to safely merge JSON
        python3 <<PYTHON_SCRIPT
import json
import sys

config_file = "$CLAUDE_CONFIG_FILE"

# Read existing config
with open(config_file, 'r') as f:
    config = json.load(f)

# Add mcpServers
if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['autoimprove-core'] = {
    "command": "python3",
    "args": ["$PROJECT_ROOT/src/mcp-server/server.py"],
    "env": {
        "PYTHONPATH": "$PROJECT_ROOT/src/mcp-server"
    }
}

# Write back config
with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)

print("✓ MCP Server config added")
PYTHON_SCRIPT

        echo -e "${GREEN}✓${NC} MCP Server config added"
    fi
else
    # Create new config file
    echo -e "${BLUE}ℹ${NC}  Creating new config file..."

    cat > "$CLAUDE_CONFIG_FILE" <<EOF
{
  "mcpServers": $MCP_CONFIG
}
EOF

    echo -e "${GREEN}✓${NC} Config file created"
fi

echo ""

# Configure Skills
echo "🎯 Configuring Skills..."

SKILLS_DIR="$CLAUDE_CONFIG_DIR/skills"
mkdir -p "$SKILLS_DIR"

# Copy or link Skills
for skill in autoimprove-status autoimprove-summarize autoimprove-rules autoimprove-lessons; do
    skill_src="$PROJECT_ROOT/src/skills/$skill"
    skill_dst="$SKILLS_DIR/$skill"

    if [ -d "$skill_dst" ] || [ -L "$skill_dst" ]; then
        echo -e "${YELLOW}⚠${NC}  $skill already exists, skipping"
    else
        # Create symbolic link (recommended for development)
        ln -s "$skill_src" "$skill_dst"
        echo -e "${GREEN}✓${NC} $skill linked"
    fi
done

echo ""

# Test MCP Server
echo "🧪 Testing MCP Server..."
cd "$PROJECT_ROOT/src/mcp-server"

# Start Server and quick test
timeout 5 python3 server.py > /dev/null 2>&1 &
SERVER_PID=$!

sleep 2

if ps -p $SERVER_PID > /dev/null; then
    echo -e "${GREEN}✓${NC} MCP Server starts successfully"
    kill $SERVER_PID 2>/dev/null || true
else
    echo -e "${YELLOW}⚠${NC}  MCP Server test timeout (this may be normal)"
fi

echo ""

# Complete
echo -e "${GREEN}✨ Setup Complete!${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Configuration Summary:"
echo ""
echo "  Project path: $PROJECT_ROOT"
echo "  Config file: $CLAUDE_CONFIG_FILE"
echo "  Storage directory: ~/.autoimprove/"
echo "  Skills: $SKILLS_DIR"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎯 Next Steps:"
echo ""
echo "  1. Restart Claude Code"
echo "     ${BLUE}claude restart${NC}  (CLI)"
echo "     or restart Desktop App / refresh Web page"
echo ""
echo "  2. Verify Installation"
echo "     Run in Claude Code: ${BLUE}/autoimprove-status${NC}"
echo ""
echo "  3. Start Using"
echo "     ${BLUE}/autoimprove-summarize${NC}  - Analyze session"
echo "     ${BLUE}/autoimprove-rules${NC}      - Manage rules"
echo "     ${BLUE}/autoimprove-lessons${NC}    - View rules"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📚 Documentation:"
echo "  - README.md - Complete usage guide"
echo "  - docs/MCP_AUTO_START.md - MCP configuration details"
echo "  - docs/MCP_TOOLS_API.md - API documentation"
echo ""
echo "❓ Troubleshooting:"
echo "  ${BLUE}cat docs/MCP_AUTO_START.md | grep -A 20 'Troubleshooting'${NC}"
echo ""
