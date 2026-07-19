#!/bin/bash
# AutoImprove Uninstallation Script
#
# 功能：清理 AutoImprove 的配置和系统文件，保留用户个人数据
# 推荐使用: autoimprove uninstall（功能更完整）
#
# 此脚本委托给 `autoimprove uninstall` CLI 命令执行实际卸载逻辑，
# 自身只处理 autoimprove CLI 不可用时的兜底清理。

set -e

echo "🗑️  Uninstalling AutoImprove..."
echo ""

# 尝试使用 autoimprove CLI 卸载（推荐）
if command -v autoimprove &> /dev/null; then
    echo "Using autoimprove CLI for full uninstall..."
    echo ""
    autoimprove uninstall
    exit $?
fi

echo "⚠️  autoimprove CLI not found, performing basic cleanup..."
echo ""

# ============================================================
# 兜底清理：autoimprove CLI 不可用时执行
# 注意：此处的逻辑应保持与 src/cli/commands/uninstall.ts 一致
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Remove Skills
echo "Removing Skills..."
skills_dir="$HOME/.claude/skills"
for skill in autoimprove-status autoimprove-rules autoimprove-lessons; do
    if [ -d "$skills_dir/$skill" ]; then
        rm -rf "$skills_dir/$skill"
        echo "  ✅ Removed $skill"
    fi
done
echo ""

# Remove MCP Server configuration
echo "Uninstalling MCP Server..."
if command -v claude &> /dev/null; then
    claude mcp remove autoimprove-core -s user 2>/dev/null || true
    claude mcp remove autoimprove-core -s local 2>/dev/null || true
    echo "  ✅ Removed MCP configuration (autoimprove-core)"
else
    echo "  ⚠ claude CLI not found, skipping MCP config removal"
fi
echo ""

# Clean CLAUDE.md
echo "Cleaning CLAUDE.md..."
claude_md="$HOME/.claude/CLAUDE.md"
if [ -f "$claude_md" ]; then
    # Remove <!-- AUTOIMPROVE_START --> ... <!-- AUTOIMPROVE_END --> block
    sed -i '' '/<!-- AUTOIMPROVE_START -->/,/<!-- AUTOIMPROVE_END -->/d' "$claude_md" 2>/dev/null || true
    # Remove legacy sections
    sed -i '' '/^## AutoImprove Learned Rules/,/^$/d' "$claude_md" 2>/dev/null || true
    sed -i '' '/^## AutoImprove Rule Feedback/,/^$/d' "$claude_md" 2>/dev/null || true
    # Remove @ references
    sed -i '' '/@~\/\.autoimprove\/rules\/claude-index\.md/d' "$claude_md" 2>/dev/null || true
    sed -i '' '/@~\/\.claude\/autoimprove-feedback-instructions\.md/d' "$claude_md" 2>/dev/null || true
    echo "  ✅ Cleaned AutoImprove references from CLAUDE.md"
else
    echo "  - CLAUDE.md not found"
fi
echo ""

# Remove feedback instructions
echo "Removing feedback instructions..."
feedback_file="$HOME/.claude/autoimprove-feedback-instructions.md"
if [ -f "$feedback_file" ]; then
    rm -f "$feedback_file"
    echo "  ✅ Removed feedback instructions"
else
    echo "  - Feedback instructions not found"
fi
echo ""

# Remove Codex configuration
echo "Cleaning Codex configuration..."
CODEX_SKILL_DIR="$HOME/.codex/skills/autoimprove"
if [ -d "$CODEX_SKILL_DIR" ]; then
    rm -rf "$CODEX_SKILL_DIR"
    echo "  ✅ Removed Codex skill: ~/.codex/skills/autoimprove/"
else
    echo "  - Codex skill not found"
