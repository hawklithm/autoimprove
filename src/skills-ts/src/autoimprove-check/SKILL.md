---
name: autoimprove-check
description: Call BEFORE any task — analysis, file operations (read/edit/write/move/create), or code changes — checks learned rules for your current scene in <10ms. Use proactively, not just when asked.
allowed-tools: mcp__autoimprove-core__search_knowledge
---

# AutoImprove Check

Before any task — analysis, file operations (read/edit/write/move/create), or code changes — call `search_knowledge`. Derive `scene_json` from the current file paths and the user's request, and include concise technical keywords.

Apply relevant returned rules and cite their IDs in the implementation summary (for example, “Following RULE-005…”). If no rules match, proceed normally; after a user correction, run `/autoimprove-summarize` to capture a future rule.
