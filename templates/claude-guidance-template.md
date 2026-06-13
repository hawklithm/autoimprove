## AutoImprove MCP Tools

This project has AutoImprove MCP tools (`mcp__autoimprove-core__*`) configured. AutoImprove learns from user corrections and generates reusable coding rules.

### REQUIRED: Check for learned rules BEFORE implementing

**IMPORTANT**: Before starting any implementation task, you MUST check if AutoImprove has learned relevant patterns from past sessions. Skipping this wastes the user's accumulated knowledge.

Call `search_knowledge` at these **mandatory checkpoints**:

1. **BEFORE writing code for a feature** → Check if similar work was done before
2. **WHEN user describes a bug fix** → Check if similar bugs were fixed before
3. **AFTER user corrects your approach** → This pattern should be learned for next time

### Quick decision tree

```
User asks for implementation?
  ↓
  Is this a coding task (not just Q&A)?
    ↓ YES
    → Call search_knowledge FIRST with scene context
    → Check returned rules (confidence >0.7 are proven patterns)
    → Apply high-priority rules (🔴 Critical, 🟠 High) automatically
    → Mention which rules you're following
    ↓
  Start implementation
    ↓
  User corrects you during implementation?
    ↓ YES
    → Note this correction
    → At conversation end, ask: "Want me to run /autoimprove-summarize
       so this pattern is learned for next time?"
```

### Mandatory usage scenarios

| Trigger | Action | Example |
|---|---|---|
| User: "Add [feature]" | Call `search_knowledge` BEFORE planning | "Add authentication" → search for auth-related rules |
| User: "Fix [bug]" | Call `search_knowledge` BEFORE debugging | "Fix JWT validation" → search jwt,validation,security |
| User corrects approach | Note for end-of-session summary | "No, use X not Y" → learn this preference |
| You apply a rule | Call `record_feedback` type="used" | After following RULE-010 → record usage |
| Rule doesn't fit | Call `record_feedback` type="ignored" | RULE-015 suggests TX but this is read-only |

### Integration with coding workflow

#### BEFORE implementation (mandatory)

```typescript
// User: "Add JWT authentication to the API"
// You MUST do this first:

mcp__autoimprove-core__search_knowledge({
  scene_json: JSON.stringify({
    tech: ["typescript", "nodejs"],      // Auto-detected from file paths
    functional: ["authentication", "api"], // From user's message keywords
    business: []                           // Optional, from directory structure
  }),
  keywords: "jwt,token,authentication,validation"  // Key terms from task
})

// If rules found with confidence >0.7:
// → Auto-apply them (they're proven patterns)
// → Mention: "Following RULE-008 (JWT validation best practices from previous session)"
// → After user accepts: record_feedback type="used"

// If no rules found:
// → Implement normally
// → If user corrects you, suggest /autoimrize at end
```

#### DURING implementation (when applying rules)

```typescript
// When you follow a rule from search results or ~/.autoimprove/rules/claude-index.md:

// 1. Mention it explicitly:
// "Following RULE-010: Always validate input parameters before database queries"

// 2. After user confirms it worked:
mcp__autoimprove-core__record_feedback({
  rule_id: "RULE-010",
  feedback_type: "used",
  user_rating: 5,                    // 1-5, optional but valuable
  context: "api-validation:user_accepted"
})

// Note: search_knowledge auto-records "used" feedback,
// so manual recording is only needed for:
// - Rules from claude-index.md (auto-loaded, not from search)
// - "ignored" cases (rule doesn't fit)
// - "corrected" cases (user modifies your rule application)
```

#### AFTER user correction (end of conversation)

```typescript
// User corrected your approach during the session?
// → At conversation end, ALWAYS suggest:

"I notice you corrected my approach to [X]. This is valuable learning data.
Want me to run /autoimprove-summarize to analyze this session and generate
a rule so I handle [X] correctly next time?"

// If user agrees:
// → Run /autoimprove-summarize
// → It will analyze the session, detect the correction pattern, generate a rule
// → Next session will have this knowledge automatically
```

### Rules of thumb

