#!/bin/bash
# AutoImprove Uninstallation Script
#
# 功能：清理 AutoImprove 的配置和系统文件，保留用户个人数据
# 推荐使用: autoimprove uninstall（功能更完整）

set -e

echo "🗑️  Uninstalling AutoImprove..."
echo ""

# Resolve project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Remove Skills
echo "Removing Skills..."
skills_dir="$HOME/.claude/skills"

for skill in autoimprove-status autoimprove-summarize autoimprove-rules autoimprove-lessons; do
    if [ -d "$skills_dir/$skill" ]; then
        rm -rf "$skills_dir/$skill"
        echo "  ✅ Removed $skill"
    fi
done
echo ""

# Remove MCP Server configuration via claude CLI
echo "Uninstalling MCP Server..."
if command -v claude &> /dev/null; then
    if claude mcp get autoimprove-core 2>/dev/null | grep -q "config"; then
        claude mcp remove autoimprove-core -s user 2>/dev/null || true
        claude mcp remove autoimprove-core -s local 2>/dev/null || true
        echo "  ✅ Removed MCP configuration (autoimprove-core)"
    else
        echo "  - No MCP configuration found"
    fi
else
    echo "  ⚠ claude CLI not found, skipping MCP config removal"
fi
echo ""

# Clean CLAUDE.md
echo "Cleaning CLAUDE.md..."
claude_md="$HOME/.claude/CLAUDE.md"
if [ -f "$claude_md" ]; then
    # Remove <!-- AUTOIMPROVE_START --> ... <!-- AUTOIMPROVE_END --> block (current format)
    if grep -q "<!-- AUTOIMPROVE_START -->" "$claude_md" 2>/dev/null; then
        sed -i '' '/<!-- AUTOIMPROVE_START -->/,/<!-- AUTOIMPROVE_END -->/d' "$claude_md" 2>/dev/null || true
        echo "  ✅ Removed AutoImprove guidance section (<!-- AUTOIMPROVE_START -->)"
    fi

    # Remove AutoImprove Learned Rules section (legacy format)
    sed -i '' '/^## AutoImprove Learned Rules/,/^$/d' "$claude_md" 2>/dev/null || true

    # Remove AutoImprove Rule Feedback section (legacy format)
    sed -i '' '/^## AutoImprove Rule Feedback/,/^$/d' "$claude_md" 2>/dev/null || true

    # Remove @ references to autoimprove paths
    sed -i '' '/@~\/\.autoimprove\/rules\/claude-index\.md/d' "$claude_md" 2>/dev/null || true
    sed -i '' '/@~\/\.claude\/autoimprove-feedback-instructions\.md/d' "$claude_md" 2>/dev/null || true

    # Clean up multiple consecutive newlines
    sed -i '' '/^$/{ N; /^\n$/{ /^\n$/d; }; }' "$claude_md" 2>/dev/null || true

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
CODEX_MCP_SETTINGS="$HOME/.codex/mcp_settings.json"
CODEX_SKILL_DIR="$HOME/.codex/skills/autoimprove"

# Remove Codex skill directory
if [ -d "$CODEX_SKILL_DIR" ]; then
    rm -rf "$CODEX_SKILL_DIR"
    echo "  ✅ Removed Codex skill: ~/.codex/skills/autoimprove/"
else
    echo "  - Codex skill not found"
fi

# Remove autoimprove-core from Codex MCP settings
if [ -f "$CODEX_MCP_SETTINGS" ]; then
    # Use node to safely parse JSON
    node -e "
        const fs = require('fs');
        const path = '$CODEX_MCP_SETTINGS';
        const content = JSON.parse(fs.readFileSync(path, 'utf-8'));
        if (content.mcpServers && content.mcpServers['autoimprove-core']) {
            delete content.mcpServers['autoimprove-core'];
            if (Object.keys(content.mcpServers).length === 0) {
                delete content.mcpServers;
            }
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

# Check for onnxruntime-node in package.json
if [ -f "$MCP_SERVER_DIR/package.json" ]; then
    if grep -q '"onnxruntime-node"' "$MCP_SERVER_DIR/package.json" 2>/dev/null; then
        echo "  • onnxruntime-node 依赖（MCP Server 的 package.json 中）"
        HAS_ONNX=true
    fi
fi

# Check for model files
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
        # Remove onnxruntime-node from package.json
        if [ -f "$MCP_SERVER_DIR/package.json" ]; then
            # Use node to safely parse JSON
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

        # Remove model files
        if [ -d "$MODEL_DIR" ]; then
            rm -rf "$MODEL_DIR"/*
            echo "  ✅ Removed model files from $MODEL_DIR"
        fi

        # Remove node_modules/onnxruntime-node if present
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
echo "You can also use: autoimprove uninstall"
echo ""
