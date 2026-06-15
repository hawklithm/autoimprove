# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

AutoImprove is a Claude Code MCP server that learns from user corrections and generates reusable coding rules. It consists of:

1. **MCP Server** (`src/mcp-server-ts`): TypeScript-based server with pattern detection and rule generation
2. **Skills** (`src/skills-ts`): User-facing slash commands (`/autoimprove-*`)
3. **Storage System** (`~/.autoimprove/`): User-level rule database with indexed search

## Common Commands

### Build Everything
```bash
./setup.sh                    # Quick setup (recommended for first-time)

# Manual build
cd src/mcp-server-ts && npm install && npm run build
cd src/skills-ts && npm install && npm run build
```

### Development
```bash
# MCP Server
cd src/mcp-server-ts
npm run dev          # Run with tsx (hot reload)
npm test             # Run tests once
npm run test:watch   # Watch mode
npm run test:ui      # Vitest UI

# After code changes - restart MCP server
npm run build
claude mcp restart autoimprove-core
```

### Run Specific Test
```bash
cd src/mcp-server-ts
npm test -- tests/scene-detection.test.ts
```

## Architecture

### Two-Layer Design

```
Skills (UI) → MCP Server (Logic) → Storage (~/.autoimprove/)
```

**Skills**: Thin wrappers calling MCP tools. Located in `src/skills-ts/src/`, each skill has a `SKILL.md` that defines its behavior.

**MCP Server**: Core business logic in `src/mcp-server-ts/src/`:
- `core/`: Pattern detection, rule generation, matching, statistics
  - `session-analyzer.ts`: Detects 5 pattern types (correction, anti-pattern, preference, performance, security)
  - `rule-generator.ts`: Converts patterns to rules with confidence scoring
  - `indexed-rule-matcher.ts`: O(1) scene-based rule lookups
  - `llm-rule-generator.ts`: LLM-enhanced rule generation with structured 6-section output
  - `hybrid-rule-generator.ts`: Orchestrates 4-phase generation (basic detection → LLM enhancement → code extraction → structured storage)
- `storage/`: Rule index, content management, versioning, feedback tracking
  - `rule-index.ts`: In-memory indexed metadata
  - `session-analysis-tracker.ts`: Prevents redundant analysis
- `index.ts`: MCP tool/resource handlers (1200+ lines)

**Storage** (`~/.autoimprove/`):
- `rules/index.json`: Fast in-memory rule metadata
- `rules/content/*.md`: Full rule content (lazy-loaded)
- `feedback_history.jsonl`: Rule usage feedback (append-only)
- `sessions/*.json`: Analyzed session metadata
- `rules/claude-index.md`: Auto-exported top rules (loaded into every Claude session)
- `signal_dictionary/signals.db`: SQLite signal patterns (v2.2+)

### Key Components

**Session Analysis**: Parses Claude Code session JSONL files, extracts user corrections using 8-class noise filtering. Incremental analysis tracks processed sessions.

**Rule Generation** (4-phase hybrid):
1. **Basic detection**: Regex + heuristics for fast pattern recognition
2. **LLM enhancement**: Extracts actionable descriptions from noisy messages (token-optimized prompts)
3. **Code extraction**: Mines before/after code from Read/Edit/Write tool calls
4. **Structured storage**: 6-section format (description, rationale, how-to, examples, when-to-use, exceptions)

**Rule Matching**: 3D scene model (tech stack + functional domain + business domain). Uses indexed lookups for O(1) performance. Scene detection is automatic from file extensions and user message keywords.

**Confidence Scoring**: Weighted formula (frequency 30%, time span 10%, user behavior 40%, validation 20%). Higher confidence = more reliable rule.

**Feedback System** (dual-track):
- **Automatic**: `search_knowledge` auto-records "used" when rules match
- **Manual**: Claude calls `record_feedback` for ignored/corrected/disabled cases

**Token Optimization** (v2.1): 
- Compressed LLM prompts (2800 → 900 tokens, 67% reduction)
- Smart example selection (TF-IDF diversity sampling, 10 → 5 examples)
- Dynamic max_tokens allocation (700-1500 based on pattern complexity)
- Expected savings: 12800 → ~4100 tokens per analysis (68% reduction)

### Scene Detection

3-dimensional model in `core/enhanced-scene-detector.ts`:
1. **Tech scene**: File extensions (`.tsx` → react, `.py` → python)
2. **Functional scene**: Keywords in user messages (aut database)
3. **Business scene**: Directory patterns from config

Scene matching uses overlap scoring: more dimensions matched = higher relevance.

## Development Workflow

### Adding New Pattern Type

1. Add to `PatternType` enum in `core/models.ts`
2. Implement `detect*Patterns()` in `core/session-analyzer.ts`
3. Add confidence threshold to `storage/init.ts` default config
4. Update priority logic in `core/rule-generator.ts`
5. Add tests in `tests/core.test.ts`

### Adding New MCP Tool

1. Add schema to `ListToolsRequestSchema` handler in `index.ts`
2. Implement handler function
3. Add case to `CallToolRequestSchema` switch
4. Update `docs/MCP_TOOLS_API.md`
5. Add skill wrapper if user-facing

### Modifying Rule Matching

Performance-critical (called on every session start):
- Use `IndexedRuleMatcher` for O(1) lookups, not O(n) iteration
- Cache computed relevance scores
- Keep `claude-index.md` under 500 tokens (~400 for top 10 rules)

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

## Configuration

User config at `~/.autoimprove/config.json`:
- `confidence_thresholds`: Min confidence by pattern type
- `confidence_weights`: Formula component weights (frequency, time span, behavior, validation)
- `rule_matching.max_results`: Max rules returned by search
- `business_domain_mappings`: Directory → business scene mapping

## Common Issues

**Build fails after git pull**:
```bash
cd src/mcp-server-ts && rm -rf dist node_modules && npm install && npm run build
```

**Skills not working**:
```bash
claude mcp list  # Should show autoimprove-core as Connected
claude mcp restart autoimprove-core
```

**No patterns detected**: Check session file contains user corrections. Enable debug logging:
```bash
# Edit src/mcp-server-ts/src/core/logger.ts and set LOG_LEVEL = "debug"
```

**Rules not auto-loading**: Verify `~/.claude/CLAUDE.md` references `~/.autoimprove/rules/claude-index.md`:
```bash
./setup.sh  # Re-run setup to fix
```

## Key Files Reference

- `src/mcp-server-ts/src/index.ts`: MCP server entry point, tool handlers
- `src/mcp-server-ts/src/core/session-analyzer.ts`: Pattern detection core
- `src/mcp-server-ts/src/core/hybrid-rule-generator.ts`: 4-phase rule generation orchestrator
- `src/mcp-server-ts/src/core/llm-rule-generator.ts`: Token-optimized LLM prompts
- `src/mcp-server-ts/src/storage/rule-index.ts`: Indexed rule storage
- `src/skills-ts/src/autoimprove-summarize/skill.ts`: Primary workflow (analyze → generate → export)
- `setup.sh`: Automated installation (updates `~/.claude/CLAUDE.md` with guidance)
- `docs/COMPLETE_SUMMARY.md`: Comprehensive feature documentation
- `docs/HYBRID_RULE_GENERATION.md`: 4-phase generation implementation
- `docs/TOKEN_OPTIMIZATION_ANALYSIS.md`: Token reduction strategy
