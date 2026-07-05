# AutoImprove

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

**Learn from your coding sessions. Never repeat the same correction twice.**

AutoImprove is an intelligent MCP server for Claude Code that automatically learns from your coding patterns, corrections, and preferences—then generates reusable rules that apply across all future sessions.

## Overview

AutoImprove analyzes your Claude Code sessions to detect patterns in corrections, preferences, and best practices. It automatically generates rules that Claude will follow in future sessions, reducing repetitive corrections and improving consistency.

### Why AutoImprove?

- **🔄 Learn from Corrections**: Every time you correct Claude, AutoImprove learns and creates rules to prevent repeating the same mistake
- **🎯 Context-Aware**: Rules automatically match based on tech stack, domain, and context—security rules for auth code, performance rules for React components
- **📈 Continuous Improvement**: Your coding assistant gets smarter with every session, building a personalized knowledge base
- **⚡️ Zero Overhead**: Rules load automatically—no manual configuration, no workflow changes

### Key Capabilities

**🧠 Pattern Detection**
- **Repeated Corrections**: Tracks when you correct the same mistake multiple times
- **Anti-Patterns**: Identifies code patterns you consistently fix (null checks, error handling, etc.)
- **Preferences**: Learns your coding style (naming conventions, import order, code structure)
- **Performance Issues**: Detects optimization patterns (React.memo, useMemo, caching)
- **Security Vulnerabilities**: Catches security issues (SQL injection, XSS, input validation)

**✨ Intelligent Rule Generation**
- **Hybrid Generation**: Combines regex detection + LLM enhancement for high-quality rules
- **Smart Filtering**: Removes noise, questions, and low-confidence patterns (8-class noise classifier)
- **Quality Scoring**: Rates rules 0-1 based on completeness, actionability, and code examples
- **Automatic Deduplication**: Semantic similarity detection prevents redundant rules
- **Robust JSON Extraction**: Handles truncated LLM responses with fallback strategies
- **Batch Rebuild**: Full knowledge base rebuild with intelligent consolidation

**🎯 Context-Aware Matching**
- **3D Scene Model**: Tech stack (React, TypeScript) + Functional domain (auth, API) + Business domain (e-commerce)
- **O(1) Indexed Lookups**: Fast rule matching using inverted indexes
- **Confidence-Based Ranking**: Weighted formula (frequency 30%, behavior 40%, validation 20%, time span 10%)
- **Scene Auto-Detection**: Automatically extracts tech/functional scenes from file extensions and keywords

**📊 Built-in Analytics**
- **Automatic Feedback Tracking**: Records every rule usage (used, ignored, corrected, disabled)
- **Multi-Dimensional Statistics**: Analyticategory, scene, priority, time
- **Quality Monitoring**: Identifies problematic rules with high ignore/correction rates
- **Usage Insights**: Top rules ranking, effectiveness scoring, trend analysis

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
7. ✅ Configure automatic feedback recording

**Configuration Scope**: The setup script configures `autoimprove-core` as a **user-level MCP server**, making it accessible from any project directory. You only need to run setup once.

### Verify Installation

After setup completes:

```bash
# Check MCP server status
claude mcp list

# Test with a skill in Claude Code
/autoimprove-status
```

You should see:
- ✅ MCP Server: `autoimprove-core` listed as Connected
- ✅ Skills: `/autoimprove-*` commands available
- ✅ Storage: `~/.autoimprove/` directory exists
- ✅ Auto-loading: `~/.claude/CLAUDE.md` references claude-index.md

## Quick Start

### 1. Start Coding Normally

Rules load automatically in every Claude Code session. Just code as usual—AutoImprove runs in the background.

### 2. Analyze Your Session

After a coding session, extract patterns and generate rules:

```bash
# In Claude Code
/autoimprove-summarize
```

This analyzes your session and:
- Detects patterns in your corrections
- Generates rules with confidence scoring
- Consolidates similar patterns
- Exports top rules to claude-index.md
- Runs automatic deduplication and cleanup

Options:
```bash
/autoimprove-summarize              # Analyze current session
/autoimprove-summarize --all        # Batch analyze all sessions
/autoimprove-summarize --enhance    # Use AI enhancement for better quality
/autoimprove-summarize --rebuild    # Clear and rebuild all rules from scratch
```

### 3. Review Your Rules

Check what AutoImprove has learned:

```bash
# In Claude Code
/autoimprove-rules                  # View all rules with filtering options
/autoimprove-status                 # System health and statistics
/autoimprove-lessons                # View lessons by scene
```

### 4. Rules Apply Automatically

