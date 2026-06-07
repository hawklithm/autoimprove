# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoImprove is a Claude Code session pattern analyzer that learns from user corrections and generates reusable rules. It consists of:

1. **MCP Server** (`src/mcp-server-ts`): TypeScript-based MCP server providing tools and resources
2. **Skills** (`src/skills-ts`): User-facing slash commands (`/autoimprove-*`)
3. **Storage System** (`~/.autoimprove/`): User-level rule database with indexed search

## Build Commands

### Build Everything
```bash
# Quick setup (recommended for first-time setup)
./setup.sh

# Manual build - MCP Server
cd src/mcp-server-ts
npm install
npm run build

# Manual build - Skills
cd src/skills-ts
npm install
npm run build
```

### Development
```bash
# MCP Server
cd src/mcp-server-ts
npm run dev          # Run with tsx (hot reload)
npm run typecheck    # Type check without emitting
npm run lint         # ESLint

# Run tests
npm test             # Run once
npm run test:watch   # Watch mode
npm run test:ui      # Vitest UI

# Skills (no dev mode - rebuild after changes)
cd src/skills-ts
npm run build:watch  # Watch mode
```

### After Code Changes

**Critical**: After modifying MCP server code, restart the server:
```bash
cd src/mcp-server-ts && npm run build
claude mcp restart autoimprove-core
```

Skills require reinstallation:
```bash
cd src/skills-ts && npm run build
cp -r src/autoimprove-* ~/.claude/skills/
```

## Architecture

### Two-Layer Design

```
Skills (UI) → MCP Server (Logic) → Storage (~/.autoimprove/)
```

**Skills**: Thin wrappers that call MCP tools via `mcp-client.ts`. Each skill (status, summarize, rules, lessons) corresponds to MCP tool calls.

**MCP Server**: Core business logic in `src/mcp-server-ts/src/`:
- `core/`: Pattern detection, rule generation, matching, statistics
- `storage/`: Rule index, content management, versioning, feedback tracking
- `tools/`: Claude index export
- `index.ts`: MCP tool/resource handlers

**Storage**: User-level at `~/.autoimprove/`:
- `rules/index.json`: Fast in-memory rule metadata
- `rules/content/*.md`: Full rule content (lazy-loaded)
- `feedback_history.jsonl`: Rule usage feedback (append-only)
- `sessions/*.json`: Analyzed session metadata
- `rules/claude-index.md`: Auto-exported top rules (loaded into every Claude session)

### Key Components

**Session Analysis** (`core/session-analyzer.ts`):
- Parses Claude Code session JSONL files
- Detects 5 pattern types: repeated-correction, anti-pattern, preference, performance, security
- Extracts meaningful descriptions with 8-class noise filtering
- Implements incremental analysis (only analyzes new sessions)

