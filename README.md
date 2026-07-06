# AutoImprove - AI-Powered Code Learning System

<div align="center">

![AutoImprove Logo](https://img.shields.io/badge/AutoImprove-Learn%20From%20Your%20Code-blue?style=for-the-badge)

**An MCP server that learns from user corrections and generates reusable coding rules**

[Features](#features) • [Quick Start](#quick-start) • [Installation](#installation) • [Usage](#usage) • [Architecture](#architecture) • [Documentation](#documentation)

</div>

---

## ✨ Features

- 🧠 **Pattern Detection** - Automatically detects corrections, anti-patterns, preferences, performance issues, and security problems
- 📚 **Rule Generation** - Converts detected patterns into reusable coding rules with confidence scoring
- 🎯 **Scene-Based Matching** - 3D scene model (tech stack + functional domain + business domain) for O(1) rule lookups
- 🔄 **Incremental Analysis** - Efficient session analysis with caching and smart change detection
- 💾 **Persistent Storage** - User-level rule database at `~/.autoimprove/` with indexed search
- 🤖 **LLM Enhancement** - Token-optimized LLM prompts for high-quality rule generation (68% token reduction)
- 🎨 **Multi-Platform** - Native support for both Claude Code and Codex

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** (primary requirement for TypeScript implementation)
- **Claude Code CLI** or **Codex CLI** (at least one platform)

### One-Command Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/autoimprove.git
cd autoimprove

# Setup both platforms (default)
./setup.sh

# Or setup specific platform
./setup.sh claude    # For Claude Code only
./setup.sh codex     # For Codex only
```

## 📦 Installation

### Automatic Setup (Recommended)

The `setup.sh` script will:
1. Build the TypeScript MCP server and Skills
2. Configure MCP server for your platform(s)
3. Install Skills to platform directories
4. Initialize storage at `~/.autoimprove/`
5. Update global configuration files

```bash
# Setup both platforms (default)
./setup.sh

# Setup specific platform
./setup.sh claude    # Claude Code only
./setup.sh codex     # Codex only

# Show help
./setup.sh --help
```

### Manual Setup

<details>
<summary>Click to expand manual setup instructions</summary>

#### 1. Build MCP Server

```bash
cd src/mcp-server-ts
npm install
npm run build
```

#### 2. Build Skills

```bash
cd src/skills-ts
npm install
npm run build
```

#### 3. Configure Claude Code

```bash
# Add MCP server (user-level, visible in all projects)
claude mcp add autoimprove-core -s user -- node /path/to/autoimprove/src/mcp-server-ts/dist/index.js

# Copy skills
cp -r src/skills-ts/src/autoimprove-* ~/.claude/skills/

# Update ~/.claude/CLAUDE.md with guidance from templates/claude-guidance-template.md
```

#### 4. Configure Codex

```bash
# Create Codex directories
mkdir -p ~/.codex/skills/autoimprove

# Copy MCP settings
cp templates/codex-mcp-settings.json ~/.codex/mcp_settings.json

# Copy guidance
cp templates/claude-guidance-template.md ~/.codex/guidance.md

# Copy skill file
cp templates/codex-skill.md ~/.codex/skills/autoimprove/skill.md
```

#### 5. Initialize Storage

```bash
mkdir -p ~/.autoimprove/rules/content
mkdir -p ~/.autoimprove/sessions
mkdir -p ~/.autoimprove/cache

# Create initial config
cp templates/config.json ~/.autoimprove/config.json
cp templates/rules-index.json ~/.autoimprove/rules/index.jso`

</details>

## 💻 Usage

### Primary Workflow

AutoImprove runs automatically when you work with Claude Code or Codex. The system:
1. **Monitors** your conversations for corrections and patterns
2. **Analyzes** sessions to detect 5 pattern types (corrections, anti-patterns, preferences, performance, security)
3. **Generates** reusable rules with confidence scoring
4. **Applies** learned rules to future work via `search_knowledge`

### Available Skills

#### Claude Code

After running `./setup.sh` or `./setup.sh claude`:

```bash
# Check system status
/autoimprove-status

# Analyze sessions and generate rules
/autoimprove-summarize

# Manage rules
/autoimprove-rules

# View learned lessons
/autoimprove-lessons
```

#### Codex

After running `./setup.sh codex`:

```bash
# Search knowledge base
/autoimprove-search <keywords>

# Add new rule
/autoimprove-add-rule <title> <content> <tags>

# List all rules
/autoimprove-list

# Sync knowledge
/autoimprove-sync
```

### Automatic Integration

The setup script configures AutoImprove guidance in your global configuration:

- **Claude Code**: `~/.claude/CLAUDE.md` includes AutoImprove instructions
- **Codex**: `~/.codex/guidance.md` includes AutoImprove instructions

This ensures Claude automatically:
- Calls `search_knowledge` before write/edit/debug operations
- Reviews matched rules before applying fixes
- Cites rule IDs in responses (e.g., "Following RULE-008...")

### MCP Tools (Direct Access)

The MCP server provides 40+ tools accessible via Claude:

**Core Analysis:**
- `analyze_session` - Detect patterns from session files
- `generate_rules` - Convert patterns to rules
- `search_knowledge` - Find applicable rules by scene/keywords

**Rule Management:**
- `update_rules` - Modify existing rules
- `assess_rule_quality` - Quality scoring
- `detect_rule_conflicts` - cting rules

**Feedback System:**
- `record_feedback` - Track rule usage (used/ignored/corrected/disabled)
- `get_feedback_stats` - Analyze feedback patterns
- `get_rule_usage_stats` - Multi-dimensional statistics

**Batch Operations:**
- `batch_rebuild` - Rebuild all rules from sessions
- `cleanup_existing_rules` - Merge duplicates, optimize low-quality rules

See `docs/MCP_TOOLS_API.md` for complete API reference.

## ⚙️ Configuration

### Storage Structure

AutoImprove uses `~/.autoimprove/` for all persistent data:

```
~/.autoimprove/
├── config.json                 # User configuration
├── rules/
│   ├── index.json         # Rule metadata (fast lookups)
│   ├── content/               # Full rule markdown files
│   └── claude-index.md        # Auto-exported top rules
├── sessions/                   # Analyzed session metadata
├── cache/                      # Analysis cache
├── logs/                       # System logs
├── feedback_history.jsonl     # Rule usage tracking
├── signal_dictionary/
│   └── signals.db             # SQLite signal patterns
└── versions/                   # Rule version history
```

### Platform Configuration

#### Claude Code (`~/.claude/`)

```
~/.claude/
├── CLAUDE.md                   # Global instructions (AutoImprove guidance injected here)
├── skills/
│   ├── autoimprove-status/
│   ├── autoimprove-summarize/
│   ├── autoimprove-rules/
│   └── autoimprove-lessons/
└── settings.json               # MCP server config (managed via `claude mcp` CLI)
```

Verify MCP configuration:
```bash
claude mcp list
# Expected: autoimprove-core: node ... - ✓ Connected
```

#### Codex (`~/.codex/`)

```
~/.codex/
├── guidance.md                 # Global instructions (AutoImprove guidance)
├── mcp_settings.json          # MCP server configuration
└── skills/autoimprove/
    └── skill.md               # Skill commands
```

### User Configuration

Edit `~/.autoimprove/config.json`:

```json
{
  "version": "1.0",
  "confidence_thresholds": {
    "repeated-correction": 0.6,
    "anti-pattern": 0.7,
    "preference": 0.5,
    "performance": 0.75,
    "security": 0.8
  },
  "confidence_weights": {
    "frequency": 0.3,
    "time_span": 0.1,
    "user_behavior": 0.4,
    "validation": 0.2
  },
  "rule_matching": {
    "max_results": 10,
    "min_relevance": 0.3
  },
  "business_domain_mappings": {
    "payment": ["checkout", "billing", "invoice"],
    "analytics": ["tracking", "metrics", "reporting"]
  }
}
```

### Environment Variables

Optional environment variables (`.env` or shell):

```bash
# LLM Enhancement (optional, requires ANTHROPIC_API_KEY for Phase 2)
ANTHROPIC_API_KEY=sk-ant-...

# Logging
LOG_LEVEL=info              # debug, info, warn, error
AUTOIMPROVE_LOG_DIR=~/.autoimprove/logs

# Storage
AUTOIMPROVE_DIR=~/.autoimprove
```

## 🏗️ Architecture

### Project Structure

```
autoimprove/
├── setup.sh                    # Unified setup (claude/codex/all)
├── setup_claude.sh            # Claude Code setup
├── setup_codex.sh             # Codex setup
├── src/
│   ├── mcp-server-ts/         # TypeScript MCP Server
│   │   ├── src/
│   │   │   ├── index.ts       # MCP server entry (tool/resource handlers)
│   │   │   ├── core/          # Business logic
│   │   │   │   ├── session-analyzer.ts        # Pattern detection
│   │   │   │   ├── hybrid-rule-generator.ts   # 4-phase rule generation
│   │   │   │   ├── llm-rule-generator.ts      # LLM enhancement
│   │   │   │   ├── indexed-rule-matcher.ts    # O(1) rule lookups
│   │   │   │   └── enhanced-scene-detector.ts # 3D scene model
│   │   │   └── storage/       # Persistence layer
│   │   │       ├── rule-index.ts              # In-memory index
│   │   │       ├── session-analysis-tracker.ts # Cache management
│   │   │       └── init.ts                     # Storage initialization
│   │   ├── tests/             # Vitest test suite
│   │   └── package.json
│   └── skills-ts/             # Platform Skills
│       └── src/
│           ├── autoimprove-status/
│           ├── autoimprove-summarize/
│           ├── autoimprove-rules/
│           └── autoimprove-lessons/
├── templates/                  # Configuration templates
│   ├── claude-guidance-template.md
│   ├── config.json
│   └── rules-index.json
├── scripts/                    # Utility scripts
│   └── init-claude-index.js
└── docs/                       # Documentation
    ├── COMPLETE_SUMMARY.md
    ├── HYBRID_RULE_GENERATION.md
    ├── TOKEN_OPTIMIZATION_ANALYSIS.md
    └── MCP_TOOLS_API.md
```

### Two-Layer Design

```
┌─────────────────────────────────────────┐
│  Skills (UI Layer)                      │
│  • Thin wrappers around MCP tools       │
│  • Platform-specific commands           │
│  • /autoimprove-* slash commands        │
└─────────────┬───────────────────────────┘
              │
              ↓ MCP Protocol
┌─────────────────────────────────────────┐
│  MCP Server (Logic Layer)               │
│  • Pattern detection                    │
│  • Rule generation (4-phase hybrid)     │
│  • Scene-based matching                 │
│  • Feedback tracking                    │
└─────────────┬───────────────────────────┘
              │
              ↓ File I/O
┌─────────────────────────────────────────┐
│  Storage (~/.autoimprove/)              │
│  • Rule index (fast metadata)           │
│  • Content files (lazy-loaded)          │
│  • Session cache & analysis records     │
│  • Feedback history (JSONL)             │
└─────────────────────────────────────────┘
```

### Key Components

**Session Analyzer** (`core/session-analyzer.ts`):
- Parses Claude Code/Codex session JSONL files
- Detects 5 pattern types using 8-class noise filtering
- Incremental analysis with smart change detection

**Hybrid Rule Generator** (`core/hybrid-rule-generator.ts`):
- **Phase 1**: Basic detection (regex + heuristics)
- **Phase 2**: LLM enhancement (token-optimized, optional)
- **Phase 3**: Code extraction (mines tool calls for before/after)
- **Phase 4**: Structured storage (6-section markdown format)

**Scene Detector** (`core/enhanced-scene-detector.ts`):
- 3D model: tech stack + functional domain + business domain
- Auto-detection from file extensions, keywords, directories
- Overlap scoring for relevance ranking

**Rule Matcher** (`core/indexed-rule-matcher.ts`):
- O(1) lookups via indexed metadata
- Scene-based filtering with fuzzy matching
- Confidence-weighted ranking

**Storage System** (`storage/`):
- In-memory rule index for fast queries
- Lazy-loaded content files (markdown)
- Versioning and feedback tracking
- SQLite signal dictionary (v2.2+)

## 🔧 Development

### Building from Source

```bash
# Build MCP Server
cd src/mcp-server-ts
npm install
npm run build

# Build Skills
cd src/skills-ts
npm install
npm run build
```

### Running Tests

```bash
cd src/mcp-server-ts

# Run all tests
npm test

# Watch mode
npm run test:watch

# UI mode (Vitest UI)
npm run test:ui

# Run specific test file
npm test -- tests/scene-detection.test.ts
```

### Development Server

```bash
# Run with hot reload
cd src/mcp-server-ts
npm run dev

# After code changes, rebuild and restart
npm run build
claude mcp restart autoimprove-core
```

### Adding New Pattern Types

1. Add to `PatternType` enum in `core/models.ts`
2. Implement `detect*Patterns()` in `core/session-analyzer.ts`
3. Add confidence threshold in `storage/init.ts`
4. Update priority logic in `core/rule-generator.ts`
5. Add tests in `tests/core.test.ts`

### Adding New MCP Tools

1. Add schema to `ListToolsRequestSchema` handler in `index.ts`
2. Implement handler function
3. Add case to `CallToolRequestSchema` switch
4. Update `docs/MCP_TOOLS_API.md`
5. Add skill wrapper if user-facing

### Code Style

- TypeScript with strict mode
- ESLint + Prettier for formatting
- Comprehensive JSDoc comments for public APIs
- Vitest for unit testing

## 🐛 Troubleshooting

<details>
<summary>Common Issues and Solutions</summary>

### Issue: MCP Server Won't Start

**Solution**:
```bash
# Check MCP server status
claude mcp list

# Restart the server
claude mcp restart autoimprove-core

# Check logs
tail -f ~/.autoimprove/logs/server.log
```

### Issue: Skill Not Found in Claude Code

**Solution**:
```bash
# Re-run setup for Claude
./setup.sh claude

# Verify skills are installed
ls ~/.claude/skills/autoimprove-*

# Check MCP configuration
claude mcp get autoimprove-core
```

### Issue: Codex Integration Fails

**Solution**:
```bash
# Check Codex installation
codex --version

# Verify MCP settings
cat ~/.codex/mcp_settings.json

# Check guidance file
cat ~/.codex/guidance.md | grep -A 5 "AUTOIMPROVE"
```

### Issue: Build Fails After Update

**Solution**:
```bash
# Clean and rebuild MCP server
cd src/mcp-server-ts
rm -rf dist node_modules
npm install
npm run build

# Clean and rebuild skills
cd src/skills-ts
rm -rf node_modules
npm install
npm run build
```

### Issue: No Patterns Detected

**Solution**:
```bash
# Enable debug logging
# Edit src/mcp-server-ts/src/core/logger.ts
# Set LOG_LEVEL = "debug"

# Rebuild and restart
cd src/mcp-server-ts
npm run build
claude mcp restart autoimprove-core

# Check session files contain corrections
ls -lh ~/.claude/sessions/
```

### Issue: Rules Not Auto-Loading

**Solution**:
```bash
# Verify guidance is in CLAUDE.md
grep -A 10 "AUTOIMPROVE_START" ~/.claude/CLAUDE.md

# Re-run setup to fix
./setup.sh claude

# Export rules manually
/autoimprove-rules export
```

</details>

## 📚 Documentation

- **[COMPLETE_SUMMARY.md](docs/COMPLETE_SUMMARY.md)** - Comprehensive feature documentation
- **[HYBRID_RULE_GENERATION.md](docs/HYBRID_RULE_GENERATION.md)** - 4-phase generation implementation
- **[TOKEN_OPTIMIZATION_ANALYSIS.md](docs/TOKEN_OPTIMIZATION_ANALYSIS.md)** - Token reduction strategy
- **[MCP_TOOLS_API.md](docs/MCP_TOOLS_API.md)** - Complete MCP tools reference
- **[CLAUDE.md](CLAUDE.md)** - Project instructions for Claude Code

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol) for the MCP specification
- [Claude Code](https://claude.ai/code) for the platform integration
- [Anthropic](https://www.anthropic.com) for Claude AI models

## 📬 Contact & Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/autoimprove/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/autoimprove/discussions)

---

<div align="center">

**Learn from your code, improve with every change**

[⬆ Back to Top](#autoimprove---ai-powered-code-learning-system)

</div>
