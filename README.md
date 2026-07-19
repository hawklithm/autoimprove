# AutoImprove - AI-Powered Code Learning System

<div align="center">

![AutoImprove Logo](https://img.shields.io/badge/AutoImprove-Learn%20From%20Your%20Code-blue?style=for-the-badge)

**An MCP server that learns from user corrections and generates reusable coding rules — continuously improving your development workflow**

[Features](#features) • [Quick Start](#quick-start) • [Installation](#installation) • [Usage](#usage) • [Architecture](#architecture) • [Documentation](#documentation)

</div>

---

## ✨ Features

- 🧠 **Pattern Detection** — Automatically detects corrections, anti-patterns, preferences, performance issues, and security problems from Claude Code / Codex sessions
- 📚 **Hybrid Rule Generation** — 4-phase pipeline (heuristic + LLM + code extraction + structured storage) with template-based rule generation for consistent, high-quality rules
- 🎯 **Scene-Based Matching** — 3D scene model (tech stack + functional domain + business domain) for O(1) rule lookups with overlap scoring
- 🔄 **Incremental Analysis** — Efficient session analysis with caching, smart change detection, and adaptive session analyzer
- 💾 **Persistent Storage** — User-level rule database at `~/.autoimprove/` with SQLite-backed rule storage, signal dictionary, and version control
- 🤖 **LLM Enhancement** — Token-optimized LLM prompts (68% token reduction) with batch processing, configurable model selection, and automatic fallback on failure
- 🎨 **Multi-Platform** — Native support for both Claude Code and Codex
- 🧩 **Proactive Rule Loading** — Automatic knowledge retrieval before edits with `search_knowledge` guidance
- 🔁 **Feedback System** — Track rule usage (used/ignored/corrected/disabled) with adaptive confidence scoring
- 🧪 **Local ML Enhancement** — CPU-only embedding encoder (char-ngram-tfidf) and message clustering for offline pattern recognition

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

# Show help
./setup.sh --help
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
cp templates/rules-index.json ~/.autoimprove/rules/index.json
```

</details>

## 💻 Usage

### Primary Workflow

AutoImprove runs automatically when you work with Claude Code or Codex. The system:
1. **Monitors** your conversations for corrections and patterns
2. **Analyzes** sessions to detect 5 pattern types (corrections, anti-patterns, preferences, performance, security)
3. **Generates** reusable rules with confidence scoring
4. **Applies** learned rules to future work via `search_knowledge`

`search_knowledge` is a first-step replacement for guessing local conventions: query it when implementing, fixing, debugging, or refactoring instead of inferring patterns from several files. If the knowledge base is still empty, it responds with next steps rather than an error.

### Available Skills

#### Claude Code

After running `./setup.sh` or `./setup.sh claude`:

```bash
# Check system status and statistics
/autoimprove-status

# Analyze sessions and generate rules (via CLI script)
npm run summarize

# Manage and review generated rules
/autoimprove-rules

# View learned lessons applicable to current work scene
/autoimprove-lessons

# Proactively check applicable rules before editing (call before any task)
/autoimprove-check
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
- Calls `search_knowledge` instead of guessing conventions for write/edit/debug operations
- Reviews matched rules before applying fixes
- Cites rule IDs in responses (e.g., "Following RULE-008...")

### MCP Tools (Direct Access)

The MCP server provides 40+ tools accessible via Claude:

**Core Analysis:**
- `analyze_session` — Detect patterns from session files
- `generate_rules` — Convert patterns to rules
- `search_knowledge` — Find applicable rules by scene/keywords
- `batch_rebuild` — Rebuild all rules from sessions with consistency checks

**Rule Management:**
- `update_rules` — Modify existing rules
- `assess_rule_quality` — Quality scoring with Bayesian confidence updates
- `detect_rule_conflicts` — Detect conflicting rules
- `cleanup_existing_rules` — Merge duplicates, optimize low-quality rules

**Template System:**
- `generate_rule_templates` — Create rule templates from existing rules
- `apply_rule_template` — Apply templates to generate new rules

**Feedback System:**
- `record_feedback` — Track rule usage (used/ignored/corrected/disabled)
- `get_feedback_stats` — Analyze feedback patterns
- `get_rule_usage_stats` — Multi-dimensional statistics

**Batch Operations:**
- `batch_llm_generate_rules` — Batch LLM-powered rule generation with scene clustering
- `batch_rebuild` — Rebuild all rules from sessions
- `cleanup_existing_rules` — Merge duplicates, optimize low-quality rules

**Advanced Features:**
- `extract_signals` — Extract signal patterns from sessions
- `match_similar_patterns` — Find similar patterns across sessions
- `personalize_rules` — Personalize rules based on user behavior

See `docs/MCP_TOOLS_API.md` for complete API reference.

## ⚙️ Configuration

### Storage Structure

AutoImprove uses `~/.autoimprove/` for all persistent data:

```
~/.autoimprove/
├── config.json                  # User configuration
├── rules/
│   ├── index.json               # Rule metadata (fast lookups)
│   ├── content/                 # Full rule markdown files
│   ├── claude-index.md          # Auto-exported top rules
│   └── rules.db                 # SQLite rule storage (v2.2+)
├── sessions/                    # Analyzed session metadata
├── cache/                       # Analysis cache (embedding vectors, etc.)
├── logs/                        # System logs
├── feedback_history.jsonl       # Rule usage tracking
├── signal_dictionary/
│   └── signals.db               # SQLite signal patterns
├── versions/                    # Rule version history
├── templates/                   # Rule templates
└── pattern-evolution/           # Pattern evolution tracking
```

### Platform Configuration

#### Claude Code (`~/.claude/`)

```
~/.claude/
├── CLAUDE.md                   # Global instructions (AutoImprove guidance injected here)
├── skills/
│   ├── autoimprove-status/
│   ├── autoimprove-rules/
│   ├── autoimprove-lessons/
│   └── autoimprove-check/
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
│   ├── mcp-server-ts/         # TypeScript MCP Server (core)
│   │   ├── src/
│   │   │   ├── index.ts       # MCP server entry (tool/resource handlers)
│   │   │   ├── core/          # Business logic
│   │   │   │   ├── session-analyzer.ts            # Pattern detection
│   │   │   │   ├── adaptive-session-analyzer.ts   # Adaptive pattern analysis
│   │   │   │   ├── hybrid-rule-generator.ts       # 4-phase rule generation
│   │   │   │   ├── template-based-rule-generator.ts # Template-driven generation
│   │   │   │   ├── llm-rule-generator.ts          # LLM enhancement
│   │   │   │   ├── batch-llm-rule-generator.ts    # Batch LLM processing
│   │   │   │   ├── llm-prompt-builder.ts          # Token-optimized prompts
│   │   │   │   ├── llm-config-manager.ts          # LLM model configuration
│   │   │   │   ├── llm-failure-tracker.ts         # LLM fallback tracking
│   │   │   │   ├── llm-signal-extractor.ts        # Signal extraction via LLM
│   │   │   │   ├── indexed-rule-matcher.ts        # O(1) rule lookups
│   │   │   │   ├── enhanced-scene-detector.ts     # 3D scene model
│   │   │   │   ├── scene-extractor.ts             # Scene metadata extraction
│   │   │   │   ├── scene-thesaurus.ts             # Scene synonym mapping
│   │   │   │   ├── embedding-encoder.ts           # CPU-only text embeddings
│   │   │   │   ├── message-clusterer.ts           # Message similarity clustering
│   │   │   │   ├── pattern-clusterer.ts           # Pattern grouping
│   │   │   │   ├── pattern-similarity-clusterer.ts # Similarity-based clustering
│   │   │   │   ├── signal-matcher.ts              # Signal pattern matching
│   │   │   │   ├── neighbor-signal-matcher.ts     # Neighbor-based signal matching
│   │   │   │   ├── adaptive-confidence.ts         # Confidence scoring
│   │   │   │   ├── bayesian-confidence-updater.ts # Bayesian confidence updates
│   │   │   │   ├── personalizer.ts                # User behavior personalization
│   │   │   │   ├── rule-matcher.ts                # Rule matching engine
│   │   │   │   ├── rule-quality.ts                # Quality assessment
│   │   │   │   ├── rule-usage-stats.ts            # Usage statistics
│   │   │   │   ├── rule-deduplicator.ts           # Duplicate detection
│   │   │   │   ├── rule-cleanup-service.ts        # Rule maintenance
│   │   │   │   ├── rule-template-compiler.ts      # Template compilation
│   │   │   │   ├── template-executor.ts           # Template execution
│   │   │   │   ├── template-step-functions.ts     # Step function templates
│   │   │   │   ├── code-example-extractor.ts      # Code example mining
│   │   │   │   ├── json-extractor.ts              # JSON extraction/repair
│   │   │   │   ├── jsonl-parser.ts                # JSONL session parsing
│   │   │   │   ├── unified-session-parser.ts      # Multi-format session parser
│   │   │   │   ├── keyword-segment-index.ts       # Keyword indexing
│   │   │   │   ├── pre-filter.ts                  # Pre-filtering logic
│   │   │   │   ├── jieba-utils.ts                 # Chinese text segmentation
│   │   │   │   ├── models.ts                      # Type definitions
│   │   │   │   ├── logger.ts                      # Logging system
│   │   │   │   └── batch-rebuild.ts               # Batch rebuild engine
│   │   │   ├── storage/       # Persistence layer
│   │   │   │   ├── init.ts                        # Storage initialization
│   │   │   │   ├── rule-index.ts                  # In-memory index
│   │   │   │   ├── rule-content.ts                # Content management
│   │   │   │   ├── rule-storage-sqlite.ts         # SQLite-backed storage
│   │   │   │   ├── rule-version.ts                # Version control
│   │   │   │   ├── signal-dictionary-db.ts        # SQLite signal dictionary
│   │   │   │   ├── session-analysis-tracker.ts    # Cache management
│   │   │   │   ├── session-cache.ts               # Session caching
│   │   │   │   ├── compact-cache.ts               # Compact cache format
│   │   │   │   ├── pattern-evolution.ts           # Pattern evolution tracking
│   │   │   │   ├── migrate-to-sqlite.ts           # SQLite migration
│   │   │   │   ├── init-signal-dictionary.ts      # Signal dict initialization
│   │   │   │   └── session-archive.ts             # Session archiving
│   │   │   ├── tools/         # Tool implementations
│   │   │   │   └── export-rules-to-claude.ts      # Claude index export
│   │   │   ├── resources/     # MCP resources
│   │   │   │   └── proactive-rules.ts             # Proactive rule loading
│   │   │   ├── extractors/    # Session extractors
│   │   │   │   ├── claude-code-extractor.ts
│   │   │   │   ├── codex-extractor.ts
│   │   │   │   └── vscode-extractor.ts
│   │   │   ├── rule-templates/ # Rule template definitions
│   │   │   └── mcp-instructions.ts                # MCP server instructions
│   │   ├── tests/             # Vitest test suite (17+ test files)
│   │   └── package.json
│   ├── skills-ts/             # Platform Skills (UI layer)
│   │   └── src/
│   │       ├── autoimprove-status/
│   │       ├── autoimprove-rules/
│   │       ├── autoimprove-lessons/
│   │       ├── autoimprove-check/
│   │       └── mcp-client.ts
│   ├── cli/                   # CLI tools
│   │   ├── index.ts
│   │   └── commands/
│   └── utils/                 # Shared utilities
│       └── cli-logger.ts
├── templates/                  # Configuration templates
│   ├── claude-guidance-template.md
│   ├── claude-feedback-instructions.md
│   ├── config.json
│   └── rules-index.json
├── scripts/                    # Utility scripts
│   ├── init-claude-index.js
│   ├── batch-rebuild.js
│   ├── migrate-config.js
│   ├── rebuild-rules-direct.ts
│   ├── rule-usage-stats.ts
│   ├── check-migration.sh
│   ├── maintain-db.sh
│   ├── install-onnx-models.sh
│   ├── local-ml-ab-compare.mjs
│   ├── remove-console-logs.sh
│   └── test-template-config.mjs
└── docs/                       # Documentation (60+ documents)
    ├── COMPLETE_SUMMARY.md
    ├── HYBRID_RULE_GENERATION.md
    ├── TOKEN_OPTIMIZATION_ANALYSIS.md
    ├── MCP_TOOLS_API.md
    ├── LOCAL_ML_ENHANCEMENT_DESIGN.md
    ├── TRIGGER_MECHANISM_ANALYSIS.md
    └── ... (50+ additional docs)
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
- Adaptive analysis via `adaptive-session-analyzer.ts` for evolving patterns

**Hybrid Rule Generator** (`core/hybrid-rule-generator.ts`):
- **Phase 1**: Basic detection (regex + heuristics)
- **Phase 2**: LLM enhancement (token-optimized, optional with fallback)
- **Phase 3**: Code extraction (mines tool calls for before/after)
- **Phase 4**: Structured storage (6-section markdown format)

**Template-Based Rule Generator** (`core/template-based-rule-generator.ts`):
- Creates and applies rule templates from existing rules
- Compiles templates into executable step functions
- Enables consistent rule structure across the knowledge base

**Scene Detector** (`core/enhanced-scene-detector.ts`):
- 3D model: tech stack + functional domain + business domain
- Auto-detection from file extensions, keywords, directories
- Overlap scoring for relevance ranking
- Thesaurus-based synonym expansion (`scene-thesaurus.ts`)

**Rule Matcher** (`core/indexed-rule-matcher.ts`):
- O(1) lookups via indexed metadata
- Scene-based filtering with fuzzy matching
- Confidence-weighted ranking

**Local ML Enhancement** (`core/embedding-encoder.ts`, `core/message-clusterer.ts`):
- CPU-only char n-gram TF-IDF embeddings (no external API)
- Message clustering via TF-IDF similarity (solves merge/split problems)
- Optional ONNX model support (Phase 4)
- Works for multilingual content (Chinese/English mixed)

**Signal System** (`core/signal-matcher.ts`, `core/neighbor-signal-matcher.ts`):
- SQLite-backed signal dictionary (`storage/signal-dictionary-db.ts`)
- Pattern matching with neighbor context
- LLM-enhanced signal extraction (`llm-signal-extractor.ts`)

**Feedback & Confidence**:
- `adaptive-confidence.ts`: Confidence scoring with configurable weights
- `bayesian-confidence-updater.ts`: Bayesian updates from feedback
- `personalizer.ts`: Personalization based on user behavior
- `rule-usage-stats.ts`: Multi-dimensional usage analytics

**Storage System** (`storage/`):
- In-memory rule index for fast queries
- SQLite-backed rule storage (`rule-storage-sqlite.ts`)
- Lazy-loaded content files (markdown)
- Versioning and feedback tracking (`rule-version.ts`)
- Signal dictionary with SQLite (`signal-dictionary-db.ts`)
- Pattern evolution tracking (`pattern-evolution.ts`)
- Migration tooling (`migrate-to-sqlite.ts`)

**LLM Integration**:
- `llm-rule-generator.ts`: LLM-powered rule generation
- `batch-llm-rule-generator.ts`: Batch processing with scene clustering
- `llm-prompt-builder.ts`: Token-optimized prompt construction (68% reduction)
- `llm-config-manager.ts`: Flexible model/provider configuration
- `llm-failure-tracker.ts`: Automatic fallback on LLM failures
- `llm-signal-extractor.ts`: Signal extraction via LLM

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

# Build CLI
cd ../../
npm run build:cli

# Build all (from root)
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
3. Add confidence threshold in `storage/init.ts` or `adaptive-confidence.ts`
4. Update priority logic in `core/hybrid-rule-generator.ts`
5. Add tests in relevant test files under `src/mcp-server-ts/tests/`

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
- **[TOKEN_OPTIMIZATION_ANALYSIS.md](docs/TOKEN_OPTIMIZATION_ANALYSIS.md)** - Token reduction strategy (68% reduction)
- **[MCP_TOOLS_API.md](docs/MCP_TOOLS_API.md)** - Complete MCP tools reference
- **[LOCAL_ML_ENHANCEMENT_DESIGN.md](docs/LOCAL_ML_ENHANCEMENT_DESIGN.md)** - CPU-only ML enhancement design
- **[LOCAL_ML_ENHANCEMENT_TASKS.md](docs/LOCAL_ML_ENHANCEMENT_TASKS.md)** - ML enhancement implementation tasks
- **[BATCH_LLM_OPTIMIZATION.md](docs/BATCH_LLM_OPTIMIZATION.md)** - Batch LLM processing optimization
- **[SOP_COMPILER_ANALYSIS.md](docs/SOP_COMPILER_ANALYSIS.md)** - SOP/template compiler analysis
- **[TRIGGER_MECHANISM_ANALYSIS.md](docs/TRIGGER_MECHANISM_ANALYSIS.md)** - Trigger mechanism design
- **[ADAPTIVE_PATTERN_RECOGNITION.md](docs/ADAPTIVE_PATTERN_RECOGNITION.md)** - Adaptive pattern recognition
- **[PROACTIVE_RULE_LOADING.md](docs/PROACTIVE_RULE_LOADING.md)** - Proactive rule loading design
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
