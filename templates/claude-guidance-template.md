<!-- AUTOIMPROVE_START -->
## AutoImprove

This project has AutoImprove MCP tools (`mcp__autoimprove-core__*`) configured. AutoImprove learns from user corrections and generates reusable coding rules that improve over time.

### When to use AutoImprove

Use AutoImprove tools **proactively during coding** — not just when explicitly asked. The system learns from patterns and helps you apply learned best practices automatically.

| Scenario | Action |
|---|---|
| Starting ANY coding task | Call `search_knowledge` with scene context FIRST |
| User corrects your approach/code | Note for end-of-session learning |
| Finishing conversation with corrections | Suggest `/autoimprove-summarize` |
| Applying a learned rule | Mention which rule you're following |
| Rule doesn't fit current context | Call `record_feedback` with "ignored" |

### Rules of thumb

- **Call search_knowledge FIRST** — Before planning or coding, check for learned patterns. It's O(1) indexed (<10ms), no performance cost.
- **Trust high-confidence rules** (>0.7) — Auto-apply without asking; they're proven patterns from 3+ confirmations.
- **Follow priority** — 🔴 Critical (security) are mandatory, 🟠 High (anti-pattern/performance) should be followed unless user explicitly says otherwise.
- **Mention what you're following** — "Following RULE-008 (JWT validation)" so user knows why.
- **Learn from corrections** — When user corrects you, suggest `/autoimprove-summarize` at conversation end.
- **Don't skip the search** — "I don't think there are rules" is wrong; let the system check.  auto-load from `~/.autoimprove/rules/claude-index.md`.
- **Scene detection is automatic** — Tech stack from file paths (`.tsx` → react), functional domain from keywords in user messages.
- **search_knowledge auto-records feedback** — Every search with matching rules records "used" feedback automatically, so you only need manual `record_feedback` for ignored/corrected cases.

### Core tools

- `search_knowledge` — Find rules by scene/keywords (call FIRST before implementing)
- `record_feedback` — Manually record when rule ignored/corrected
- `/autoimprove-summarize` — Analyze session and learn patterns (suggest at end if user corrected you)
- `/autoimprove-rules` — Browse all learned rules

### If `~/.autoimprove/` doesn't exist

The storage directory is created by `setup.sh`. If tools return initialization errors:

```bash
./setup.sh  # Run from project root
```

Or check manually:
```bash
claude mcp list  # Should show "autoimprove-core: Connected"
claude mcp restart autoimprove-core  # If needed
```
<!-- AUTOIMPROVE_END -->
