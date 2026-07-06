# Setup Scripts Comparison: Original vs Claude vs Codex

## Overview
This document explains the differences between the three setup scripts and how to migrate from the original to Codex-compatible versions.

## File Comparison

| Feature | `setup.sh` (Original) | `setup_claude.sh` | `setup_codex.sh` |
|---------|----------------------|-------------------|------------------|
| **Target CLI** | Generic / Unclear | Claude Code | OpenAI Codex |
| **Install Dir** | `~/.autoimprove` | `~/.autoimprove` | `~/.autoimprove` |
| **Config Dir** | Unclear | `~/.claude/` | `~/.codex/` |
| **Skills Dir** | Unclear | `~/.claude/skills/` | `~/.codex/skills/` |
| **MCP Config** | `.mcp.json` (local) | `~/.claude/mcp.json` | `~/.codex/mcp.json` |
| **MCP Port** | 18060 (Python) | 18060 (Python) | 18066 (Node.js) |
| **MCP Server** | `mcp_server.py` | `mcp_server.py` | `mcp-server.js` |
| **Skill Format** | Markdown | Markdown + YAML frontmatter | Markdown + YAML frontmatter |
| **Python Deps** | Yes | Yes | No (uses npx) |
... [truncated 4756 chars]