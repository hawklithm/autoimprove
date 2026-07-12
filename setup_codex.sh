#!/bin/bash
# AutoImprove Setup Script for Codex
# 只包含 Codex 特有的初始化逻辑
# 公共逻辑（MCP Server 构建、存储目录、ONNX 部署等）由 setup.sh 统一处理

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOIMPROVE_DIR="$HOME/.autoimprove"
MCP_SERVER_DIR="$SCRIPT_DIR/src/mcp-server-ts"
CODEX_DIR="$HOME/.codex"
MCP_SETTINGS_FILE="$CODEX_DIR/mcp_settings.json"
SKILL_DIR="$CODEX_DIR/skills/autoimprove"
SKILL_FILE="$SKILL_DIR/SKILL.md"
AGENTS_DIR="$SKILL_DIR/agents"
OPENAI_YAML="$AGENTS_DIR/openai.yaml"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
GUIDANCE_TEMPLATE="$TEMPLATES_DIR/claude-guidance-template.md"

# ============================================================================
# 1. 创建 Codex 目录结构
# ============================================================================

echo -e "${BLUE}--- Codex: 创建目录结构 ---${NC}"
mkdir -p "$CODEX_DIR"
mkdir -p "$SKILL_DIR"
mkdir -p "$AGENTS_DIR"
echo -e "${GREEN}✓${NC} Directories created"

echo ""

# ============================================================================
# 2. 配置 Codex MCP Server（写入 mcp_settings.json）
# ============================================================================

echo -e "${BLUE}--- Codex: 配置 MCP Server ---${NC}"

PROJECT_ROOT=$(pwd)

cat > "$MCP_SETTINGS_FILE" << EOF
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "node",
      "args": ["$MCP_SERVER_DIR/dist/index.js"],
      "env": {
        "AUTOIMPROVE_HOME": "$AUTOIMPROVE_DIR",
        "AUTOIMPROVE_LOG_LEVEL": "info",
        "AUTOIMPROVE_LOG_PATH": "$AUTOIMPROVE_DIR/logs/mcp-server.log",
        "GIT_REPO_ROOT": "$PROJECT_ROOT"
      }
    }
  }
}
EOF
echo -e "${GREEN}✓${NC} MCP settings created: $MCP_SETTINGS_FILE"

echo ""

# ============================================================================
# 3. 创建 Codex Skill（SKILL.md）
# ============================================================================

echo -e "${BLUE}--- Codex: 创建 Skill ---${NC}"

cat > "$SKILL_FILE" << 'EOF'
---
name: autoimprove
description: Intelligent code improvement system with automated pattern detection and rule generation. Use when analyzing code changes, learning from past patterns, preventing recurring issues, searching for best practices, or improving code quality through knowledge accumulation. Works with Git repositories and Claude Code sessions to automatically capture, organize, and apply coding patterns.
metadata:
  short-description: Learn from patterns, prevent recurring issues
---

# AutoImprove - Intelligent Code Improvement

AutoImprove learns from your coding patterns and helps prevent recurring issues by building a knowledge base of rules derived from your Git history and Claude Code sessions.

## Core Capabilities

### Pattern Detection & Learning
- **Session Analysis**: Automatically analyzes Claude Code sessions to detect patterns
- **Git History Mining**: Learns from commit patterns and code changes
- **Incremental Processing**: Efficiently processes only new content
- **Multi-dimensional Scene Detection**: Identifies context (bugfix, feature, refactor, optimization, etc.)

### Knowledge Base Management
- **Rule Generation**: Converts detected patterns into actionable rules
- **Scope-based Organization**: Global, organization, and project-level rules
- **Quality Control**: Automated rule quality assessment and conflict detection
- **Version Control**: Tracks rule evolution and supports rollback

### Intelligent Search
- **Context-aware Search**: Finds relevant rules based on scene and keywords
- **Hybrid Matching**: Combines keyword, semantic, and pattern matching
- **Usage Tracking**: Records rule effectiveness and feedback

## Key MCP Tools

### Essential Workflow

**1. Search Before Acting**
```
search_knowledge({
  keywords: "memory,leak,cache",
  scene: "bugfix",
  scopes: "project,organization,global"
})
```
Always search before implementing changes. Returns ranked rules with confidence scores.

**2. Analyze Sessions**
```
analyze_session({
  session_file_path: "~/.claude/sessions/recent.jsonl",
  incremental: true
})
```
Process Claude Code sessions incrementally to detect new patterns.

**3. Generate Rules**
```
generate_rules({
  scene: "bugfix",
  generator_type: "enhanced",
  quality_threshold: 0.7
})
```
Convert detected patterns into high-quality rules.

### Advanced Tools

- `get_rule_details`: Fetch full rule content by ID
- `update_rules`: Modify existing rules
- `assess_rule_quality`: Evaluate rule clarity and specificity
- `detect_rule_conflicts`: Check for conflicting guidance
- `record_feedback`: Mark rules as used/ignored/helpful
- `get_rule_usage_stats`: Analyze rule effectiveness
- `export_rules_to_claude_md`: Export top rules for Claude Code

