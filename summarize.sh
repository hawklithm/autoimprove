#!/usr/bin/env bash
#
# AutoImprove Summarize CLI Wrapper
#
# 便捷的 shell 脚本，调用 summarize.ts
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 检查 tsx 是否安装
if ! command -v tsx &> /dev/null; then
    echo "❌ tsx not found. Installing..."
    npm install -g tsx
fi

# 检查 MCP server 是否已构建
if [ ! -d "src/mcp-server-ts/dist" ]; then
    echo "📦 Building MCP server first..."
    cd src/mcp-server-ts
    npm install
    npm run build
    cd "$SCRIPT_DIR"
fi

# 运行 summarize.ts
echo "🚀 Running AutoImprove Summarize..."
echo ""
tsx summarize.ts "$@"
