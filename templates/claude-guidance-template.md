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
| Rule doesn't fit current context | Note why (improves future matching) |

### Rules of thumb

- **Call search_knowledge FIRST** — Before planning or coding, check for learned patterns. It's O(1) indexed (<10ms), no performance penalty.
- **Trust high-confidence rules** (>0.7) — Auto-apply without asking; they're proven patterns from 3+ confirmations.
- **Follow priority** — 🔴 Critical (security) are mandatory, 🟠 High (anti-pattern/performance) should be followed unless user explicitly says otherwise.
- **Mention what you're following** — "Following RULE-008 (JWT validation)" so user knows why.
- **Learn from corrections** — When user corrects you, suggest `/autoimprove-summarize` at conversation end.
- **Don't skip the search** — "I don't think there are rules" is wrong; let the system check. Rules auto-load from `~/.autoimprove/rules/claude-index.md`.
- **Scene detection is automatic** — Tech stack from file paths (`.tsx` → react), functional domain from keywords in user messages.
- **search_knowledge auto-records feedback** — Every search with matching rules records "used" feedback automatically, so you only need manual `record_feedback` for ignored/corrected cases.

### Integration with coding workflow

**Step 1: BEFORE coding (mandatory)**
```typescript
// User: "Add JWT authentication to the API"
// Call this FIRST:

mcp__autoimprove-core__search_knowledge({
  scene_json: JSON.stringify({
    tech: ["typescript", "nodejs"],      // Auto-detect from file paths
    functional: ["authentication", "api"], // Extract from user message
    business: []                           // Optional
  }),
  keywords: "jwt,token,authentication,validation"
})

// If rules found with confidence >0.7:
// → Mention: "Found RULE-008 (JWT best practices, confidence 0.85). I'll follow this pattern."
// → Implement using the rule
// → Feedback is auto-recorded when you search

// If no rules found:
// → Implement normally
// → If user corrects you later, suggest /autoimprove-summarize at end
```

**Step 2: DURING coding (when applying rules)**
```typescript
// When following a rule from search results or claude-index.md:
// 1. Mention it: "Following RULE-010: Validate input parameters before database queries"
// 2. Feedback is auto-recorded by search_knowledge
// 3. Only manually record if:
//    - Rule from claude-index.md (wasn't searched, just auto-loaded)
//    - Rule doesn't fit ("ignored")
//    - User corrects your application ("corrected")

// Example: Rule doesn't fit
// "RULE-015 suggests transactions, but this is read-only."
mcp__autoimprove-core__record_feedback({
  rule_id: "RULE-015",
  feedback_type: "ignored",
  context: "read-only-query:no-mutation-needed"
})
```

**Step 3: AFTER user correction (end of conversation)**
```typescript
// User corrected your approach during the session?
// Suggest at conversation end:

"I notice you corrected my approach to [X]. Want me to run /autoimprove-summarize 
to analyze this session and learn this pattern for next time?"

// If user agrees → Run /autoimprove-summarize
// Next session will have this knowledge automatically
```

### Common anti-patterns to avoid

❌ **Wrong**: User asks for auth → directly start implementing  
✅ **Right**: User asks for auth → `search_knowledge` first → check for learned auth patterns → then implement

❌ **Wrong**: User corrects you → just fix it → move on  
✅ **Right**: User corrects you → fix it → note correction → suggest `/autoimprove-summarize` at end

❌ **Wrong**: "I think pattern X is best" (guessing from training data)  
✅ **Right**: "Let me check learned patterns first" → `search_knowledge`

❌ **Wrong**: Apply rule silently  
✅ **Right**: "Following RULE-008 (JWT best practices)" → user knows why

### Example workflow

```
User: "Add input validation to user registration endpoint"

Claude: Let me check for learned validation patterns first.
[calls search_knowledge with scene: {tech: ["typescript"], functional: ["validation", "api"]}]

Claude: Found RULE-012 (confidence 0.85): "Use Zod schemas for API input validation"
This is a proven pattern. I'll follow it.

[implements using Zod]

User: Looks good!

Claude: ✓ (Feedback auto-recorded by search_knowledge)
```

### Available tools quick reference

**Core workflow** (use these actively):
- `search_knowledge` → **Call FIRST** before implementing (finds rules, auto-records feedback)
- `record_feedback` → Manually record when rule ignored/corrected
- `/autoimprove-summarize` → **Suggest at end** if user corrected you

**Optional inspection**:
- `health_check` → System status
- `/autoimprove-rules` → Browse all rules
- `get_feedback_stats` → Rule usage statistics
- `list_scenes` → Known tech stacks/domains

**Advanced** (rarely needed):
- `analyze_session` → Manual analysis
- `update_rules` → Modify rules
- `assess_rule_quality` → Quality metrics
- `get_rule_usage_stats` → Detailed analytics

### Performance notes

- `search_knowledge` is **O(1) indexed** — no performance cost, always call it
- Top rules (~400 tokens) auto-load from `~/.autoimprove/rules/claude-index.md` into every session
- Feedback recording is **async** — doesn't block responses
- Session analysis is **incremental** — only analyzes new sessions

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
