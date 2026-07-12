#!/bin/bash
# ==============================================================================
# install-onnx-models.sh — ONNX 本地小模型一键部署脚本
#
# 功能：
#   1. 安装 onnxruntime-node 依赖到 MCP Server
#   2. 下载量化后的 bge-small-zh ONNX 模型（约 30MB）
#   3. 验证安装是否成功
#
# 使用方式：
#   bash scripts/install-onnx-models.sh            # 交互式（默认）
#   bash scripts/install-onnx-models.sh --force     # 静默安装，无需确认
#   bash scripts/install-onnx-models.sh --dry-run   # 仅打印将要执行的操作
#
# 说明：
#   - 模型文件下载到 ~/.autoimprove/models/ 目录
#   - onnxruntime-node 安装到 src/mcp-server-ts/ 下
#   - 安装完成后需重启 MCP Server 生效
#   - 如安装失败（网络/依赖问题），EmbeddingEncoder 自动回退 char-ngram-tfidf
# ==============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_SERVER_DIR="$PROJECT_ROOT/src/mcp-server-ts"
MODEL_DIR="$HOME/.autoimprove/models"
MODEL_NAME="bge-small-zh.onnx"
# 模型下载源（按优先级尝试）：
#   1. huggingface.co — 官方源（需能访问 huggingface）
#   2. hf-mirror.com — 国内镜像
#
# 使用 Xenova 社区维护的 ONNX 量化版本（基于 BAAI/bge-small-zh-v1.5，MIT 协议）
# 量化后约 24MB，适合纯 CPU 推理
MODEL_URLS=(
  "https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx"
  "https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx"
)

# 如遇网络问题，可配置代理（取消注释并设置正确的代理地址）：
# export https_proxy=http://127.0.0.1:7897
# export http_proxy=http://127.0.0.1:7897
# export all_proxy=socks5://127.0.0.1:7897

# Parse arguments
MODE="${1:-interactive}"

# ==============================================================================
# Helper Functions
# ==============================================================================

print_header() {
    echo ""
    echo "=========================================="
    echo "  $1"
    echo "=========================================="
    echo ""
}

print_section() {
    echo ""
    echo -e "${CYAN}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

confirm() {
    local prompt="$1"
    local default="${2:-n}"
    local reply

    if [ "$MODE" = "--force" ]; then
        return 0
    fi

    if [ "$MODE" = "--dry-run" ]; then
        echo -e "${BLUE}[DRY-RUN]${NC} Would prompt: $prompt"
        return 1
    fi

    read -r -p "$prompt [y/N] " reply
    case "$reply" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) return 1 ;;
    esac
}

# ==============================================================================
# Pre-flight Checks
# ==============================================================================

print_header "ONNX 本地小模型部署"

if [ "$MODE" = "--dry-run" ]; then
    echo -e "${BLUE}[DRY-RUN]${NC} Running in dry-run mode — no changes will be made."
    echo ""
fi

print_section "环境检查..."

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js 未安装，请先安装 Node.js 18+"
    exit 1
fi
print_success "Node.js $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    print_error "npm 未安装"
    exit 1
fi
print_success "npm $(npm -v)"

# Check MCP Server directory
if [ ! -d "$MCP_SERVER_DIR" ]; then
    print_error "MCP Server 目录不存在: $MCP_SERVER_DIR"
    exit 1
fi
print_success "MCP Server 目录: $MCP_SERVER_DIR"

# Check disk space (need at least 200MB for model + deps)
AVAILABLE_KB=$(df -k "$HOME" | tail -1 | awk '{print $4}')
if [ "$AVAILABLE_KB" -lt 204800 ]; then
    print_error "磁盘空间不足（需要至少 200MB，当前可用: $(( AVAILABLE_KB / 1024 ))MB）"
    exit 1
fi
print_success "磁盘空间充足（可用: $(( AVAILABLE_KB / 1024 ))MB）"

# Check git LFS (optional — for large model files)
if command -v git-lfs &> /dev/null; then
    print_success "git-lfs 已安装（可用于下载大模型文件）"
