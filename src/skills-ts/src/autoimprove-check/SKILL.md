---
name: autoimprove-check
description: Call BEFORE any task — analysis, file operations (read/edit/write/move/create), or code changes — checks learned rules for your current scene in <10ms. Use proactively, not just when asked.
allowed-tools: mcp__autoimprove-core__search_knowledge
---

# AutoImprove Check

Before any task — analysis, file operations (read/edit/write/move/create), or code changes — call `search_knowledge`. Derive `scene_json` from the current file paths and the user's request, and include concise technical keywords.

Apply relevant returned rules and cite their IDs in the implementation summary (for example, “Following RULE-005…”). If no rules match, proceed normally; after a user correction, run `/autoimprove-summarize` to capture a future rule.

## Note on the CLI entry point

The compiled `skill.js` (the `entry` in `manifest.json`) is a manual fallback only: it passes command-line arguments straight through as `keywords` to `search_knowledge` and does **not** derive `scene_json` on its own. Full scene derivation (from current file paths + the user's request) is performed by Claude when this skill is invoked via the `/autoimprove-check` slash command, following the instruction above. For scene-aware results, use the slash command rather than running `skill.js` directly.
