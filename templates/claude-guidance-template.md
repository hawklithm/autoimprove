<!-- AUTOIMPROVE_START -->
## AutoImprove

This project has AutoImprove MCP tools (`mcp__autoimprove-core__*`) configured. AutoImprove learns from user corrections and generates reusable coding rules that improve over time.

### How AutoImprove works

AutoImprove learns from patterns and **automatically injects high-priority rules** into your context at session start. The system adapts based on rule quality:

**When you have ≥5 high-confidence rules (RICH mode)**:
- Rules are **PRE-LOADED** into context — no need to call `search_knowledge` for current scene
- Apply them automatically when relevant
- Only call `search_knowledge` for different tech stacks or after user corrections

**When you have <5 rules (BASIC mode)**:
- Call `search_knowledge` proactively BEFORE implementing
- Rules aren't auto-loaded yet — needs explicit lookup

| Scenario | Action |
|---|---|
| Writing/editing code (RICH mode) | Apply pre-loaded rules directly, mention rule ID |
| Starting task (BASIC mode) | Call `search_knowledge` with scene context FIRST |
| User corrects your approach | Note for end-of-session learning |
| Finishing conversation with corrections | Suggest `/autoimprove-summarize` |
| Applying a learned rule | Mention rule ID: "Following RULE-008..." |
| Rule doesn't fit current context | Call `record_feedback({feedback_type: "ignored"})` |

### Rules of thumb

- **Check your mode** — MCP server instructions tell you if rules are pre-loaded (RICH) or need lookup (BASIC)
- **RICH mode**: Rules are ALREADY IN CONTEXT — apply without calling `search_knowledge` for current scene
- **BASIC mode**: Call `search_knowledge` before implementing — rules aren't auto-loaded yet
- **Trust high-confidence rules** (≥70%) — Apply automatically; they're proven patterns from 3+ confirmations
- **Follow priority** — 🔴 Critical (security/correctness) are MANDATORY, 🟠 High (anti-pattern/performance) follow unless user says otherwise
- **Always mention rule ID** — "Following RULE-008 (JWT validation)" shows transparency
- **Record feedback** — Call `record_feedback` when applying/ignoring rules (builds confidence scores)
- **Learn from corrections** — When user corrects you repeatedly, suggest `/autoimprove-summarize` at conversation end
- **Scene detection is automatic** — Tech stack from file extensions (`.tsx` → react), functional domain from user message keywords

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