else
    print_warning "git-lfs 未安装（非必需，模型将通过 HTTPS 直接下载）"
fi

echo ""

# ==============================================================================
# Step 1: Install onnxruntime-node
# ==============================================================================

print_section "Step 1: 安装 onnxruntime-node 依赖"

if [ "$MODE" != "--dry-run" ]; then
    echo "onnxruntime-node 是 Node.js 的 ONNX 推理运行时（纯 CPU），"
    echo "用于在本地运行量化后的 embedding 模型。"
    echo ""

    if confirm "是否安装 onnxruntime-node？（约 30MB）"; then
        echo ""
        echo "正在安装 onnxruntime-node..."

        cd "$MCP_SERVER_DIR"

        # Detect platform architecture
        ARCH=$(node -e "console.log(process.arch)")
        PLATFORM=$(node -e "console.log(process.platform)")
        echo "检测到平台: ${PLATFORM}/${ARCH}"

        # onnxruntime-node >=1.24.0 drops darwin/x64 support
        # Use 1.17.3 on Intel Macs (also compatible with macOS 12+),
        # latest on Apple Silicon
        if [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "x64" ]; then
            echo "Intel Mac 检测到，使用 onnxruntime-node@1.17.3（兼容版本）"
            echo "（注：onnxruntime-node >=1.24 不再支持 darwin/x64，"
            echo "  >=1.18 需要 macOS 14+ 的 libc++ 特性）"
            ONNX_VERSION="1.17.3"
        else
            echo "使用最新版本 onnxruntime-node"
            ONNX_VERSION="latest"
        fi

        # Install onnxruntime-node
        if npm install "onnxruntime-node@${ONNX_VERSION}" --save 2>&1; then
            print_success "onnxruntime-node ${ONNX_VERSION} 安装成功"
        else
            print_error "onnxruntime-node 安装失败"
            echo ""
            echo "可能的原因："
            echo "  1. 网络问题 — 请检查代理/网络连接"
            echo "  2. 系统缺少编译工具链 — onnxruntime-node 包含预编译二进制文件，通常无需编译"
            echo ""
            echo "EmbeddingEncoder 会自动回退到 char-ngram-tfidf 模式，不影响核心功能。"
            echo "您可以稍后重试： bash $0"
            exit 1
        fi

        cd "$PROJECT_ROOT"
    else
        print_warning "跳过 onnxruntime-node 安装"
        echo "EmbeddingEncoder 将使用默认的 char-ngram-tfidf 后端（无需额外依赖）。"
        echo "您可以稍后运行以下命令重新安装："
        echo "  bash $0"
        exit 0
    fi
else
    echo -e "${BLUE}[DRY-RUN]${NC} 将要执行: cd $MCP_SERVER_DIR && npm install onnxruntime-node@<version> --save"
fi

echo ""

# ==============================================================================
# Step 2: Download ONNX Model
# ==============================================================================

print_section "Step 2: 下载 ONNX 模型"

MODEL_TARGET="$MODEL_DIR/$MODEL_NAME"
MODEL_TAR_DIR="$MODEL_DIR/bge-small-zh"

