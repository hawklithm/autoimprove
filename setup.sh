#!/bin/bash

# AutoImprove Unified Setup Script
# 1. 执行公共初始化（MCP Server 构建、存储目录、ONNX 部署等）
# 2. 根据参数调用 setup_claude.sh 和/或 setup_codex.sh（各自特有逻辑）

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SERVER_DIR="$SCRIPT_DIR/src/mcp-server-ts"
AUTOIMPROVE_DIR="$HOME/.autoimprove"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

# Parse arguments
MODE="${1:-all}"

show_usage() {
  echo "Usage: $0 [MODE]"
  echo ""
  echo "MODE options:"
  echo "  all     - Setup both Claude Code and Codex (default)"
  echo "  claude  - Setup Claude Code only"
  echo "  codex   - Setup Codex only"
  echo ""
  echo "Examples:"
  echo "  $0           # Setup both"
  echo "  $0 claude    # Setup Claude Code only"
  echo "  $0 codex     # Setup Codex only"
  exit 0
}

# Check for help flag
if [ "$MODE" = "-h" ] || [ "$MODE" = "--help" ]; then
  show_usage
fi

# Validate mode
if [ "$MODE" != "all" ] && [ "$MODE" != "claude" ] && [ "$MODE" != "codex" ]; then
  echo -e "${RED}Error: Invalid mode '$MODE'${NC}"
  echo ""
  show_usage
fi

echo "=========================================="
echo "  AutoImprove Unified Setup"
echo "=========================================="
echo ""
echo "Mode: $MODE"
echo ""

# ============================================================================
# 公共逻辑：环境检查
# ============================================================================

echo -e "${BLUE}=== 环境检查 ===${NC}"
echo ""

if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js 未安装，请先安装 Node.js 18+${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
  echo -e "${RED}❌ npm 未安装${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} npm $(npm -v)"

echo ""

# ============================================================================
# 公共逻辑：MCP Server 构建（只需一次）
# ============================================================================

echo -e "${BLUE}=== 构建 MCP Server ===${NC}"
echo ""

cd "$MCP_SERVER_DIR"

if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ MCP Server package.json 未找到: $MCP_SERVER_DIR${NC}"
  exit 1
fi

echo "安装 MCP Server 依赖..."
npm install

echo "构建 MCP Server (TypeScript)..."
npm run build

if [ ! -f "dist/index.js" ]; then
  echo -e "${RED}❌ MCP Server 构建失败 - dist/index.js 未生成${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} MCP Server 构建成功"

cd "$SCRIPT_DIR"

echo ""

# ============================================================================
# 公共逻辑：存储目录初始化
# ============================================================================

echo -e "${BLUE}=== 初始化存储目录 ===${NC}"
echo ""

mkdir -p "$AUTOIMPROVE_DIR"
mkdir -p "$AUTOIMPROVE_DIR/rules/content"
mkdir -p "$AUTOIMPROVE_DIR/sessions"
mkdir -p "$AUTOIMPROVE_DIR/cache"
mkdir -p "$AUTOIMPROVE_DIR/logs"
mkdir -p "$AUTOIMPROVE_DIR/versions"

echo -e "${GREEN}✓${NC} 存储目录已创建: $AUTOIMPROVE_DIR"

# 检测存储后端
DB_PATH="$AUTOIMPROVE_DIR/rules.db"
INDEX_PATH="$AUTOIMPROVE_DIR/rules/index.json"

if [ -f "$DB_PATH" ]; then
  echo -e "${GREEN}✓${NC} 检测到 SQLite 存储后端"
  STORAGE_BACKEND="sqlite"
elif [ -f "$INDEX_PATH" ]; then
  echo -e "${YELLOW}⚠${NC} 检测到 JSON 存储后端（建议迁移到 SQLite）"
  STORAGE_BACKEND="json"
else
  echo -e "${GREEN}✓${NC} 初始化新 SQLite 存储后端"
  STORAGE_BACKEND="sqlite"
  echo '{"version":"1.0","rules":[]}' > "$INDEX_PATH"
fi

# 确保 better-sqlite3 已安装
if ! npm list better-sqlite3 --depth=0 --prefix="$MCP_SERVER_DIR" &> /dev/null; then
  echo "安装 better-sqlite3..."
  cd "$MCP_SERVER_DIR"
  npm install better-sqlite3
  echo -e "${GREEN}✓${NC} better-sqlite3 安装完成"
  cd "$SCRIPT_DIR"
else
  echo -e "${GREEN}✓${NC} better-sqlite3 依赖已验证"
fi

# 创建默认 config（如果不存在）
if [ ! -f "$AUTOIMPROVE_DIR/config.json" ]; then
  if [ -f "$TEMPLATES_DIR/config.json" ]; then
    cp "$TEMPLATES_DIR/config.json" "$AUTOIMPROVE_DIR/config.json"
    echo -e "${GREEN}✓${NC} 已从模板创建默认配置"
  else
    echo -e "${YELLOW}⚠${NC} 模板 config.json 未找到，创建最小配置"
    echo '{"version":"1.0"}' > "$AUTOIMPROVE_DIR/config.json"
  fi
fi

echo ""

# ============================================================================
# 公共逻辑：初始化 claude-index.md（由 init-claude-index.js 创建）
# ============================================================================

echo -e "${BLUE}=== 初始化 Rule Index ===${NC}"
echo ""

if [ -f "$SCRIPT_DIR/scripts/init-claude-index.js" ]; then
  node "$SCRIPT_DIR/scripts/init-claude-index.js"
  if [ -f "$AUTOIMPROVE_DIR/rules/claude-index.md" ]; then
    echo -e "${GREEN}✓${NC} claude-index.md 已创建"
  else
    echo -e "${YELLOW}⚠${NC} claude-index.md 创建失败"
  fi
fi

echo ""

# ============================================================================
# 公共逻辑：ONNX 本地小模型部署（可选）
# ============================================================================

echo -e "${BLUE}=== ONNX 本地小模型部署（可选） ===${NC}"
echo ""
echo "AutoImprove 支持使用 ONNX 本地小模型提升语义表示的准确率，"
echo "特别适合中英混写、跨语言场景下的信号匹配和聚类。"
echo ""
echo "安装内容包括："
echo "  • onnxruntime-node — Node.js ONNX 推理运行时（约 30MB）"
echo "  • bge-small-zh ONNX 量化模型 — 轻量中文语义模型（约 30MB）"
echo ""
echo "注意："
echo "  • ONNX 为可选增强，不安装不影响核心功能（自动使用零依赖的 char-ngram-tfidf）"
echo "  • 安装后脚本将自动补全 config.json 中的 local_ml 配置并启用 embedding_backend: \"onnx-local\""
echo "  • 首次加载模型约 1-3 秒，后续推理约 10-50ms（纯 CPU）"
echo ""

confirm() {
    local prompt="$1"
    local reply
    read -r -p "$prompt [y/N] " reply
    case "$reply" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) return 1 ;;
    esac
}