In your next session, AutoImprove will:
- ✅ Automatically load relevant rules based on your current context
- ✅ Apply them without you having to remember
- ✅ Track which rules are used vs ignored
- ✅ Continue learning from new corrections

## Available Skills

### `/autoimprove-summarize`

Analyze session and generate rules.

**Usage**:
```bash
/autoimprove-summarize                        # Analyze current session
/autoimprove-summarize --all                  # Batch analyze all sessions
/autoimprove-summarize --enhance              # Enable AI enhancement
/autoimprove-summarize --force                # Force reanalysis
/autoimprove-summarize --rebuild              # Clear all rules and rebuild
/autoimprove-summarize --rebuild --enhance    # Rebuild with AI enhancement
/autoimprove-summarize --min-confidence 0.6   # Set confidence threshold
```

**What it does**:
1. Parses session JSONL for user corrections
2. Detects 5 pattern types with confidence scoring
3. Filters noise using 8-class classifier
4. Generates rules with LLM enhancement (optional)
5. Consolidates similar patterns with semantic grouping
6. Deduplicates against existing rules
7. Extracts code examples from Read/Edit/Write tool calls
8. Exports top 10 rules to claude-index.md
9. Runs automatic cleanup (merges duplicates, optimizes low-quality rules)

**Batch Rebuild Mode** (`--rebuild`):
- Backs up existing rules to `~/.autoimprove/backups/`
- Clears all rules and reprocesses all sessions
- Uses latest generation algorithms and quality controls
- Intelligent consolidation and deduplication
- 95 sessions → 49 high-quality rules (typical output)

### `/autoimprove-status`

System health check and statistics.

**Shows**:
- MCP server status
- Storage directory status
- Rule counts by category and priority
- Recent activity (patterns detected, rules generated)
- Configuration status

### `/autoimprove-rules`

View and filter rules.

**Usage**:
```bash
/autoimprove-rules                           # View all rules
/autoimprove-rules --category security       # Filter by category
/autoimprove-rules --min-confidence 0.7      # Filter by confidence
/autoimprove-rules --priority critical       # Filter by priority
```

### `/autoimprove-lessons`

View learned lessons grouped by scene.

**Shows**:
- Rules grouped by tech stack (React, TypeScript, Python, etc.)
- Functional domain groupings (auth, API, database, etc.)
- Applicable patterns for current context

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AutoImprove System                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  User Interface Layer                                        │
│  ├─ Skills (/autoimprove-*)                                 │
│  └─ CLI (optional, for manual management)                   │
│         ↓                                                    │
│  MCP Server (Core Logic)                                     │
│  ├─ Pattern Detection                                        │
│  │  ├─ Session Analyzer (5 pattern types)                   │
│  │  ├─ Noise Classifier (8-class filtering)                 │
│  │  └─ Confidence Calculator (v2.0 weighted formula)        │
│  ├─ Rule Generation                                          │
│  │  ├─ Basic Generator (regex + heuristics)                 │
│  │  ├─ LLM Enhancer (Anthropic API, token-optimized)        │
│  │  ├─ JSON Extractor (truncation-aware parsing)            │
│  │  ├─ Code Example Extractor                               │
│  │  └─ Quality Assessor (0-1 scoring)                       │
│  ├─ Rule Matching                                            │
│  │  ├─ Indexed Rule Matcher (O(1) lookups)                  │
│  │  ├─ Scene Detector (3D model)                            │
│  │  └─ Relevance Scorer                                     │
│  ├─ Deduplication & Cleanup                                  │
│  │  ├─ Semantic Similarity (Jaccard + keyword overlap)      │
│  │  ├─ Rule Merger                                          │
│  │  └─ Quality Optimizer                                    │
│  └─ Storage & Analytics                                      │
│      ├─ Rule Index (fast in-memory metadata)                │
│      ├─ Rule Content (lazy-loaded markdown files)           │
│      ├─ Feedback Tracker (JSONL append-only)                │
│      ├─ Session Cache (incremental analysis)                │
│      └─ Compact Cache (parsing optimization)                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Storage Structure

```
~/.autoimprove/
├── config.json                      # User configuration
├── rules/
│   ├── index.json                   # Rule metadata (fast loading)
│   ├── content/                     # Full rule content (lazy-loaded)
│   │   ├── rule-001.md
│   │   ├── rule-002.md
│   │   └── ...
│   └── claude-index.md              # Top rules (auto-loaded in sessions)
├── sessions/                        # Session analysis cache
│   └── {session_id}.json
├── feedback_history.jsonl           # Rule usage feedback (append-only)
├── analyzed_sessions.json           # Tracking for incremental analysis
├── cache/                           # Compact session cache
│   └── {session_id}.compact.json
└── llm-calls.log                    # LLM enhancement logs (debugging)
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
    "security": 0.5
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
    "src/crm": "crm",
    "src/billing": "finance"
  }
}
```

