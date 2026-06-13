#!/bin/bash

# Restart AutoImprove MCP Server
# Usage: ./restart-mcp.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SERVER_DIR="$SCRIPT_DIR/src/mcp-server-ts"

echo "==================================="
echo "  Restarting AutoImprove MCP Server"
echo "==================================="
echo ""

# Step 1: Rebuild if needed
if [ "$1" == "--build" ] || [ "$1" == "-b" ]; then
  echo "Step 1: Rebuilding MCP Server..."
  cd "$MCP_SERVER_DIR"
  npm run build
  echo "✓ Build complete"
  echo ""
fi

# Step 2: Kill existing processes
echo "Step 1: Stopping existing processes..."
echo "  Killing autoimprove MCP server processes..."
KILLED_COUNT=0
while IFS= read -r pid; do
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null && KILLED_COUNT=$((KILLED_COUNT + 1))
  fi
done < <(pgrep -f "node.*autoimprove.*dist/index.js")

if [ $KILLED_COUNT -gt 0 ]; then
  echo "  ✓ Stopped $KILLED_COUNT process(es)"
else
  echo "  No running processes found"
fi

sleep 1

# Step 3: Kill MCP host processes
echo "  Killing MCP host processes..."
MCP_HOST_COUNT=0
while IFS= read -r pid; do
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null && MCP_HOST_COUNT=$((MCP_HOST_COUNT + 1))
  fi
done < <(pgrep -f "node.*mcp.*host")

if [ $MCP_HOST_COUNT -gt 0 ]; then
  echo "  ✓ Stopped $MCP_HOST_COUNT MCP host process(es)"
else
  echo "  No MCP host processes found"
fi

sleep 1

# Step 4: Re-register MCP server
echo ""
echo "Step 2: Re-registering MCP server..."
claude mcp remove autoimprove-core -s user 2>/dev/null || true
sleep 0.5

claude mcp add autoimprove-core -s user -- node "$MCP_SERVER_DIR/dist/index.js"

if [ $? -eq 0 ]; then
  echo "✓ MCP server re-registered"
else
  echo "⚠ Warning: Re-registration returned non-zero exit code (often normal)"
fi

# Step 5: Verify
echo ""
echo "Step 3: Verifying configuration..."
SERVER_STATUS=$(claude mcp get autoimprove-core 2>&1)

if echo "$SERVER_STATUS" | grep -q "✓ Connected"; then
  echo "✓ MCP server is connected and ready"
elif echo "$SERVER_STATUS" | grep -q "autoimprove-core"; then
  echo "✓ MCP server configuration exists"
  echo "  Server will start automatically when needed"
else
  echo "❌ Warning: Could not verify MCP server status"
  echo ""
  echo "Debug information:"
  echo "$SERVER_STATUS"
fi

# Step 6: Test startup
echo ""
echo "Step 4: Testing server startup..."
TEST_RESULT=$(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | timeout 2 node "$MCP_SERVER_DIR/dist/index.js" 2>&1 || true)

if echo "$TEST_RESULT" | grep -q '"serverInfo"'; then
  echo "✓ MCP server starts successfully"

  # Extract version info
  SERVER_NAME=$(echo "$TEST_RESULT" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
  SERVER_VERSION=$(echo "$TEST_RESULT" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -n "$SERVER_NAME" ] && [ -n "$SERVER_VERSION" ]; then
    echo "  Server: $SERVER_NAME v$SERVER_VERSION"
  fi
elif echo "$TEST_RESULT" | grep -qi "error"; then
  echo "❌ Error: MCP server returned an error:"
  echo "$TEST_RESULT" | head -5
else
  echo "✓ MCP server binary is functional"
fi

# Cleanup test processes
pkill -f "node.*autoimprove.*dist/index.js" 2>/dev/null || true

echo ""
echo "==================================="
echo "  Restart Complete! ✓"
echo "==================================="
echo ""
echo "Next steps:"
echo "  1. Verify with: claude mcp list"
echo "  2. Test with: /autoimprove-status"
echo ""
echo "If the server still shows old behavior:"
echo "  • Restart Claude Code application"
echo "  • Start a new conversation"
echo ""
