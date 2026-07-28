#!/usr/bin/env bash
#
# AutoImprove Summarize CLI Wrapper
#
# Convenience shell script that invokes the unified autoimprove CLI.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source "$SCRIPT_DIR/scripts/ensure-node-native.sh"

# Ensure root dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing root dependencies..."
    npm install
fi

# Ensure CLI is built
if [ ! -f "lib/cli/index.js" ]; then
    echo "📦 Building CLI..."
    npm run build:cli
fi

# Ensure MCP server dependencies exist and native modules match this Node.js.
MCP_SERVER_DIR="$SCRIPT_DIR/src/mcp-server-ts"
if [ ! -d "$MCP_SERVER_DIR/node_modules" ]; then
    echo "📦 Installing MCP server dependencies..."
    cd "$MCP_SERVER_DIR"
    npm install --silent
    cd "$SCRIPT_DIR"
fi

ensure_better_sqlite3 "$MCP_SERVER_DIR"

# Ensure MCP server is built (needed at runtime by summarize)
if [ ! -d "$MCP_SERVER_DIR/dist" ]; then
    echo "📦 Building MCP server..."
    cd "$MCP_SERVER_DIR"
    npm run build
    cd "$SCRIPT_DIR"
fi

# Run the unified CLI
echo "🚀 Running AutoImprove Summarize..."
echo ""
node lib/cli/index.js summarize "$@"
