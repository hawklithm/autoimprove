<!-- AUTOIMPROVE_START -->
## AutoImprove

This project has AutoImprove MCP tools (`mcp__autoimprove-core__*`) configured. AutoImprove learns from user corrections and generates reusable coding rules that improve over time.

### How AutoImprove works

AutoImprove learns from patterns through proactive rule lookup. Call `search_knowledge` BEFORE implementing features to check for applicable patterns — it's a fast O(1) index lookup (<10ms).

| Scenario | Action |
|---|---|
| Writing/editing code | Call `search_knowledge` with scene context FIRST |
| User corrects your approach | Note for end-of-session learning |
| Finishing conversation with corrections | Suggest `/autoimprove-summarize` |
| Applying a learned rule | Mention rule ID: "Following RULE-008..." |
| Rule doesn't fit current context | Call `record_feedback({feedback_type: "ignored"})` |

### Rules of thumb

- **Call `search_knowledge` proactively** — Before implementing, check for learned patterns (fast indexed lookup)
- **Trust high-confidence rules** (≥70%) — Apply automatically; they're proven patterns from 3+ confirmations
- **Follow priority** — 🔴 Critical (security/correctness) are MANDATORY, 🟠 High (anti-pattern/performance) follow unless user says otherwise
- **Always mention rule ID** — "Following RULE-008 (JWT validation)" shows transparency
- **Auto-feedback works** — `search_knowledge` automatically records "used" feedback, no manual recording needed
- **Manual feedback only for exceptions** — Call `record_feedback` for ignored/corrected/disabled cases
- **Learn from corrections** — When user corrects you repeatedly, suggest `/autoimprove-summarize` at conversation end
- **Scene detection is automatic** — Tech stack from file extensions (`.tsx` → react), functional domain from user message keywords

### Core tools

- `search_knowledge` — Find rules by scene/keywords (call FIRST before implementing, auto-records feedback)
- `record_feedback` — Manually record when rule ignored/corrected (only for exceptions)
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