if [ "$MODE" != "--dry-run" ]; then
    # Create model directory
    mkdir -p "$MODEL_DIR"

    # Check if model already exists
    if [ -f "$MODEL_TARGET" ]; then
        print_success "模型文件已存在: $MODEL_TARGET"
        echo "如需重新下载，请先删除旧文件："
        echo "  rm $MODEL_TARGET"
    else
        echo "正在下载 bge-small-zh ONNX 量化模型..."
        echo "来源: $MODEL_URL"
        echo "目标: $MODEL_TARGET"
        echo ""

        # Try multiple download sources with fallback mirrors
        DOWNLOAD_SUCCESS=false

        for url in "${MODEL_URLS[@]}"; do
            if [ "$DOWNLOAD_SUCCESS" = true ]; then
                break
            fi

            echo "尝试下载源: $url"

            # Method 1: curl (preferred)
            if command -v curl &> /dev/null; then
                echo "使用 curl 下载..."
                if curl -L -o "$MODEL_TARGET" "$url" --progress-bar --connect-timeout 30 --max-time 300; then
                    DOWNLOAD_SUCCESS=true
                    break
                fi
            fi

            # Method 2: wget fallback
            if [ "$DOWNLOAD_SUCCESS" = false ] && command -v wget &> /dev/null; then
                echo "使用 wget 下载..."
                if wget -O "$MODEL_TARGET" "$url" -q --show-progress --timeout=30; then
                    DOWNLOAD_SUCCESS=true
                    break
                fi
            fi

            if [ "$DOWNLOAD_SUCCESS" = false ]; then
                echo "  ⚠ 从 $url 下载失败，尝试下一个源..."
            fi
        done

        if [ "$DOWNLOAD_SUCCESS" = true ]; then
            # Verify file size (quantized model is ~24MB, threshold > 1MB)
            FILE_SIZE=$(stat -f%z "$MODEL_TARGET" 2>/dev/null || stat -c%s "$MODEL_TARGET" 2>/dev/null || echo 0)
            if [ "$FILE_SIZE" -lt 10000000 ]; then
                print_warning "模型文件大小异常（${FILE_SIZE} bytes），可能下载不完整"
                echo "EmbeddingEncoder 会检测到问题并自动回退。"
                DOWNLOAD_SUCCESS=false
            else
                print_success "模型下载成功！($(( FILE_SIZE / 1024 / 1024 ))MB)"
            fi
        else
            print_error "模型下载失败"
            echo ""
            echo "可能的原因："
            echo "  1. 无法访问 HuggingFace — 请检查网络/代理"
            echo "  2. 下载超时 — 模型约 30MB，请确保网络稳定"
            echo ""
            echo "您可以稍后手动下载模型并放置到:"
            echo "  $MODEL_TARGET"
            echo ""
            echo "参考命令（需要能访问 huggingface.co）："
            echo "  curl -L -o \"$MODEL_TARGET\" \"${MODEL_URLS[0]}\""
            echo ""
            echo "如无法直接访问，可配置代理："
            echo "  export https_proxy=http://127.0.0.1:7897"
            echo "  export http_proxy=http://127.0.0.1:7897"
            echo "  export all_proxy=socks5://127.0.0.1:7897"
            echo ""
            echo "EmbeddingEncoder 会自动回退到 char-ngram-tfidf 模式。"
            exit 1
        fi
    fi
else
    echo -e "${BLUE}[DRY-RUN]${NC} 将要执行:"
    echo "  mkdir -p $MODEL_DIR"
    echo "  curl -L -o $MODEL_TARGET $MODEL_URL"
fi

echo ""

# ==============================================================================
# Step 3: Verify Installation
# ==============================================================================

print_section "Step 3: 验证安装"