### Key Settings

- **confidence_thresholds**: Minimum confidence required to generate a rule for each pattern type
- **confidence_weights**: Formula weights (frequency 30%, behavior 40%, validation 20%, time span 10%)
- **rule_matching.max_results**: Maximum rules returned by search
- **rule_matching.min_confidence**: Minimum confidence for rule matching
- **business_domain_mappings**: Map directory paths to business domains

## MCP Tools Reference

### Core Tools

- **`batch_rebuild`** - Complete knowledge base rebuild from all sessions
  - Input: `min_confidence`, `use_llm_enhancement`, `force`, `auto_cleanup`, `merge_duplicates`, `optimize_low_quality`
  - Output: Sessions analyzed, patterns detected, rules generated, execution time
  - Best for: Periodic refresh, fixing quality issues, upgrading generation algorithms

- **`analyze_session`** - Analyze session JSONL file, detect patterns
  - Input: `session_file_path`, `incremental` (optional), `forceReanalyze` (optional)
  - Output: Pattern list with types, confidence, occurrences
  
- **`generate_rules`** - Generate rules from patterns
  - Input: `patterns_json`, `scene_json` (optional), `use_llm` (optional)
  - Output: Rule IDs, deduplication stats
  
- **`search_knowledge`** - Search rules by scene and keywords
  - Input: `scene_json` (optional), `keywords` (optional), `max_results` (optional)
  - Output: Matched rules with relevance scores
  - Side effect: Auto-records "used" feedback
  
- **`export_rules_to_claude_md`** - Export top rules to claude-index.md
  - Input: `strategy` ("top-confidence" | "category-balanced"), `limit`, `min_confidence`
  - Output: Success status, exported rule count

### Analytics Tools

- **`record_feedback`** - Record rule usage feedback
  - Input: `rule_id`, `feedback_type` ("used" | "ignored" | "corrected" | "disabled"), `context`, `user_rating` (optional)
  
- **`get_feedback_stats`** - Get feedback statistics
  - Output: Total feedback count, breakdown by type, average ratings
  
- **`get_rule_usage_stats`** - Multi-dimensional usage statistics
  - Input: `dimension` ("category" | "scene" | "priority" | "time" | "top_rules" | "problematic_rules")
  - Output: Statistics and rankings

### Management Tools

- **`update_rules`** - Update existing rules
  - Input: `rule_id`, `updates` (confidence, priority, content, etc.)
  
- **`list_scenes`** - List known scenes
  - Output: Tech scenes, functional scenes, business scenes
  
- **`cleanup_existing_rules`** - Scan and optimize rules
  - Input: `mode` ("preview" | "execute"), `merge_duplicates`, `optimize_low_quality`, `delete_very_low_quality`
  - Output: Actions taken (merged, optimized, deleted)

### Resources

- **`knowledge://rules/{id}`** - Get full rule content
- **`knowledge://lessons/{scene}`** - Get lessons for specific scene

## Advanced Usage

### Batch Analysis of All Sessions

Analyze all historical sessions at once:

```bash
/autoimprove-summarize --all
```

This will:
- Scan all session files in `~/.claude/projects/`
- Skip already-analyzed sessions (unless `--force`)
- Generate rules incrementally
- Show progress for each session

### Rebuilding Rules from Scratch

If you want to clear all existing rules and rebuild:

```bash
/autoimprove-summarize --rebuild --enhance --min-confidence 0.6
```

This will:
1. Backup existing rules to `~/.autoimprove/backups/`
2. Clear all rules from database
3. Reset analysis tracking
4. Reanalyze all sessions with latest quality controls
5. Generate fresh rules
6. Export to claude-index.md

**Warning**: This is destructive. Use with caution.

### AI-Enhanced Rule Generation

For higher quality rules (slower, uses more tokens):

```bash
/autoimprove-summarize --enhance
```

This enables:
- LLM-based semantic analysis of patterns
- Better noise filtering
- Richer rule descriptions and rationale
- More accurate keyword extraction

### Customizing Confidence Thresholds

Lower thresholds to capture more rules (may include more noise):

```json
{
  "confidence_thresholds": {
    "repeated_correction": 0.30,   // Lower from 0.45
    "anti_pattern": 0.30,          // Lower from 0.45
    "preference": 0.20,            // Lower from 0.30
    "performance": 0.30,           // Lower from 0.40
    "security": 0.40               // Lower from 0.50
  }
}
```

