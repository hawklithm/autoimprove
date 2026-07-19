#!/usr/bin/env bash
#
# AutoImprove Summarize CLI Wrapper
#
# Convenience shell script that invokes the unified autoimprove CLI.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure CLI is built
if [ ! -f "lib/cli/index.js" ]; then
    echo "📦 Building CLI..."
    npm run build:cli
fi

# Ensure MCP server is built (needed at runtime by summarize)
if [ ! -d "src/mcp-server-ts/dist" ]; then
    echo "📦 Building MCP server..."
    cd src/mcp-server-ts
    npm install --silent
    npm run build
    cd "$SCRIPT_DIR"
fi

# Run the unified CLI
echo "🚀 Running AutoImprove Summarize..."
echo ""
node lib/cli/index.js summarize "$@"
