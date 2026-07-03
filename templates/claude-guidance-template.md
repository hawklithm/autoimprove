<!-- AUTOIMPROVE_START -->
## AutoImprove

This project has AutoImprove MCP tools (`mcp__autoimprove-core__*`) configured. AutoImprove learns from user corrections and generates reusable coding rules that improve over time.

### When to use AutoImprove

Use AutoImprove for **learned patterns** — coding conventions, anti-patterns, and context-specific best practices from your past corrections. Use native tools for general programming knowledge.

| Question | Tool |
|---|---|
| "What patterns have I corrected before?" | `search_knowledge` with current scene |
| "Any rules for React auth?" | `search_knowledge({scene_json: '{"tech":["react"],"functional":["auth"]}'})` |
| "Show rule RULE-008" | `search_knowledge({rule_id: "RULE-008"})` |
| "What rules exist?" | `/autoimprove-rules` |
| "Learn from this session" | `/autoimprove-summarize` |

### Rules of thumb

- **Call `search_knowledge` proactively** — Before implementing features/fixes, check for learned patterns (fast O(1) indexed lookup, <10ms)
- **Trust high-confidence rules** (≥70%) — Apply automatically; they're proven patterns from 3+ confirmations
- **Follow priority** — 🔴 Critical (security/correctness) are MANDATORY, 🟠 High (anti-pattern/performance) follow unless user says otherwise
- **Always mention rule ID** — "Following RULE-008 (JWT validation)" shows transparency
- **Auto-feedback works** — `search_knowledge` automatically records "used" feedback when rules match
- **Learn from corrections** — When user corrects you repeatedly, suggest `/autoimprove-summarize` at conversation end
- **Scene detection is automatic** — Tech stack from file extensions (`.tsx` → react), functional domain from user message keywords

### If `~/.autoimprove/` doesn't exist

Storage isn't initialized. The user can enable it by running:

```bash
cd /path/to/autoimprove
./setup.sh
```

Work normally with built-in tools for now.
<!-- AUTOIMPROVE_END -->
