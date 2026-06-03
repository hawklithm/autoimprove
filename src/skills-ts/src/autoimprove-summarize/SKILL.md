---
name: autoimprove-summarize
description: Analyze a completed coding session and generate rules from detected patterns. Use after completing a coding session to extract learnings.
allowed-tools: mcp__autoimprove-core__*
---

# AutoImprove Summarize

Analyze the most recent Claude Code session file and extract reusable patterns:

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

Use MCP tools from autoimprove-core: `analyze_session` and `generate_rules`.

Note: Session files are in `~/.claude/projects/` organized by project directory path (e.g., `-Users-adazhao-workspace-autoimprove/`).