Higher thresholds for higher quality (may miss some patterns):

```json
{
  "confidence_thresholds": {
    "repeated_correction": 0.60,
    "anti_pattern": 0.60,
    "preference": 0.50,
    "performance": 0.60,
    "security": 0.70
  }
}
```

## Development

### Building from Source

```bash
# Clone repository
git clone https://github.com/your-username/autoimprove.git
cd autoimprove

# Install dependencies
cd src/mcp-server-ts && npm install
cd ../skills-ts && npm install

# Build MCP server
cd src/mcp-server-ts
npm run build

# Build skills
cd ../skills-ts
npm run build

# Run setup
cd ../..
./setup.sh
```

### Project Structure

```
autoimprove/
├── src/
│   ├── mcp-server-ts/               # MCP server implementation
│   │   ├── src/
│   │   │   ├── core/                # Core logic
│   │   │   │   ├── session-analyzer.ts      # Pattern detection
│   │   │   │   ├── hybrid-rule-generator.ts # 4-phase generation
│   │   │   │   ├── llm-rule-generator.ts    # LLM enhancement
│   │   │   │   ├── batch-llm-rule-generator.ts # Batch processing
│   │   │   │   ├── json-extractor.ts        # Robust JSON parsing
│   │   │   │   ├── classifier.ts            # Rule filtering
│   │   │   │   ├── confidence.ts            # Confidence calculation
│   │   │   │   ├── indexed-rule-matcher.ts  # O(1) rule matching
│   │   │   │   ├── enhanced-scene-detector.ts # 3D scene detection
│   │   │   │   └── scope-detector.ts        # Project/org scope detection
│   │   │   ├── storage/             # Persistence layer
│   │   │   │   ├── rule-index.ts            # In-memory index
│   │   │   │   ├── rule-content-manager.ts  # File I/O
│   │   │   │   ├── feedback-tracker.ts      # Usage analytics
│   │   │   │   ├── session-cache.ts         # Incremental analysis
│   │   │   │   └── compact-cache.ts         # Parsing optimization
│   │   │   └── index.ts             # MCP server entry point
│   │   ├── tests/                   # Unit tests
│   │   └── package.json
│   └── skills-ts/                   # Claude Code skills
│       └── src/
│           ├── autoimprove-summarize/
│           ├── autoimprove-status/
│           ├── autoimprove-rules/
│           └── autoimprove-lessons/
├── setup.sh                         # Automated setup script
├── restart-mcp.sh                   # Development: restart MCP server
└── README.md
```

### Running Tests

```bash
cd src/mcp-server-ts
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:ui          # Vitest UI

# Run specific test file
npm test -- tests/scene-detection.test.ts
```

### Debugging

**Enable debug logging**:

Edit `src/mcp-server-ts/src/core/logger.ts`:
```typescript
export const LOG_LEVEL = "debug";  // Change from "info"
```

**Check LLM enhancement logs**:
```bash
tail -f ~/.autoimprove/llm-calls.log
```

**Verify MCP server**:
```bash
claude mcp get autoimprove-core
```

### Restarting MCP Server

After code changes:

```bash
# Quick restart (no rebuild)
./restart-mcp.sh

# Rebuild and restart
./restart-mcp.sh --build
```

Or manually:
```bash
cd src/mcp-server-ts
npm run build
# Then start a new Claude Code session
```

## Troubleshooting

### No Patterns Detected

**Possible causes**:
- Session had no user corrections (exploratory coding)
- Corrections were too vague or noisy
- Patterns filtered by noise classifier

**Solutions**:
- Make more explicit corrections ("Don't do X, do Y instead")
- Lower confidence thresholds in `config.json`
- Check filtered reasons with diagnostic logging

### Rules Generated but Not Loading

**Check**:
```bash
# Verify claude-index.md exists
ls ~/.autoimprove/rules/claude-index.md

# Verify CLAUDE.md reference
cat ~/.claude/CLAUDE.md | grep autoimprove
```

**Should see**:
```markdown
@~/.autoimprove/rules/claude-index.md
```

**Fix**:
```bash
./setup.sh --force
```

### MCP Server Not Responding

**Check server status**:
```bash
claude mcp list
# Should show: autoimprove-core - ✓ Connected
```

**Restart server**:
```bash
./restart-mcp.sh
```

**Check logs** (if available):
```bash
# MCP server logs location depends on Claude Code version
# Check ~/.claude/logs/ or Claude Code settings
```

### High Memory Usage

AutoImprove uses caching for performance. If memory is a concern:

**Disable compact cache**:

Edit `src/mcp-server-ts/src/core/session-analyzer.ts`:
```typescript
analyzeSession(sessionFile, { useCompactCache: false })
```

**Clear caches**:
```bash
rm -rf ~/.autoimprove/cache/
```

### 216 Patterns Detected, 0 Rules Generated

This happens when patterns don't meet generation requirements. Common reasons:

1. **Cross-session requirement** (FIXED in latest version)
2. **Test validation required** - Anti-patterns need `test_passed: true`
3. **Performance evidence required** - Performance patterns need `performance_improved: true`
4. **Low confidence** - Below minimum threshold

**Diagnostic**:

Run `/autoimprove-summarize` and check the filtering statistics:
```
⚠️  Filtered 216 patterns:
   • 需要测试验证: 150
   • 需要性能改善证据: 40
   • 置信度不足 (0.25 < 0.45): 26
```

**Solutions**:

Edit `src/mcp-server-ts/src/core/confidence.ts` to lower requirements:

```typescript
[PatternType.ANTI_PATTERN]: {
  requires_test_validation: false,  // Disable test requirement
  ...
}

[PatternType.PERFORMANCE]: {
  requires_performance_evidence: false,  // Disable performance evidence
  ...
}
```

Then rebuild:
```bash
cd src/mcp-server-ts && npm run build
```

## Roadmap

### Planned Features

- [ ] **Web Dashboard**: Visual rule management and analytics
- [ ] **Rule Templates**: Pre-built rule packs for common frameworks
- [ ] **Team Sharing**: Export/import rule packs for team consistency
- [ ] **Git Integration**: Track rule evolution alongside code changes
- [ ] **Multi-Language Support**: Extend beyond English/Chinese
- [ ] **Plugin System**: Custom pattern detectors and rule generators
- [ ] **IDE Extensions**: VS Code, JetBrains integration
- [ ] **API Endpoints**: RESTful API for external integrations

### Under Consideration

- Remote rule synchronization across machines
- Rule versioning and rollback
- A/B testing for rule effectiveness
- Integration with code review tools
- Automatic rule expiration for outdated patterns

## Contributing

Conre welcome! Please feel free to submit issues and pull requests.

### Development Guidelines

- Write tests for new features
- Follow existing code style (TypeScript, ESLint)
- Update documentation for user-facing changes
- Add examples for new MCP tools

## License

MIT License - see LICENSE file for details

## Credits

Built with:
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Anthropic Claude API](https://www.anthropic.com/)
- [Claude Code](https://claude.ai/code)
- TypeScript, Node.js, Vitest

## Version

**Current version**: 0.4.0

### Recent Changes

**v0.4.0** (2026-07-05)
- ✨ **New**: Batch rebuild with intelligent consolidation
  - `batch_rebuild` MCP tool for complete knowledge base refresh
  - Processes 95 sessions in ~4.5 minutes with caching
  - Automatic deduplication and quality optimization
- 🔧 **Enhancement**: Robust JSON extraction module
  - Dedicated `JSONExtractor` with truncation detection
  - Multiple fallback strategies for malformed JSON
  - Handles escaped quotes, control characters, and nested structures
- 📝 **Enhancement**: Scope detection for project/org-level rules
  - Automatic detection of rule applicability scope
  - Better filtering for context-specific patterns
- 🧪 **Testing**: Comprehensive test coverage
  - JSON extraction edge cases
  - Content sanitization
  - Scope parsing and filtering
  - Pattern clusterer truncation handling

**v0.3.0** (2026-07-04)
- 🐛 **Fix**: Remove cross-session requirement for REPEATED_CORRECTION patterns
  - Allows single-session analysis to generate rules
  - Fixes issue where 216 patterns detected but 0 rules generated
- 📊 **New**: Added diagnostic logging for rule filtering
  - Shows breakdown of why patterns were filtered
  - Helps identify validation requirements blocking rule generation
- 🧹 **Enhancement**: Improved noise filtering in session analyzer
  - Better detection of questions vs corrections
  - More accurate technical context validation for security patterns
  - Stricter requirements for actionable content

**v0.2.0** (2026-06-06)
- 🎉 npm-installable package with global CLI
- ✨ New `autoimprove` CLI commands: setup, status, rules, summarize
- 🔧 Automated setup with `autoimprove setup`
- 📦 Single-package distribution
- 🌍 Commander.js-based CLI framework

**v0.1.0** (Initial Release)
- MCP server with TypeScript implementation
- Pattern detection and rule generation
- Automatic rule loading via CLAUDE.md
- Skills for Claude Code integration
- Feedback recording system
- Multi-dimensional usage statistics