**Rule Generation** (`core/rule-gene:
- Converts patterns → rules with confidence scoring
- Uses adaptive confidence (frequency 30%, time span 10%, user behavior 40%, validation 20%)
- Assigns priority: critical (security), high (anti-pattern/performance), medium (correction), low (preference)

**Rule Matching** (`core/rule-matcher.ts`, `core/indexed-rule-matcher.ts`):
- 3D scene matching: tech stack + functional domain + business domain
- Keyword-based search with relevance scoring
- Indexed search for O(1) lookups by scene/keyword

**Feedback System** (v2.1):
- **Auto-recording**: `search_knowledge` tool auto-records "used" feedback when rules match
- **Manual recordinaude actively calls `record_feedback` with context and ratings
- **Statistics**: Multi-dimensional analysis via `rule-usage-stats.ts`

**Quality Control** (`core/rule-quality.ts`):
- Assesses rule clarity, specificity, actionability
- Detects conflicts between rules
- Version history with rollback support

### Scene Detection

3-dimensional model implemented in `core/enhanced-scene-detector.ts`:

1. **Tech scene**: Detected from file paths (`.tsx` → react, `.py` → python) and imports
2. **Functional scene**: Keywords in user messages (auth, api, database, testing)
3. **Business scene**: Directory patterns from config (e.g., `src/shop` → e-commerce)

Scene matching uses overlap scoring: more scene dimensions matched = higher relevance.

## Testing

Tests use Vitest and are located in `src/mcp-server-ts/tests/`:
- `core.test.ts`: Pattern detection and rule generation
- `scene-detection.test.ts`: Scene detector logic
- `storage.test.ts`: Storage layer operations
- `optimization.test.ts`: Performance benchmarks

Run specific test file:
```bash
cd src/mcp-server-ts
npm test -- tests/scene-detection.test.ts
```

## MCP Tools

Available tools (call via Claude or skills):

- `analyze_session`: Parse session JSONL, detect patterns (supports `--enhance` for AI-powered analysis)
- `generate_rules`: Convert patterns → rules with confidence scoring
- `search_knowledge`: Find rules by scene/keywords/ID (auto-records feedback unless `skip_feedback: true`)
- `record_feedback`: Manually record rule usage feedback (used/ignored/corrected/disabled)
- `get_feedback_stats`: Get feedback statistics for rules
- `get_rule_usage_stats`: Multi-dimensional usage statistics (by category/scene/priority/time)
- `update_rules`: Modify existing rules (creates version history)
- `export_rules_to_claude_md`: Export top rules to `~/.autoimprove/rules/claude-index.md`
- `list_scenes`: Show all known tech/functional/business scenes
- `health_check`: Verify storage initialization

## Important Implementation Details

### Rule Confidence Formula (v2.0)

```typescript
confidence = 
  frequency_score * 0.3 +
  time_span_score * 0.1 +
  behavior_score * 0.4 +
  validation_score * 0.2
```

Higher confidence = more reliable rule. Thresholds vary by pattern type (see `~/.autoimprove/config.json`).

### Feedback Recording (Dual-Track)

1. **Automatic** (implemented in `index.ts` `handleSearchKnowledge()`):
   - Records "used" when rule queried by ID
   - Records "used" for all scene-matched rules with relevance scores
   - Stored with context: `scene_context:relevance:X.XX`

2. **Manual** (via Claude instructions in `~/.claude/autoimprove-feedback-instructions.md`):
   - Claude actively calls `record_feedback` with ratings and detailed context
   - Used when user explicitly approves/rejects/corrects rules

### Session Analysis Tracking

`SessionAnalysisTracker` (`storage/session-analysis-tracker.ts`) prevents redundant analysis:
- Tracks analyzed session IDs with metadata (patterns found, rules generated)
- Uses file modification time to detect stale cache
- CLI flag `--force` bypasses cache

### Agent Enhancement (--enhance flag)

The `autoimprove-summarize` skill supports `--enhance` mode:
- Simulates AI agent analysis (current implementation uses regex patterns + heuristics)
- Extracts actionable descriptions from noisy user messages
- Auto-extracts keywords and adjusts confidence
- **Note**: Current "agent" is simulated; v2.2 will integrate real Claude Code Agent tool

### Statistics CLI Script

`scripts/rule-usage-stats.ts` provides standalone statistics:
```bash
npx tsx scripts/rule-usage-stats.ts --format markdown --last 30days --top 20
```

Supports time filters, category filters, multiple output formats (JSON/Markdown/Summary).

## Storage Schema

### Rule Index (`rules/index.json`)
```json
{
  "version": "1.0",
  "rules": [{
    "id": "rule-001",
    "type": "repeated-correction",
    "priority": "medium",
    "confidence": 0.75,
    "scenes": {"tech": ["react"], "functional": ["auth"]},
    "keywords": ["useState", "token"],
    "content_file": "rule-001.md"
  }]
}
```

### Feedback History (`feedback_history.jsonl`)
```jsonl
{"rule_id":"rule-001","timestamp":"2026-06-06T10:30:00Z","feedback_type":"used","context":"react-auth:relevance:0.85"}
{"rule_id":"rule-002","timestamp":"2026-06-06T11:00:00Z","feedback_type":"ignored","context":"Not applicable","user_rating":2}
```

## Development Workflow

### Adding New Pattern Type

1. Add type to `PatternType` enum in `core/models.ts`
2. Implement `detect*Patterns()` method in `core/session-analyzer.ts`
3. Add confidence threshold to default config in `storage/init.ts`
4. Update rule generator priority logic in `core/rule-generator.ts`
5. Add tests in `tests/core.test.ts`

### Adding New MCP Tool

1. Add tool schema to `ListToolsRequestSchema` handler in `index.ts`
2. Implement handler function (e.g., `handleNewTool()`)
3. Add case to `CallToolRequestSchema` switch statement
4. Update `docs/MCP_TOOLS_API.md`
5. Add corresponding skill wrapper if user-facing

### Modifying Rule Matching Logic

Rule matching is performance-critical (called on every Claude session start when loading auto-exported rules):
- Use `IndexedRuleMatcher` for O(1) scene lookups (not O(n) iteration)
- Cache computed relevance scores
- Keep `claude-index.md` under 500 tokens (currently ~400 for top 10 rules)

## Configuration

User config at `~/.autoimprove/config.json`:
- `confidence_thresholds`: Min confidence by pattern type
- `confidence_weights`: Formula component weights
- `rule_matching.max_results`: Max rules returned by search
- `business_domain_mappings`: Directory → business scene mapping

## Common Issues

**Build fails after git pull**: Clean and rebuild
```bash
cd src/mcp-server-ts && rm -rf dist node_modules && npm install && npm run build
```

**Skills not working**: MCP server must be running and connected
```bash
claude mcp list  # Should show autoimprove-core as Connected
claude mcp restart autoimprove-core
```

**No patterns detected**: Check session file exists and contains user corrections. Enable debug logging:
```bash
# Edit src/mcp-server-ts/src/core/logger.ts and set LOG_LEVEL = "debug"
```

**Rules not auto-loading**: Verify `~/.claude/CLAUDE.md` contains reference to `~/.autoimprove/rules/claude-index.md`. Re-run setup:
```bash
./setup.sh
```

## Key Files Reference

- `src/mcp-server-ts/src/index.ts`: Main MCP server, tool handlers (1200+ lines)
- `src/mcp-server-ts/src/core/session-analyzer.ts`: Pattern detection core
- `src/mcp-server-ts/src/core/rule-usage-stats.ts`: Multi-dimensional statistics engine
- `src/mcp-server-ts/src/storage/rule-index.ts`: In-memory indexed rule storage
- `src/skills-ts/src/autoimprove-summarize/skill.ts`: Primary user workflow (analyze → generate → export)
- `setup.sh`: Automated installation and configuration
- `docs/COMPLETE_SUMMARY.md`: Comprehensive feature documentation