if confirm "是否安装 ONNX 本地小模型？（推荐）"; then
    echo ""
    echo "正在执行 ONNX 部署脚本..."
    bash "$SCRIPT_DIR/scripts/install-onnx-models.sh" --force
    echo ""
    echo -e "${GREEN}✓${NC} ONNX 部署完成"

    # 补全 config.json 中的 local_ml 配置
    CONFIG_FILE="$AUTOIMPROVE_DIR/config.json"
    if [ -f "$CONFIG_FILE" ]; then
        echo "正在补全 config.json 中的 local_ml 配置..."
        # 使用 node 来安全地合并 JSON
        node -e "
        const fs = require('fs');
        const path = require('path');
        const configPath = path.resolve('$CONFIG_FILE');
        let config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.local_ml = {
            enabled: true,
            embedding_backend: 'onnx-local',
            onnx_model: 'bge-small-zh.onnx',
            prefilter: { enabled: true, mode: 'heuristic' },
            clusterer: 'kmeans',
            pattern_clusterer: 'semantic',
            signal_match: { mode: 'neighbor', threshold: 0.62 },
            personalization: { enabled: false, per_user: false },
            ab_test: { rollout: 1.0 }
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('✓ local_ml 配置已写入 config.json');
        "
        echo -e "${GREEN}✓${NC} config.json 已更新，local_ml 已启用（embedding_backend: onnx-local）"
    else
        echo -e "${YELLOW}⚠${NC} config.json 不存在，跳过配置写入"
    fi
else
    echo -e "${YELLOW}⏭${NC} 跳过 ONNX 安装"
    echo "您可以稍后随时运行以下命令安装："
    echo "  bash $SCRIPT_DIR/scripts/install-onnx-models.sh"
fi

echo ""

# ============================================================================
# 特有逻辑：根据 mode 调用对应的 setup 脚本
# ============================================================================

case "$MODE" in
  all)
    echo -e "${BLUE}=== 配置 Claude Code ===${NC}"
    echo ""
    bash "$SCRIPT_DIR/setup_claude.sh"

    echo ""
    echo -e "${BLUE}=== 配置 Codex ===${NC}"
    echo ""
    bash "$SCRIPT_DIR/setup_codex.sh"
    ;;

  claude)
    echo -e "${BLUE}=== 配置 Claude Code ===${NC}"
    echo ""
    bash "$SCRIPT_DIR/setup_claude.sh"
    ;;

  codex)
    echo -e "${BLUE}=== 配置 Codex ===${NC}"
    echo ""
    bash "$SCRIPT_DIR/setup_codex.sh"
    ;;
