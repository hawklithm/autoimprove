#!/bin/bash

# AutoImprove Debug Script
# Run this to check MCP Server status and logs

echo "======================================"
echo "  AutoImprove Debug Information"
echo "======================================"
echo ""

echo "1. Checking MCP Server configuration..."
echo "--------------------------------------"
if [ -f ~/.claude/config.json ]; then
  echo "✓ Config file exists"
  echo ""
  echo "MCP Server config:"
  cat ~/.claude/config.json | grep -A 5 "autoimprove-core" || echo "⚠ autoimprove-core not found in config"
else
  echo "❌ Config file not found at ~/.claude/config.json"
fi

echo ""
echo "2. Checking MCP Server files..."
echo "--------------------------------------"
# Get script directory and construct server path dynamically
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PATH="$SCRIPT_DIR/src/mcp-server-ts/dist/index.js"
if [ -f "$SERVER_PATH" ]; then
  echo "✓ Server file exists: $SERVER_PATH"
else
  echo "❌ Server file not found: $SERVER_PATH"
fi

echo ""
echo "3. Testing MCP Server startup..."
echo "--------------------------------------"
echo "Starting server (will run for 3 seconds)..."
timeout 3 node "$SERVER_PATH" 2>&1 || echo "Server test completed"

echo ""
echo "4. Checking Skills installation..."
echo "--------------------------------------"
for skill in autoimprove-status autoimprove-rules autoimprove-lessons; do
  if [ -f ~/.claude/skills/$skill/SKILL.md ]; then
    echo "✓ $skill installed"
  else
    echo "❌ $skill not found"
  fi
done

echo ""
echo "5. Checking storage..."
echo "--------------------------------------"
if [ -d ~/.autoimprove ]; then
  echo "✓ Storage directory exists"
  echo "  Rules: $([ -f ~/.autoimprove/rules/index.json ] && echo "initialized" || echo "not initialized")"
  echo "  Config: $([ -f ~/.autoimprove/config.json ] && echo "exists" || echo "missing")"
else
  echo "⚠ Storage directory not initialized at ~/.autoimprove/"
fi

echo ""
echo "6. Recent system logs (last 100 lines)..."
echo "--------------------------------------"
echo "Checking for Claude/MCP related logs..."
log show --predicate 'eventMessage CONTAINS "autoimprove" OR eventMessage CONTAINS "mcp"' --last 10m --info 2>/dev/null | tail -20 || echo "No recent logs found (this is normal)"

echo ""
echo "======================================"
echo "  Debug Complete"
echo "======================================"
echo ""
echo "If you see errors above, please share them."
echo "Otherwise, try running: /autoimprove-status"
echo ""