fi
CODEX_MCP_SETTINGS="$HOME/.codex/mcp_settings.json"
if [ -f "$CODEX_MCP_SETTINGS" ]; then
    node -e "
        const fs = require('fs');
        const path = '$CODEX_MCP_SETTINGS';
        const content = JSON.parse(fs.readFileSync(path, 'utf-8'));
        if (content.mcpServers && content.mcpServers['autoimprove-core']) {
            delete content.mcpServers['autoimprove-core'];
            if (Object.keys(content.mcpServers).length === 0) delete content.mcpServers;
            fs.writeFileSync(path, JSON.stringify(content, null, 2) + '\n');
            console.log('removed');
        }
    " 2>/dev/null | grep -q "removed" && echo "  ✅ Removed autoimprove-core from Codex MCP settings" || echo "  - No autoimprove-core in Codex MCP settings"
else
    echo "  - Codex MCP settings not found"
fi
echo ""

# ONNX local ML cleanup (optional, requires confirmation)
echo "ONNX local ML cleanup..."
MCP_SERVER_DIR="$SCRIPT_DIR/src/mcp-server-ts"
MODEL_DIR="$HOME/.autoimprove/models"
HAS_ONNX=false

if [ -f "$MCP_SERVER_DIR/package.json" ]; then
    if grep -q '"onnxruntime-node"' "$MCP_SERVER_DIR/package.json" 2>/dev/null; then
        echo "  • onnxruntime-node 依赖（MCP Server 的 package.json 中）"
        HAS_ONNX=true
    fi
fi

MODEL_FILES=""
if [ -d "$MODEL_DIR" ]; then
    for f in "$MODEL_DIR"/*; do
        if [ -f "$f" ]; then
            SIZE=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
            SIZE_MB=$(( SIZE / 1024 / 1024 ))
            MODEL_FILES="$MODEL_FILES  • $(basename "$f") (${SIZE_MB}MB)"$'\n'
            HAS_ONNX=true
        fi
    done
fi

if [ "$HAS_ONNX" = true ]; then
    echo ""
    echo "ONNX local ML 组件检测到："
    if grep -q '"onnxruntime-node"' "$MCP_SERVER_DIR/package.json" 2>/dev/null; then
        echo "  • onnxruntime-node 依赖（MCP Server 的 package.json 中）"
    fi
    if [ -n "$MODEL_FILES" ]; then
        echo -n "$MODEL_FILES"
    fi
    echo ""
    read -p "是否卸载 ONNX local ML 组件？（移除 onnxruntime-node 依赖和模型文件）[y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [ -f "$MCP_SERVER_DIR/package.json" ]; then
            node -e "
                const fs = require('fs');
                const p = JSON.parse(fs.readFileSync('$MCP_SERVER_DIR/package.json', 'utf-8'));
                if (p.dependencies && p.dependencies['onnxruntime-node']) {
                    delete p.dependencies['onnxruntime-node'];
                    if (Object.keys(p.dependencies).length === 0) delete p.dependencies;
                }
                fs.writeFileSync('$MCP_SERVER_DIR/package.json', JSON.stringify(p, null, 2) + '\n');
            " 2>/dev/null
            echo "  ✅ Removed onnxruntime-node from package.json"
        fi
        if [ -d "$MODEL_DIR" ]; then
            rm -rf "$MODEL_DIR"/*
            echo "  ✅ Removed model files from $MODEL_DIR"
        fi
        if [ -d "$MCP_SERVER_DIR/node_modules/onnxruntime-node" ]; then
            rm -rf "$MCP_SERVER_DIR/node_modules/onnxruntime-node"
            echo "  ✅ Removed onnxruntime-node from node_modules"
        fi
        echo ""
        echo "  ONNX local ML 已卸载。EmbeddingEncoder 将自动回退到"
        echo "  零依赖的 char-ngram-tfidf 模式，不影响系统正常运行。"
        echo "  如需重新安装，运行: bash scripts/install-onnx-models.sh"
    else
        echo "  - 已跳过 ONNX 组件卸载"
    fi
else
    echo "  - ONNX local ML 组件未安装，无需清理"
fi
echo ""

# Ask about storage (user data)
echo "⚠️  Storage directory: ~/.autoimprove/"
echo "   Contains: rules, sessions, learned patterns, config"
read -p "Remove storage (all rules and sessions will be deleted)? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$HOME/.autoimprove"
    echo "✅ Storage removed"
else
    echo "ℹ️  Storage preserved at ~/.autoimprove/"
fi
echo ""

echo "✨ Uninstallation complete!"
echo ""