esac

# ============================================================================
# 公共逻辑：重启 MCP Server
# ============================================================================

echo ""
echo -e "${BLUE}=== 重启 MCP Server ===${NC}"
echo ""

# 停掉旧进程
AUTOIMPROVE_PIDS=$(pgrep -f "$MCP_SERVER_DIR/dist/index.js" 2>/dev/null || true)
if [ -n "$AUTOIMPROVE_PIDS" ]; then
  echo "Stopping old autoimprove MCP processes: $AUTOIMPROVE_PIDS"
  for pid in $AUTOIMPROVE_PIDS; do
    kill $pid 2>/dev/null || true
  done
  sleep 2
  REMAINING=$(pgrep -f "$MCP_SERVER_DIR/dist/index.js" 2>/dev/null || true)
  if [ -n "$REMAINING" ]; then
    kill -9 $REMAINING 2>/dev/null || true
    sleep 1
  fi
  echo -e "${GREEN}✓${NC} Stopped old MCP processes"
else
  echo "  No running autoimprove MCP processes found"
fi

# 如果是 Claude 模式，重新注册 MCP Server 以强制加载
if [ "$MODE" = "all" ] || [ "$MODE" = "claude" ]; then
  if command -v claude &> /dev/null; then
    echo "Re-registering MCP server for Claude Code..."
    claude mcp remove autoimprove-core -s user 2>/dev/null || true
    sleep 0.5
    claude mcp add autoimprove-core -s user -- node "$MCP_SERVER_DIR/dist/index.js" 2>/dev/null
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✓${NC} MCP server re-registered"
    fi

    # 停掉 MCP host 进程
    MCP_HOST_PIDS=$(pgrep -f "node.*mcp.*host" 2>/dev/null || true)
    if [ -n "$MCP_HOST_PIDS" ]; then
      for pid in $MCP_HOST_PIDS; do
        kill $pid 2>/dev/null || true
      done
      sleep 1
    fi
  fi
fi

echo ""
echo -e "${GREEN}✓ MCP server restart complete${NC}"

echo ""
echo "=========================================="
echo -e "${GREEN}Setup completed!${NC}"
echo "=========================================="
echo ""
echo "Summary:"
case "$MODE" in
  all)
    echo "  ✓ Claude Code configured at: ~/.claude"
    echo "  ✓ Codex configured at: ~/.codex"
    ;;
  claude)
    echo "  ✓ Claude Code configured at: ~/.claude"
    ;;
  codex)
    echo "  ✓ Codex configured at: ~/.codex"
    ;;
esac
echo "  ✓ Storage directory: ~/.autoimprove"
echo "  ✓ MCP Server built: $MCP_SERVER_DIR/dist/index.js"
if [ -f "$MCP_SERVER_DIR/node_modules/onnxruntime-node/package.json" ]; then
    echo "  ✓ onnxruntime-node installed"
fi
if [ -f "$HOME/.autoimprove/models/bge-small-zh.onnx" ]; then
    echo "  ✓ ONNX model: ~/.autoimprove/models/bge-small-zh.onnx"
fi
echo ""
echo "Next steps:"
case "$MODE" in
  all)
    echo "  • Restart Claude Code and test: /autoimprove-status"
    echo "  • Restart Codex CLI and test: /autoimprove-search test"
    ;;
  claude)
    echo "  • Restart Claude Code and test: /autoimprove-status"
    ;;
  codex)
    echo "  • Restart Codex CLI and test: /autoimprove-search test"
    ;;
esac
echo ""
