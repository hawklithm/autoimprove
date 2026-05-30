# AutoImprove

Learn coding patterns from Claude Code sessions and generate reusable rules.

## Overview

AutoImprove analyzes your Claude Code sessions to detect patterns in corrections, preferences, and best practices. It automatically generates rules that Claude will follow in future sessions, reducing repetitive corrections and improving consistency.

## Features

- **Pattern Detection**: Identifies 5 types of patterns
  - Repeated corrections
  - Anti-patterns
  - User preferences
  - Performance optimizations
  - Security issues

- **Confidence Scoring**: Uses v2.0 formula with weighted components
  - Frequency (30%)
  - Time span (10%)
  - User behavior (40%)
  - Validation (20%)

- **Scene-Based Matching**: Three-dimensional scene model
  - Tech stack (React, Python, etc.)
  - Functional domain (auth, api, etc.)
  - Business domain (e-commerce, finance, etc.)

- **MCP Server**: FastMCP-based server with 5 tools and 2 resources

- **Skills**: 4 interactive skills for Claude Code
  - `/autoimprove-status` - System status
  - `/autoimprove-summarize` - Analyze session
  - `/autoimprove-rules` - Review rules
  - `/autoimprove-lessons` - View applicable rules

## Installation

### Prerequisites

- Python 3.10+
- Claude Code (CLI, Desktop, or Web)

### Install MCP Server

```bash
cd src/mcp-server
pip install -e .
```

### Install Skills

```bash
# Copy skills to Claude Code skills directory
cp -r src/skills/* ~/.claude/skills/
```

### Quick Setup (推荐)

运行自动初始化脚本：

```bash
./setup.sh
```

这会自动完成：
- 安装 MCP Server 依赖
- 配置 Claude Code
- 创建 Skills 符号链接
- 初始化存储目录

### Manual Setup

**方法 1: 使用配置文件**

编辑 `~/.claude/config.json`（**替换 `<PROJECT_ROOT>` 为实际路径**）：

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "python3",
      "args": [
        "<PROJECT_ROOT>/src/mcp-server/server.py"
      ],
      "env": {
        "PYTHONPATH": "<PROJECT_ROOT>/src/mcp-server"
      }
    }
  }
}
```

**方法 2: 使用 Desktop App**

Settings → MCP Servers → Add Server

详细配置说明见 [MCP 自动启动文档](docs/MCP_AUTO_START.md)

## Quick Start

### 1. Initialize

```bash
# Run in Claude Code
/autoimprove-status
```

This initializes storage at `~/.autoimprove/`.

### 2. Complete a Coding Session

Work with Claude Code as usual. Make corrections, express preferences, fix bugs.

### 3. Analyze Session

```bash
/autoimprove-summarize
```

This analyzes the session and generates rules.

### 4. Review Rules

```bash
/autoimprove-rules
```

Review and activate generated rules.

### 5. View Lessons

```bash
/autoimprove-lessons
```

See rules applicable to your current scene.

## Architecture

```
┌─────────────────────────────────────────────┐
│              AutoImprove System              │
├─────────────────────────────────────────────┤
│                                             │
│  Skills (User Interface)                    │
│  ├─ /autoimprove-status                     │
│  ├─ /autoimprove-summarize                  │
│  ├─ /autoimprove-rules                      │
│  └─ /autoimprove-lessons                    │
│         ↓                                   │
│  MCP Server (Core Logic)                    │
│  ├─ Tools                                   │
│  │  ├─ analyze_session                      │
│  │  ├─ generate_rules                       │
│  │  ├─ search_knowledge                     │
│  │  ├─ update_rules                         │
│  │  └─ list_scenes                          │
│  ├─ Resources                               │
│  │  ├─ knowledge://rules/{id}               │
│  │  └─ knowledge://lessons/{scene}          │
│  └─ Storage (~/.autoimprove/)               │
│      ├─ rules/index.json                    │
│      ├─ rules/content/*.md                  │
│      └─ sessions/*.json                     │
│                                             │
└─────────────────────────────────────────────┘
```

## Storage Structure

```
~/.autoimprove/
├── config.json              # Configuration
├── rules/
│   ├── index.json          # Rule metadata (fast loading)
│   └── content/            # Full rule content
│       ├── rule-001.md
│       ├── rule-002.md
│       └── ...
├── sessions/               # Session archives
│   └── {session_id}.json
└── cache/                  # Temporary cache
```

## Configuration

Edit `~/.autoimprove/config.json`:

```json
{
  "version": "1.0",
  "confidence_thresholds": {
    "repeated_correction": 0.45,
    "anti_pattern": 0.45,
    "preference": 0.3,
    "performance": 0.4,
    "security": 0.3
  },
  "confidence_weights": {
    "frequency": 0.3,
    "time_span": 0.1,
    "behavior": 0.4,
    "validation": 0.2
  },
  "rule_matching": {
    "max_results": 10,
    "min_confidence": 0.3
  },
  "business_domain_mappings": {
    "src/shop": "e-commerce",
    "src/crm": "crm"
  }
}
```

## Development

### Run Tests

```bash
cd src/mcp-server
pytest tests/ -v
```

### Run MCP Server Locally

```bash
cd src/mcp-server
python server.py
```

### Run Skills Locally

```bash
cd src/skills/autoimprove-status
python skill.py
```

## Troubleshooting

### Storage not initialized

Run `/autoimprove-status` to initialize.

### No patterns detected

- Ensure you made corrections during the session
- Check that session file exists
- Try with more explicit corrections

### Rules not matching

- Check scene detection with `/autoimprove-status`
- Verify rule scenes match your current work
- Adjust confidence thresholds in config

### MCP Server not responding

- Check MCP configuration
- Verify server is running
- Check logs at `~/.autoimprove/logs/`

## License

MIT License

## Version

Current version: 0.1.0