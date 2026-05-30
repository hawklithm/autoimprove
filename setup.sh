#!/bin/bash
# AutoImprove 自动初始化脚本
# 自动配置 Claude Code MCP Server 和 Skills

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 AutoImprove 自动初始化${NC}"
echo ""

# 获取项目根目录（脚本所在目录的父目录）
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR"

echo -e "${GREEN}✓${NC} 项目路径: $PROJECT_ROOT"
echo ""

# 检查 Python 版本
echo "检查 Python 版本..."
python_version=$(python3 --version 2>&1 | awk '{print $2}')
required_version="3.10"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" != "$required_version" ]; then
    echo -e "${RED}❌ 错误: 需要 Python 3.10+ (当前: $python_version)${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Python $python_version"
echo ""

# 安装 MCP Server 依赖
echo "📦 安装 MCP Server 依赖..."
cd "$PROJECT_ROOT/src/mcp-server"
pip install -e . --quiet
echo -e "${GREEN}✓${NC} MCP Server 依赖已安装"
echo ""

# 初始化存储
echo "💾 初始化存储..."
python3 -c "
import sys
sys.path.insert(0, '$PROJECT_ROOT/src/mcp-server')
from storage import init_storage
result = init_storage()
print(f'存储已初始化: {result[\"root\"]}')
"
echo -e "${GREEN}✓${NC} 存储已初始化"
echo ""

# 配置 Claude Code
echo "⚙️  配置 Claude Code..."

# 检测 Claude Code 配置目录
CLAUDE_CONFIG_DIR="$HOME/.claude"
CLAUDE_CONFIG_FILE="$CLAUDE_CONFIG_DIR/config.json"

# 创建配置目录
mkdir -p "$CLAUDE_CONFIG_DIR"

# 生成 MCP Server 配置
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

# 读取或创建配置文件
if [ -f "$CLAUDE_CONFIG_FILE" ]; then
    echo -e "${YELLOW}⚠${NC}  检测到现有配置文件"

    # 检查是否已有 mcpServers 配置
    if grep -q '"mcpServers"' "$CLAUDE_CONFIG_FILE"; then
        echo -e "${YELLOW}⚠${NC}  配置文件中已有 mcpServers 配置"

        # 检查是否已有 autoimprove-core
        if grep -q '"autoimprove-core"' "$CLAUDE_CONFIG_FILE"; then
            echo -e "${YELLOW}⚠${NC}  autoimprove-core 已配置，跳过"
        else
            echo -e "${BLUE}ℹ${NC}  需要手动添加 autoimprove-core 到 mcpServers"
            echo ""
            echo "请将以下配置添加到 $CLAUDE_CONFIG_FILE 的 mcpServers 部分:"
            echo ""
        echo "$MCP_CONFIG"
            echo ""
        fi
    else
        # 添加 mcpServers 配置
        echo -e "${BLUE}ℹ${NC}  添加 mcpServers 配置..."

        # 使用 Python 安全地合并 JSON
        python3 <<PYTHON_SCRIPT
import json
import sys

config_file = "$CLAUDE_CONFIG_FILE"

# 读取现有配置
with open(config_file, 'r') as f:
    config = json.load(f)

# 添加 mcpServers
if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['autoimprove-core'] = {
    "command": "python3",
    "args": ["$PROJECT_ROOT/src/mcp-server/server.py"],
    "env": {
        "PYTHONPATH": "$PROJECT_ROOT/src/mcp-server"
    }
}

# 写回配置
with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)

print("✓ MCP Server 配置已添加")
PYTHON_SCRIPT

        echo -e "${GREEN}✓${NC} MCP Server 配置已添加"
    fi
else
    # 创建新配置文件
    echo -e "${BLUE}ℹ${NC}  创建新配置文件..."

    cat > "$CLAUDE_CONFIG_FILE" <<EOF
{
  "mcpServers": $MCP_CONFIG
}
EOF

    echo -e "${GREEN}✓${NC} 配置文件已创建"
fi

echo ""

# 配置 Skills
echo "🎯 配置 Skills..."

SKILLS_DIR="$CLAUDE_CONFIG_DIR/skills"
mkdir -p "$SKILLS_DIR"

# 复制或链接 Skills
for skill in autoimprove-status autoimprove-summarize autoimprove-rules autoimprove-lessons; do
    skill_src="$PROJECT_ROOT/src/skills/$skill"
    skill_dst="$SKILLS_DIR/$skill"

    if [ -d "$skill_dst" ] || [ -L "$skill_dst" ]; then
        echo -e "${YELLOW}⚠${NC}  $skill 已存在，跳过"
    else
        # 创建符号链接（推荐，便于开发）
        ln -s "$skill_src" "$skill_dst"
        echo -e "${GREEN}✓${NC} $skill 已链接"
    fi
done

echo ""

# 测试 MCP Server
echo "🧪 测试 MCP Server..."
cd "$PROJECT_ROOT/src/mcp-server"

# 启动 Server 并快速测试
timeout 5 python3 server.py > /dev/null 2>&1 &
SERVER_PID=$!

sleep 2

if ps -p $SERVER_PID > /dev/null; then
    echo -e "${GREEN}✓${NC} MCP Server 可以正常启动"
    kill $SERVER_PID 2>/dev/null || true
else
    echo -e "${YELLOW}⚠${NC}  MCP Server 测试超时（这可能是正常的）"
fi

echo ""

# 完成
echo -e "${GREEN}✨ 初始化完成！${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 配置摘要:"
echo ""
echo "  项目路径: $PROJECT_ROOT"
echo "  配置文件: $CLAUDE_CONFIG_FILE"
echo "  存储目录: ~/.autoimprove/"
echo "  Skills: $SKILLS_DIR"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎯 下一步:"
echo ""
echo "  1. 重启 Claude Code"
echo "     ${BLUE}claude restart${NC}  (CLI)"
echo "     或重启 Desktop App / 刷新 Web 页面"
echo ""
echo "  2. 验证安装"
echo "     在 Claude Code 中运行: ${BLUE}/autoimprove-status${NC}"
echo ""
echo "  3. 开始使用"
echo "     ${BLUE}/autoimprove-summarize${NC}  - 分析会话"
echo "     ${BLUE}/autoimprove-rules${NC}      - 管理规则"
echo "     ${BLUE}/autoimprove-lessons${NC}    - 查看规则"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📚 文档:"
echo "  - README.md - 完整使用指南"
echo "  - docs/MCP_AUTO_START.md - MCP 配置详解"
echo "  - docs/MCP_TOOLS_API.md - API 文档"
echo ""
echo "❓ 遇到问题？查看故障排除:"
echo "  ${BLUE}cat docs/MCP_AUTO_START.md | grep -A 20 '故障排除'${NC}"
echo ""
