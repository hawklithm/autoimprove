---
name: autoimprove-summarize
description: Analyze a completed coding session and generate rules from detected patterns. Use after completing a coding session to extract learnings.
allowed-tools: mcp__autoimprove-core__*
---

# AutoImprove Summarize

Analyze the most recent Claude Code session file and extract reusable patterns:

1. Detect the latest session file from `~/.claude/sessions/`
2. Call MCP tool `analyze_session` to find patterns (repeated corrections, anti-patterns, preferences, etc.)
3. Call MCP tool `generate_rules` to create rules from detected patterns
4. Show summary of learned patterns and generated rule IDs

Use MCP tools from autoimprove-core: `analyze_session` and `generate_rules`.
