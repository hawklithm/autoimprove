#!/bin/bash

# AutoImprove Setup Script for Claude Code
# 只包含 Claude Code 特有的初始化逻辑
# 公共逻辑（MCP Server 构建、存储目录、ONNX 部署等）由 setup.sh 统一处理

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AUTOIMPROVE_DIR="$HOME/.autoimprove"
MCP_SERVER_DIR="$SCRIPT_DIR/src/mcp-server-ts"
SKILLS_DIR_SRC="$SCRIPT_DIR/src/skills-ts"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

echo -e "${BLUE}--- Claude Code: 安装 Skills ---${NC}"

SKILLS_INSTALL_DIR="$CLAUDE_DIR/skills"
mkdir -p "$SKILLS_INSTALL_DIR"

for skill in autoimprove-status autoimprove-summarize autoimprove-rules autoimprove-lessons autoimprove-check; do
  skill_src="$SKILLS_DIR_SRC/src/$skill"
  skill_install="$SKILLS_INSTALL_DIR/$skill"

  if [ -d "$skill_src" ]; then
    mkdir -p "$skill_install"
    if [ -f "$skill_src/SKILL.md" ]; then
      cp "$skill_src/SKILL.md" "$skill_install/"
      [ -f "$skill_src/skill.ts" ] && cp "$skill_src/skill.ts" "$skill_install/"
      [ -f "$skill_src/manifest.json" ] && cp "$skill_src/manifest.json" "$skill_install/"
      echo -e "${GREEN}✓${NC} Installed skill: $skill"
    else
      echo -e "${YELLOW}⚠${NC} $skill/SKILL.md not found"
    fi
  else
    echo -e "${YELLOW}⚠${NC} $skill directory not found at $skill_src"
  fi
done

echo ""

echo -e "${BLUE}--- Claude Code: 配置 MCP Server ---${NC}"

if ! command -v claude &> /dev/null; then
  echo -e "${RED}❌ claude CLI not found. Please install from https://claude.ai/download${NC}"
  exit 1
fi

# 移除旧配置（user 和 local scope）
claude mcp remove autoimprove-core -s user 2>/dev/null || true
claude mcp remove autoimprove-core -s local 2>/dev/null || true

# 注册 MCP Server（user scope，全局可见）
claude mcp add autoimprove-core -s user -- node "$MCP_SERVER_DIR/dist/index.js"

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓${NC} MCP server configured (user-level)"
else
  echo -e "${RED}❌ Failed to configure MCP server${NC}"
  exit 1
fi

echo ""

echo -e "${BLUE}--- Claude Code: 更新 CLAUDE.md ---${NC}"

GLOBAL_CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
GUIDANCE_TEMPLATE="$TEMPLATES_DIR/claude-guidance-template.md"

if [ ! -f "$GUIDANCE_TEMPLATE" ]; then
  echo -e "${RED}❌ Guidance template not found at $GUIDANCE_TEMPLATE${NC}"
  exit 1
fi

mkdir -p "$CLAUDE_DIR"

# 创建 CLAUDE.md（如果不存在）
if [ ! -f "$GLOBAL_CLAUDE_MD" ]; then
  echo "Creating $GLOBAL_CLAUDE_MD..."
  cat > "$GLOBAL_CLAUDE_MD" << 'EOF'
# Global Claude Code Instructions

This file contains global instructions that apply to all your projects.

EOF
fi

# 备份
cp "$GLOBAL_CLAUDE_MD" "$GLOBAL_CLAUDE_MD.backup" 2>/dev/null || true

# 写入或替换 <!-- AUTOIMPROVE_START --> 区块
if grep -q "<!-- AUTOIMPROVE_START -->" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
  if grep -q "CRITICAL FIRST STEP\|Pre-Action Checklist\|⚠️ \*\*BLOCKING\*\*" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
    echo "Migrating legacy AutoImprove guidance to the concise sub-agent block..."
  else
    echo "Updating existing AutoImprove section..."
  fi
  TEMP_OUTPUT=$(mktemp)
  awk -v template="$GUIDANCE_TEMPLATE" '
    /<!-- AUTOIMPROVE_START -->/ {
      while ((getline line < template) > 0) { print line }
      close(template)
      while (getline > 0 && !/<!-- AUTOIMPROVE_END -->/) {}
      next
    }
    { print }
  ' "$GLOBAL_CLAUDE_MD" > "$TEMP_OUTPUT"
  mv "$TEMP_OUTPUT" "$GLOBAL_CLAUDE_MD"
else
  echo "Appending AutoImprove guidance..."
  echo "" >> "$GLOBAL_CLAUDE_MD"
  cat "$GUIDANCE_TEMPLATE" >> "$GLOBAL_CLAUDE_MD"
  echo "" >> "$GLOBAL_CLAUDE_MD"
fi
echo -e "${GREEN}✓${NC} CLAUDE.md updated"
echo "  (Backup saved to $GLOBAL_CLAUDE_MD.backup)"

# 清理旧的引用
if grep -q "@.*autoimprove.*rules.*claude-index.md" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
  grep -v "@.*autoimprove.*rules.*claude-index.md" "$GLOBAL_CLAUDE_MD" | \
    sed '/## AutoImprove Learned Rules/,+2d' > "${GLOBAL_CLAUDE_MD}.tmp"
  mv "${GLOBAL_CLAUDE_MD}.tmp" "$GLOBAL_CLAUDE_MD"
  echo -e "${GREEN}✓${NC} Removed obsolete claude-index.md auto-loading"
fi
if grep -q "autoimprove-feedback-instructions.md" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
  grep -v "autoimprove-feedback-instructions.md" "$GLOBAL_CLAUDE_MD" | \
    sed '/## AutoImprove 规则使用反馈/,+2d' > "${GLOBAL_CLAUDE_MD}.tmp"
  mv "${GLOBAL_CLAUDE_MD}.tmp" "$GLOBAL_CLAUDE_MD"
  echo -e "${GREEN}✓${NC} Removed obsolete feedback instructions reference"
fi
echo ""
echo -e "${GREEN}✓ Claude Code setup complete${NC}"
echo ""
