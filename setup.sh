#!/bin/bash

# AutoImprove Setup Script (TypeScript)
# Automatically configures MCP Server and Skills for Claude Code

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AUTOIMPROVE_DIR="$HOME/.autoimprove"

echo "==================================="
echo "  AutoImprove Setup"
echo "==================================="
echo ""

echo "Step 1: Installing MCP Server dependencies..."
echo "-----------------------------------"

cd "$SCRIPT_DIR/src/mcp-server-ts"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
  echo "❌ Error: npm is not installed. Please install Node.js 18+ first."
  exit 1
fi

echo "Installing Node.js dependencies..."
npm install

echo "Building TypeScript..."
npm run build

SERVER_CMD="node"
SERVER_ARGS="[\"$SCRIPT_DIR/src/mcp-server-ts/dist/index.js\"]"

echo "✓ TypeScript MCP Server installed"

echo ""
echo "Step 2: Configuring Claude Code..."
echo "-----------------------------------"

# Create .claude directory if not exists
mkdir -p "$CLAUDE_DIR"

CONFIG_FILE="$CLAUDE_DIR/config.json"

# Check if config.json exists
if [ -f "$CONFIG_FILE" ]; then
  echo "Found existing config.json"

  # Backup existing config
  cp "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%Y%m%d_%H%M%S)"
  echo "✓ Backed up existing config"

  # Check if autoimprove-core already exists
  if grep -q "autoimprove-core" "$CONFIG_FILE"; then
    echo "⚠ autoimprove-core already configured. Skipping MCP configuration."
  else
    # Add autoimprove-core to existing config
    python3 -c "
import json
import sys

with open('$CONFIG_FILE', 'r') as f:
    config = json.load(f)

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['autoimprove-core'] = {
    'command': '$SERVER_CMD',
    'args': $SERVER_ARGS
}

with open('$CONFIG_FILE', 'w') as f:
    json.dump(config, f, indent=2)
"
    echo "✓ Added autoimprove-core to config.json"
  fi
else
  # Create new config.json
  cat > "$CONFIG_FILE" <<EOF
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "$SERVER_CMD",
      "args": $SERVER_ARGS
    }
  }
}
EOF
  echo "✓ Created config.json"
fi

echo ""
echo "Step 3: Installing Skills..."
echo "-----------------------------------"

SKILLS_DIR="$CLAUDE_DIR/skills"
mkdir -p "$SKILLS_DIR"

# Create symbolic links for each skill
for skill_dir in "$SCRIPT_DIR/src/skills"/*; do
  if [ -d "$skill_dir" ]; then
    skill_name=$(basename "$skill_dir")
    target="$SKILLS_DIR/$skill_name"

    if [ -L "$target" ] || [ -e "$target" ]; then
      echo "⚠ Skill $skill_name already exists, skipping"
    else
      ln -s "$skill_dir" "$target"
      echo "✓ Installed skill: $skill_name"
    fi
  fi
done

echo ""
echo "Step 4: Initializing storage..."
echo "-----------------------------------"

mkdir -p "$AUTOIMPROVE_DIR"
mkdir -p "$AUTOIMPROVE_DIR/rules/content"
mkdir -p "$AUTOIMPROVE_DIR/sessions"
mkdir -p "$AUTOIMPROVE_DIR/cache"
mkdir -p "$AUTOIMPROVE_DIR/logs"

# Create default config if not exists
if [ ! -f "$AUTOIMPROVE_DIR/config.json" ]; then
  cat > "$AUTOIMPROVE_DIR/config.json" <<EOF
{
  "version": "1.0",
  "confidence_thresholds": {
    "repeated-correction": 0.45,
    "anti-pattern": 0.45,
    "preference": 0.3,
    "performance": 0.4,
    "security": 0.3
  },
  "confidence_weights": {
    "frequency": 0.3,
    "time_span": 0.1,
    "behavior": 0.4,
    "validation": 0.2
  },
  "rule_matching": {
    "max_results": 10,
    "min_confidence": 0.3
  },
  "business_domain_mappings": {}
}
EOF
  echo "✓ Created default config"
fi

# Create empty rule index if not exists
if [ ! -f "$AUTOIMPROVE_DIR/rules/index.json" ]; then
  echo '{"version":"1.0","rules":[]}' > "$AUTOIMPROVE_DIR/rules/index.json"
  echo "✓ Initialized rule index"
fi

echo ""
echo "==================================="
echo "  Setup Complete! 🎉"
echo "==================================="
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code"
echo "  2. Run: /autoimprove-status"
echo "  3. Start coding and let AutoImprove learn from your patterns"
echo ""
echo "Documentation: $SCRIPT_DIR/README.md"
echo ""
