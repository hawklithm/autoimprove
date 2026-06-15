# AutoImprove

[![CI](https://github.com/yourusername/autoimprove/actions/workflows/ci.yml/badge.svg)](https://github.com/yourusername/autoimprove/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/yourusername/autoimprove/actions/workflows/publish.yml/badge.svg)](https://github.com/yourusername/autoimprove/actions/workflows/publish.yml)
[![npm version](https://badge.fury.io/js/autoimprove.svg)](https://www.npmjs.com/package/autoimprove)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

Learn coding patterns from Claude Code sessions and generate reusable rules.

## Overview

AutoImprove analyzes your Claude Code sessions to detect patterns in corrections, preferences, and best practices. It automatically generates rules that Claude will follow in future sessions, reducing repetitive corrections and improving consistency.

**✨ New in v0.2.0**: 
- Rules are **automatically loaded** into every Claude Code session through `~/.claude/CLAUDE.md` reference
- **npm-installable package** with CLI commands for easy setup and management

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

- **🆕 Automatic Rule Loading**: Top rules are automatically loaded into every Claude Code session
  - Rules exported to `~/.autoimprove/rules/claude-index.md`
  - Referenced from `~/.claude/CLAUDE.md` (global)
  - Category-balanced selection (security, corrections, anti-patterns, performance, preferences)
  - Low token cost (~400 tokens for top 10 rules)

- **🆕 Automatic Feedback Recording**: Tracks rule usage automatically
  - Auto-records when rules are queried (方案1)
  - Claude actively records detailed feedback (方案2)
  - Stores feedback in `~/.autoimprove/feedback_history.jsonl`
  - Supports 4 feedback types: used, ignored, corrected, disabled

- **🆕 Usage Statistics & Analytics**: Multi-dimensional rule usage analysis
  - Statistics by category, scene, priority, time
  - Top rules ranking with ratings
  - Problematic rules identification (high ignore/correct rate)
  - Both MCP tool and CLI script available

- **MCP Server**: MCP-based server with tools and resources (TypeScript)
  - `analyze_session` - Analyze session patterns
  - `generate_rules` - Generate rules from patterns
  - `export_rules_to_claude_md` - Export top rules to Claude index
  - `search_knowledge` - Search rules (🆕 auto-records feedback)
  - `record_feedback` - 🆕 Record rule usage feedback
  - `get_feedback_stats` - 🆕 Get feedback statistics
  - `get_rule_usage_stats` - 🆕 Multi-dimensional usage statistics
  - `update_rules` - Update existing rules
  - `list_scenes` - List known scenes
  - `knowledge://rules/{id}` - Get rule content
  - `knowledge://lessons/{scene}` - Get lessons for scene

## Installation

### Prerequisites

- **Node.js 18+** - Required for building and running the MCP server
- **Claude Code** - CLI, Desktop, or Web version

### Quick Setup (Recommended)

Run the automated setup script from the project root:

```bash
./setup.sh
```

This will automatically:
1. ✅ Install and build MCP Server (TypeScript)
2. ✅ Build Skills (TypeScript)
3. ✅ Configure Claude Code MCP Server (user-level, **available in all projects**)
4. ✅ Install Skills to `~/.claude/skills/`
5. ✅ Initialize storage directory at `~/.autoimprove/`
6. ✅ Configure automatic rule loading in `~/.claude/CLAUDE.md`
7. ✅ 🆕 Configure automatic feedback recording in `~/.claude/CLAUDE.md`

**Configuration Scope**: The setup script configures `autoimprove-core` as a **user-level MCP server**, making it accessible from any project directory. You only need to run setup once.

**Automatic Rule Loading**: Setup adds a reference to `~/.autoimprove/rules/claude-index.md` in your global `~/.claude/CLAUDE.md`, ensuring top rules are automatically loaded in every Claude Code session.

**Automatic Feedback Recording**: Setup copies feedback instructions to `~/.claude/autoimprove-feedback-instructions.md` and adds a reference in `~/.claude/CLAUDE.md`, enabling Claude to actively record rule usage feedback.

### Verify Installation

After setup completes:

```bash
# Check MCP server status
claude mcp list

# Test with a skill
/autoimprove-status
```

### Development: Restarting MCP Server

After modifying MCP server code, restart the server to load changes:

```bash
# Quick restart (no rebuild)
./restart-mcp.sh

# Rebuild and restart
./restart-mcp.sh --build
```

The restart script will:
1. Stop existing MCP server processes
2. Re-register the server with Claude Code
3. Verify the new configuration
4. Test server startup

**Note**: If the server still shows old behavior after restart, start a new Claude Code conversation.
autoimprove status

# View existing rules
autoimprove rules

# Or check MCP server directly
claude mcp list
# Expected output:
# autoimprove-core: node .../dist/index.js - ✓ Connected
```

### Manual Setup (Development)

If you're developing AutoImprove from source:

```bash
# Clone repository
git clone <repo-url>
cd autoimprove

# Install dependencies
npm install

# Build
npm run build

# Link for local testing
npm link

# Run setup
autoimprove setup
```

## Quick Start

### 1. Verify Installation

```bash
# Check system health
autoimprove status

# View existing rules
autoimprove rules
```

### 2. Start Using Claude Code

Rules will automatically load into every Claude Code session. Just start coding normally!

### 3. Analyze Sessions

After coding, extract patterns from your session:

```bash
# In Claude Code
/autoimprove-summarize
```

Or use other skills:
```bash
/autoimprove-status      # Check system health and statistics
/autoimprove-rules       # View detailed rules with filtering
/autoimprove-lessons     # View learned lessons
```

### 4. Manage Rules from CLI

```bash
# View all rules
autoimprove rules

# Filter by category
autoimprove rules --category security

# Filter by confidence
autoimprove rules --min-confidence 0.7

# Filter by priority
autoimprove rules --priority critical
```

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

## CLI Commands

### `autoimprove setup`

Install and configure AutoImprove MCP server and skills.

**Options**:
- `--force` - Force reinstall even if already configured

### `autoimprove status`

Check system health and statistics:
- Storage status and rule counts
- MCP server registration
- Skills installation
- Configuration status

### `autoimprove rules`

View and manage knowledge rules.

**Options**:
- `--category <type>` - Filter by category (security, performance, preference, etc.)
- `--min-confidence <number>` - Minimum confidence threshold (0-1)
- `--priority <level>` - Filter by priority (critical, high, medium, low)

**Example**:
```bash
autoimprove rules --category security --min-confidence 0.7
```

### `autoimprove summarize`

Guide for analyzing sessions. Use the `/autoimprove-summarize` skill in Claude Code instead.

**Options**:
- `--all` - Analyze all historical sessions
- `--enhance` - Use AI enhancement for better rule quality
- `--force` - Force reanalysis of already-analyzed sessions
- `--min-confidence <number>` - Minimum confidence threshold

## Development

### Building from Source

```bash
# Clone repository
git clone <repo-url>
cd autoimprove

# Install dependencies
npm install

# Build
npm run build

# Test locally
npm link
```

### Project Structure

```
autoimprove/
├── bin/                      # CLI entry point
│   └── autoimprove.js
├── src/
│   ├── cli/                  # CLI implementation
│   │   ├── commands/         # Command implementations
│   │   └── index.ts          # Commander.js setup
│   ├── mcp-server-ts/        # MCP server
│   │   └── src/
│   │       ├── tools/        # MCP tools
│   │       └── index.ts      # Server entry
│   └── skills-ts/            # Claude Code skills
│       └── src/
├── templates/                # Template files
├── package.json
└── tsconfig.json
```

## Troubleshooting

### MCP Server Not Registered

```bash
autoimprove setup --force
```

### Rules Not Loading

Check that `~/.claude/CLAUDE.md` contains:
```markdown
@~/.autoimprove/rules/claude-index.md
```

If missing, run:
```bash
autoimprove setup --force
```

### Skills Not Available

Verify installation:
```bash
ls ~/.claude/skills/autoimprove-*
```

Reinstall if needed:
```bash
autoimprove setup --force
```

### Check System Status

```bash
# Comprehensive health check
autoimprove status

# Check MCP server directly
claude mcp get autoimprove-core
```

### No Patterns Detected

- Ensure you made corrections during the session
- Try with more explicit corrections
- Verify patterns meet confidence thresholds in `~/.autoimprove/config.json`

### Rules Not Matching

- Check scene detection with `/autoimprove-status`
- Verify rule scenes match your current work (tech stack, functional domain)
- Adjust confidence thresholds in `~/.autoimprove/config.json`

### Configuration Scope Issues

If the server works in one project but not others:

```bash
# Check current scope
claude mcp get autoimprove-core

# Should show: "Scope: User config (available in all your projects)"
# If it shows "Local config", reinstall with:
autoimprove setup --force
```

## License

MIT License

## Version

Current version: 0.2.0

### Changelog

**v0.2.0** (2026-06-06)
- 🎉 npm-installable package with global CLI
- ✨ New `autoimprove` CLI commands: setup, status, rules, summarize
- 🔧 Automated setup with `autoimprove setup`
- 📦 Single-package distribution (no monorepo complexity)
- 🌍 Commander.js-based CLI framework
- 📄 Comprehensive README with npm installation guide

**v0.1.0** (Initial Release)
- MCP server with TypeScript implementation
- Pattern detection and rule generation
- Automatic rule loading via CLAUDE.md
- Skills for Claude Code integration
- Feedback recording system
- Multi-dimensional usage statistics