---
name: autoimprove-summarize
description: Analyze coding sessions and generate rules from detected patterns. Supports single session, batch analysis of all sessions, intelligent consolidation (default), and optional AI Agent enhancement (--enhance flag). Automatically tracks analyzed sessions to avoid redundant processing.
allowed-tools: mcp__autoimprove-core__*
---

# AutoImprove Summarize

Analyze Claude Code session files and extract reusable patterns:

## Usage

**Single session (most recent):**
```bash
/autoimprove-summarize
```

**With AI Agent enhancement (recommended for highest quality):**
```bash
/autoimprove-summarize --enhance
```

**With custom confidence threshold:**
```bash
/autoimprove-summarize --min-confidence 0.9
```

**Batch analysis (all unanalyzed sessions):**
```bash
/autoimprove-summarize --all
/autoimprove-summarize --all --enhance
```

**Force re-analyze all sessions:**
```bash
/autoimprove-summarize --all --force
```

**Disable intelligent consolidation (not recommended):**
```bash
/autoimprove-summarize --no-consolidate
```

## Parameters

- `--enhance`: Use AI Agent for deep semantic analysis and quality enhancement
- `--min-confidence <float>`: Set minimum confidence threshold (default: 0.85)
- `--all` / `-a`: Analyze all unanalyzed sessions (batch mode)
- `--force`: Force re-analyze even if session was already analyzed
- `--no-consolidate`: Disable intelligent pattern consolidation (enabled by default)

## Workflow

1. **Detect session file**: Find the latest session file from `~/.claude/projects/<project-path>/` (session files are stored per-project as `.jsonl` files, named with session UUIDs)

2. **Analyze session**: Call MCP tool `analyze_session` with the session file path to detect patterns:
   - Repeated corrections (user correcting the same mistake multiple times)
   - Anti-patterns (approaches that failed and needed rework)
   - Preferences (explicit statements about how things should be done)
   - Performance patterns (optimization-related corrections)
   - Security patterns (security-related corrections)

3. **Check results**: If `patterns_count` is 0, inform the user that no learnable patterns were detected and explain possible reasons:
   - The session was exploratory (no corrections needed)
   - Patterns were too weak to generate rules (low confidence)
   - Already following best practices

4. **Generate rules** (ONLY if `patterns_count > 0`): Call MCP tool `generate_rules` with:
   - `patterns_json`: JSON string of the patterns array from step 2
   - `scene_json`: JSON string of scene context (tech stack, domain, etc.)

5. **Export to Claude index** (ONLY if rules were generated): Call MCP tool `export_rules_to_claude_md` with:
   - `strategy`: "category-balanced" (recommended) or "top-n"
   - `limit`: 10 (default)
   - `min_confidence`: 0.6 (default)
   
   This automatically updates `~/.autoimprove/rules/claude-index.md` with the top rules, which are loaded into every Claude Code session.

6. **Show results**: Display:
   - Number of patterns found (grouped by type)
   - Sample patterns with descriptions and confidence scores
   - Generated rule IDs
   - Export status (rules exported to claude-index.md, token estimate)
   - Next steps (use `/autoimprove-rules` to review all rules)

**Important**: Always check if patterns were found before calling `generate_rules`. Do not call `generate_rules` with an empty patterns array. After generating rules, always call `export_rules_to_claude_md` to update the Claude index.

## Intelligent Consolidation Mode (Default)

**Note**: Consolidation is now enabled by default for better quality. Use `--no-consolidate` to disable.

The intelligent consolidation mode uses a more sophisticated approach:

1. **Semantic Grouping**: Group similar patterns by semantic similarity (not just type matching)
2. **Description Merging**: Intelligently merge descriptions to capture all unique insights
3. **Confidence Aggregation**: Calculate boosted confidence for patterns that appear multiple times
4. **Scene Detection**: Automatically detect tech/functional/business scenes from pattern context
5. **Quality Filtering**: Only keep patterns above minimum confidence threshold (default: 0.85)

This reduces pattern noise by 30-60% while maintaining information quality.

## Batch Analysis Mode (--all)

Batch mode analyzes all sessions in `~/.claude/projects/` directories:

1. **Discovery**: Scans all project directories for `.jsonl` session files
2. **Status Check**: Uses `list_unanalyzed_sessions` MCP tool to filter out already-analyzed sessions
3. **Sequential Processing**: Analyzes each unanalyzed session one by one
4. **Progress Tracking**: Marks each session as analyzed via `mark_session_analyzed` MCP tool
5. **Summary Report**: Shows total patterns detected and rules generated

**Benefits:**
- Process historical sessions automatically
- Avoid redundant analysis (sessions are tracked)
- Extract maximum value from all coding activity
- Perfect for onboarding or periodic knowledge extraction

**Performance:**
- Typical session: 2-5 seconds
- 10 sessions: ~30-60 seconds
- 100 sessions: ~5-10 minutes

## Session Tracking

The system automatically tracks which sessions have been analyzed:

**Tracking file:** `~/.autoimprove/analyzed_sessions.json`

**Recorded information:**
- Session ID and file path
- Analysis timestamp
- Patterns found and rules generated
- Analysis mode (standard vs consolidated)
- Success status and error messages

**MCP Tools used:**
- `mark_session_analyzed` - Mark a session as processed
- `get_analysis_status` - Check if a session was analyzed
- `list_unanalyzed_sessions` - Filter unanalyzed from a list
- `clear_analysis_record` - Clear record for re-analysis

Use MCP tools from autoimprove-core: `analyze_session`, `generate_rules`, `export_rules_to_claude_md`, `mark_session_analyzed`, `list_unanalyzed_sessions`, `get_analysis_status`, `clear_analysis_record`.

Note: Session files are in `~/.claude/projects/` organized by project directory path (e.g., `-Users-adazhao-workspace-autoimprove/`).

## Claude Index Auto-Export

After generating rules, the system automatically exports top rules to `~/.autoimprove/rules/claude-index.md`:

- **Category-balanced strategy**: Selects rules across categories (30% security, 30% repeated-corrections, 20% anti-patterns, 15% performance, 5% preferences)
- **Top 10 rules by default**: Keeps context usage low (~400 tokens)
- **Auto-loaded**: These rules are automatically loaded in every Claude Code session via reference in `~/.claude/CLAUDE.md`

This ensures Claude learns from your habits automatically without manual intervention.