if [ "$MODE" != "--dry-run" ]; then
    # Verify model file
    if [ -f "$MODEL_TARGET" ]; then
        print_success "模型文件存在: $MODEL_TARGET"
    else
        print_error "模型文件未找到: $MODEL_TARGET"
        exit 1
    fi

    # Verify onnxruntime-node
    if cd "$MCP_SERVER_DIR" && node -e "
        try {
            const ort = require('onnxruntime-node');
            console.log('onnxruntime-node 版本:', require('onnxruntime-node/package.json').version);
            console.log('InferenceSession 可用:', typeof ort.InferenceSession === 'function');
        } catch (e) {
            console.error('加载失败:', e.message);
            process.exit(1);
        }
    " 2>&1; then
        print_success "onnxruntime-node 加载成功"
    else
        print_error "onnxruntime-node 加载失败"
        echo "请尝试重新安装： npm install onnxruntime-node"
        exit 1
    fi

    # Quick inference test (optional)
    echo ""
    echo "是否运行快速推理测试？（验证模型是否能正常加载并产出向量）"
    if confirm "运行测试（约 5 秒）" "y"; then
        echo ""
        echo "正在运行推理测试..."
        if node -e "
            const ort = require('onnxruntime-node');
            const fs = require('fs');
            const path = require('path');

            async function test() {
                const modelPath = '$MODEL_TARGET';
                if (!fs.existsSync(modelPath)) {
                    console.error('模型文件不存在:', modelPath);
                    process.exit(1);
                }
                const session = await ort.InferenceSession.create(modelPath);
                console.log('InferenceSession 创建成功');

                // Create dummy input (bge-small expects shape [1, seq_len])
                const inputIds = new BigInt64Array(128);
                const attentionMask = new BigInt64Array(128);
                const tokenTypeIds = new BigInt64Array(128);
                for (let i = 0; i < 128; i++) {
                    inputIds[i] = BigInt(i % 100);
                    attentionMask[i] = BigInt(1);
                }

                const feeds = {
                    input_ids: new ort.Tensor('int64', inputIds, [1, 128]),
                    attention_mask: new ort.Tensor('int64', attentionMask, [1, 128]),
                    token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, 128]),
                };

                const results = await session.run(feeds);
                const keys = Object.keys(results);
                console.log('模型输出键:', keys.join(', '));

                const output = results[keys[0]];
                const data = output.data;
                console.log('输出维度:', output.dims);
                console.log('向量长度:', data.length);

                // Compute L2 norm
                let norm = 0;
                for (let i = 0; i < Math.min(10, data.length); i++) {
                    norm += data[i] * data[i];
                }
                console.log('前 10 个值:', Array.from(data.slice(0, 10)).map(v => v.toFixed(4)).join(', '));
                console.log('✅ 推理测试通过！');
            }
            test().catch(e => {
                console.error('❌ 推理测试失败:', e.message);
                process.exit(1);
            });
        " 2>&1; then
            echo ""
            print_success "ONNX 安装验证全部通过！"
        else
            print_warning "推理测试未通过（模型接口可能不同，不影响 EmbeddingEncoder 的回退机制）"
        fi
    else
        print_success "安装验证通过（跳过推理测试）"
    fi
else
    echo -e "${BLUE}[DRY-RUN]${NC} 将要验证:"
    echo "  1. 检查模型文件存在"
    echo "  2. 检查 onnxruntime-node 可加载"
    echo "  3. 可选: 运行推理测试"
fi

cd "$PROJECT_ROOT" 2>/dev/null || true

# ==============================================================================
# Summary
# ==============================================================================

echo ""
print_header "安装完成！"

echo "安装详情："
echo "  • onnxruntime-node: $(cd "$MCP_SERVER_DIR" && node -e "try{const p=require('onnxruntime-node/package.json');console.log(p.version)}catch(e){console.log('未安装')}" 2>/dev/null)"
echo "  • 模型文件: $MODEL_TARGET"
if [ -f "$MODEL_TARGET" ]; then
    FILE_SIZE=$(stat -f%z "$MODEL_TARGET" 2>/dev/null || stat -c%s "$MODEL_TARGET" 2>/dev/null || echo 0)
    echo "  • 模型大小: $(( FILE_SIZE / 1024 / 1024 ))MB"
fi
echo ""

echo "启用方式："
echo "  1. 编辑配置文件: $HOME/.autoimprove/config.json"
echo "  2. 设置以下字段："
echo '     "local_ml": {'
echo '       "enabled": true,'
echo '       "embedding_backend": "onnx-local",'
echo '       "onnx_model": "bge-small-zh.onnx"'
echo '     }'
echo ""
echo "  3. 重启 MCP Server 使配置生效"
echo ""
echo "  验证生效："
echo "    检查日志: $HOME/.autoimprove/logs/mcp-server.log"
echo "    预期输出: \"embedding-onnx: ONNX session loaded from ...\""
echo ""

echo -e "${YELLOW}注意事项：${NC}"
echo "  • ONNX 后端为纯 CPU 推理，首次加载约 1-3 秒，后续推理每次约 10-50ms"
echo "  • 如模型加载失败或 onnxruntime-node 缺失，EmbeddingEncoder 会自动回退到"
echo "    零依赖的 char-ngram-tfidf 模式，不影响系统正常运行"
echo "  • 如需更换模型，修改 config.json 中的 onnx_model 字段并重启即可"
echo ""
echo -e "${GREEN}ONNX 部署完成！${NC}"
