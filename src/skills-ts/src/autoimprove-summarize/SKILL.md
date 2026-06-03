---
name: autoimprove-summarize
description: Analyze a completed coding session and generate rules from detected patterns. Use after completing a coding session to extract learnings. Supports intelligent consolidation via sub-agent (--consolidate flag).
allowed-tools: mcp__autoimprove-core__*
---

# AutoImprove Summarize

Analyze the most recent Claude Code session file and extract reusable patterns:

## Usage

Basic mode:
```bash
/autoimprove-summarize
```

Intelligent consolidation mode (uses sub-agent to merge and optimize patterns):
```bash
/autoimprove-summarize --consolidate
/autoimprove-summarize -c --min-confidence 0.9
```

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

5. **Show results**: Display:
   - Number of patterns found (grouped by type)
   - Sample patterns with descriptions and confidence scores
   - Generated rule IDs
   - Next steps (use `/autoimprove-rules` to review and activate)

**Important**: Always check if patterns were found before calling `generate_rules`. Do not call `generate_rules` with an empty patterns array.

## Intelligent Consolidation Mode (--consolidate)

When `--consolidate` flag is enabled, the skill uses a more sophisticated approach:

1. **Semantic Grouping**: Group similar patterns by semantic similarity (not just type matching)
2. **Description Merging**: Intelligently merge descriptions to capture all unique insights
3. **Confidence Aggregation**: Calculate boosted confidence for patterns that appear multiple times
4. **Scene Detection**: Automatically detect tech/functional/business scenes from pattern context
5. **Quality Filtering**: Only keep patterns above minimum confidence threshold (default: 0.85)

This reduces pattern noise by 30-60% while maintaining information quality.

Parameters:
- `--consolidate` or `-c`: Enable intelligent consolidation
- `--min-confidence <float>`: Set minimum confidence threshold (default: 0.85)

Example output comparison:
- Without consolidation: 20 patterns → 20 rules
- With consolidation: 20 patterns → 8 optimized rules (40% reduction)

Use MCP tools from autoimprove-core: `analyze_session` and `generate_rules`.

Note: Session files are in `~/.claude/projects/` organized by project directory path (e.g., `-Users-adazhao-workspace-autoimprove/`).