- **Confidence >0.7 = proven pattern** — Auto-apply without asking (learned from 3+ confirmations)
- **🔴 Critical priority (security)** — MUST follow, never skip
- **🟠 High priority (anti-pattern, performance)** — Should follow unless user explicitly says otherwise
- **🟡 Medium (correction), 🟢 Low (preference)** — Apply but explain why
- **Don't skip the search** — "I don't think there are rules" is wrong; let the system check
- **Scene detection is automatic** — Tech stack from file extensions, functional domain from keywords
- **search_knowledge is O(1) fast** — Indexed lookups, no performance penalty

### Common anti-patterns to avoid

❌ **Wrong**: User asks for auth → directly start implementing
✅ **Right**: User asks for auth → search_knowledge first → check for learned auth patterns → apply or learn

❌ **Wrong**: User corrects you → just fix it → move on
✅ **Right**: User corrects you → fix it → note the correction → suggest /autoimprove-summarize at end

❌ **Wrong**: "I think I should use pattern X" (guessing from training data)
✅ **Right**: "Let me check if we have a learned rule for this" → search_knowledge

❌ **Wrong**: Apply a rule silently without mentioning
✅ **Right**: "Following RULE-008 (JWT best practices)" → user knows why you did it

### Example sessions

**Example 1: Following learned patterns**
```
User: "Add input validation to the user registration endpoint"

Claude: Let me check if we have learned patterns for input validation.
[calls search_knowledge with scene: {tech: ["typescript"], functional: ["validation", "api"]}]

Claude: I found RULE-012 (confidence 0.85): "Always use Zod schemas for API input validation".
I'll follow this pattern.

[implements using Zod]

User: Looks good!

Claude: [calls record_feedback: rule_id="RULE-012", type="used", rating=5]
```

**Example 2: Learning from correction**
```
User: "Add state management for the shopping cart"

Claude: [calls search_knowledge, no rules found]
I'll use Redux for state management.

User: "No, we use Zustand in this project, it's simpler"

Claude: Got it, switching to Zustand.
[implements with Zustand]

User: Perfect!

Claude: I notice you corrected my choice of state library. Want me to run
/autoimprove-summarize to learn "prefer Zustand over Redux in this project"
so I get it right next time?

User: Yes

Claude: [runs /autoimprove-summarize]
Analyzed session, generated RULE-019: "Prefer Zustand for simple state management"
This rule will be automatically applied in future sessions.
```

**Example 3: Rule doesn't fit**
```
Claude: [search finds RULE-015: "Always use database transactions for mutations"]
Claude: RULE-015 suggests using transactions, but this is a read-only query.
[calls record_feedback: rule_id="RULE-015", type="ignored",
 context="read-only-query:no-mutation-needed"]
```

### Available tools quick reference

**Mandatory workflow tools**:
- `search_knowledge` → **Call FIRST before implementing** (finds applicable rules, auto-records feedback)
- `record_feedback` → Record when you apply/ignore/correct rules
- `/autoimprove-summarize` → **Suggest at conversation end** if user corrected you

**Rule inspection** (optional):
- `health_check` → Verify system status
- `/autoimprove-rules` → Browse all learned rules
- `get_feedback_stats` → See rule usage statistics
- `list_scenes` → See all known tech stacks and domains

**Advanced** (usually not needed):
- `analyze_session` → Manual session analysis (usually via /autoimprove-summarize)
- `update_rules` → Modify existing rules
- `assess_rule_quality` → Check rule quality metrics
- `get_rule_usage_stats` → Detailed analytics

### Performance notes

- `search_knowledge` is **O(1) indexed lookup** — no performance penalty, always call it
- Rules in `~/.autoimprove/rules/claude-index.md` are **auto-loaded into every session**
- Top 10 rules (~400 tokens) are always available without explicit search
- Feedback recording is **async** — doesn't block your responses

### Debugging

**If tools return errors**:
```bash
# Check if AutoImprove is initialized
~/.autoimprove/  # Should exist with rules/, sessions/, feedback_history.jsonl

# If not initialized:
./setup.sh

# Check MCP connection
claude mcp list  # Should show "autoimprove-core: Connected"

# Restart if needed
claude mcp restart autoimprove-core
```

**If no rules are found but should exist**:
- Check `~/.autoimprove/rules/index.json` has rules
- Check `~/.autoimprove/rules/claude-index.md` is loaded (should be in context)
- Run `/autoimprove-rules` to browse all rules
- Check scene matching: tech stack auto-detected from file extensions
