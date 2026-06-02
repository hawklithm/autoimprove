---
name: autoimprove-lessons
description: View rules applicable to your current work scene (tech stack, domain). Use to get context-aware guidance from past learnings.
allowed-tools: mcp__autoimprove-core__*
---

# AutoImprove Lessons

Detect the current coding scene and query knowledge base for relevant rules via MCP resource `knowledge://lessons/{scene}`.

The scene is determined from:
- Tech stack (React, TypeScript, Python, etc.)
- Functional domain (auth, API, database, testing, etc.)

Use MCP resources from autoimprove-core to fetch and display relevant lessons.