## Recommended Workflow

### Initial Setup
1. Analyze existing sessions: `analyze_session` on recent session files
2. Generate baseline rules: `generate_rules` with enhanced mode
3. Export top rules: `export_rules_to_claude_md` for Claude Code integration

### Daily Usage
1. **Before Implementation**: Search relevant rules
2. **During Work**: Let AutoImprove track patterns automatically
3. **After Sessions**: Analyze completed sessions incrementally
4. **Periodic**: Generate new rules, assess quality, handle conflicts

### Integration with CodeGraph
When CodeGraph is available (`.codegraph/` exists), AutoImprove complements it:
- CodeGraph: Understand code structure and call paths
- AutoImprove: Learn patterns and apply best practices

Use CodeGraph for "what/how is the code", AutoImprove for "what patterns should I follow".

## Storage & Configuration

### Storage Backend
- **Default**: SQLite (`~/.autoimprove/rules.db`)
- **Fallback**: JSON (`~/.autoimprove/rules/index.json`)
- **Auto-migration**: JSON→SQLite on first use

### Directory Structure
```
~/.autoimprove/
├── rules.db              # SQLite knowledge base
├── rules/
│   ├── index.json        # Fallback/legacy index
│   ├── content/          # Rule content files
│   └── claude-index.md   # Exported rules for Claude
├── sessions/             # Session analysis cache
├── cache/                # Performance cache
└── logs/                 # MCP server logs
```

### Environment Variables
- `AUTOIMPROVE_HOME`: Base directory (default: `~/.autoimprove`)
- `AUTOIMPROVE_STORAGE_BACKEND`: `sqlite` or `json`
- `AUTOIMPROVE_LOG_LEVEL`: `debug`, `info`, `warn`, `error`
- `GIT_REPO_ROOT`: Repository root for context

## Best Practices

### Token Efficiency
- Search results are ranked by relevance - review top matches first
- Use scope filters to reduce noise
- Fetch full details only for rules you'll apply

### Quality Control
- Set `quality_threshold` ≥ 0.7 for production rules
- Review conflict detection before adding rules
- Record feedback to improve future matching

### Incremental Analysis
- Enable `incremental: true` for session analysis (default)
- Manually clear cache only when debugging
- Use `check_session_needs_analysis` to avoid redundant work

## Troubleshooting

### MCP Server Not Starting
- Check Node.js version (≥18.0.0 required)
- Verify paths in `~/.codex/mcp_settings.json`
- Check logs: `~/.autoimprove/logs/mcp-server.log`

### Storage Migration Issues
- Ensure write permissions: `~/.autoimprove/`
- Check SQLite installation: `npm list better-sqlite3`
- Force migration: delete `rules.db` and restart server

### Search Returns No Results
- Verify rules exist: Use `get_rule_usage_stats` to check count
- Try broader keywords or remove scene filter
- Check scope filter includes relevant levels

## Resources

- MCP Server: `~/.codex/mcp_settings.json`
- Knowledge Base: `~/.autoimprove/rules.db`
- Logs: `~/.autoimprove/logs/`
- Documentation: Project README.md

## Token Budget Considerations

This skill prioritizes actionable guidance over exhaustive documentation. The MCP server provides detailed tool schemas on-demand. When using AutoImprove:
- Search is fast (<10ms typically) - don't skip it
- Rule content is fetched lazily - request only what you need
- Incremental analysis minimizes redundant processing
EOF

echo -e "${GREEN}✓${NC} Skill file created: $SKILL_FILE"

echo ""

# ============================================================================
# 4. 创建 UI 元数据（agents/openai.yaml）
# ============================================================================

echo -e "${BLUE}--- Codex: 创建 UI 元数据 ---${NC}"

cat > "$OPENAI_YAML" << 'EOF'
display_name: AutoImprove
short_description: Learn from patterns, prevent recurring issues
default_prompt: Search for coding patterns and best practices relevant to my current task
EOF

echo -e "${GREEN}✓${NC} UI metadata created: $OPENAI_YAML"

echo ""

# ============================================================================
# 5. 复制 Guidance 模板到存储目录（Codex 用不到但兼容 Claude）
# ============================================================================

echo -e "${BLUE}--- Codex: 复制 Guidance 模板 ---${NC}"

AUTOIMPROVE_GUIDANCE="$AUTOIMPROVE_DIR/guidance.md"
if [ -f "$GUIDANCE_TEMPLATE" ]; then
    cp "$GUIDANCE_TEMPLATE" "$AUTOIMPROVE_GUIDANCE"
    echo -e "${GREEN}✓${NC} Guidance template copied to: $AUTOIMPROVE_GUIDANCE"
else
    echo -e "${YELLOW}⚠${NC} Guidance template not found, skipping"
fi

echo ""

echo -e "${GREEN}✓ Codex setup complete${NC}"
echo ""
