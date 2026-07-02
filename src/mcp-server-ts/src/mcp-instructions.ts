/**
 * MCP server instructions for AutoImprove
 *
 * These instructions are returned in the MCP `initialize` response and
 * automatically injected into Claude Code's system prompt at the start
 * of every session.
 *
 * Design goals (learned from CodeGraph):
 * - TIGHT (~800 tokens) — agent reads this every session
 * - Proactive guidance — use rules BEFORE/DURING coding, not just when asked
 * - Clear anti-patterns — what NOT to do
 * - Dynamic content — different instructions based on rule availability
 *
 * Keep this concise. The agent reads it every session.
 */

/**
 * Instructions when high-quality rules exist (>5 rules with confidence >0.7)
 */
export const SERVER_INSTRUCTIONS_RICH = `# AutoImprove — learned rules ARE PRE-LOADED into this session

AutoImprove is a learned knowledge base of coding patterns from your past corrections. High-confidence rules for the current tech stack are **ALREADY IN YOUR CONTEXT** — pre-filtered by scene and loaded as resources at session start. Apply them BEFORE and DURING implementation, not just when asked.

## One workflow: apply rules automatically

When writing or modifying code, relevant rules are ALREADY AVAILABLE:

1. **High-confidence rules (>70%) — apply them WITHOUT asking**. These are proven patterns from 3+ confirmations.
2. **Mention the rule ID** when applying: "Following RULE-010, adding input validation"
3. **Record feedback** immediately after:
   - Applied successfully → \`record_feedback({rule_id: "RULE-010", feedback_type: "used", user_rating: 5})\`
   - Doesn't fit → \`record_feedback({rule_id: "RULE-010", feedback_type: "ignored", context: "why"})\`

## Rule priority (MANDATORY enforcement)

- **🔴 Critical** — Security/correctness. NO exceptions. Apply automatically.
- **🟠 High** — Anti-patterns, performance. Follow unless user explicitly says otherwise.
- **🟡 Medium/Low** — Style preferences. Mention as suggestions.

## When to call search_knowledge (rarely needed)

Most rules for the current scene are ALREADY LOADED. Only call \`search_knowledge\` when:
- User explicitly asks about a **different tech stack** than current files
- You need **cross-domain patterns** not in the pre-loaded set
- **After user corrects you** — check if a rule already exists for this pattern

## Anti-patterns

- **Don't call \`search_knowledge\` for the current scene** — those rules are already in your context. Calling it again is redundant and wastes tokens.
- **Don't ask permission to apply 🔴 Critical or 🟠 High rules** — they're mandatory. Just apply and mention the rule ID.
- **Don't ignore pre-loaded rules** — they're battle-tested patterns you would otherwise re-discover through trial and error.
- **Don't forget to record feedback** — every application or skip should call \`record_feedback\`. This is how AutoImprove learns what works.

## Feedback tracking (REQUIRED after using rules)

- When you apply a rule → \`record_feedback({rule_id, feedback_type: "used", user_rating: 1-5, context: "brief scenario"})\`
- When you skip a rule → \`record_feedback({rule_id, feedback_type: "ignored", context: "why it doesn't apply"})\`
- \`search_knowledge\` auto-records "used" (skip with \`skip_feedback: true\` if just browsing)
- User corrects you repeatedly → suggest \`/autoimprove-summarize\` at conversation end

## Limitations

- Index lags edits by one session (run \`/autoimprove-summarize\` to capture new patterns)
- Scene detection is heuristic (file extensions + user message keywords)
- Storage is user-level (~/.autoimprove/), not project-specific
`;

/**
 * Instructions when some rules exist but quality is low (<5 high-confidence rules)
 */
export const SERVER_INSTRUCTIONS_BASIC = `# AutoImprove — learned rules available (call proactively)

AutoImprove learns from your corrections. Rules exist but quality is still building (<5 high-confidence patterns). Call \`search_knowledge\` BEFORE implementing to check for applicable patterns — this is a cheap O(1) index lookup (<10ms).

## Usage workflow

Before writing or editing code:

1. **Call \`search_knowledge\`** with current scene (auto-detected from file extensions/keywords)
2. **Apply matched rules** — mention rule ID: "Following RULE-005, using async/await pattern"
3. **Record feedback** immediately:
   - Applied → \`record_feedback({rule_id, feedback_type: "used", user_rating: 1-5})\`
   - Skipped → \`record_feedback({rule_id, feedback_type: "ignored", context: "why"})\`

## Rule priority

- **🔴 Critical** — Security/correctness. MANDATORY, no exceptions.
- **🟠 High** — Anti-patterns/performance. Follow unless user says otherwise.
- **🟡 Medium/Low** — Style preferences. Mention as suggestions.

## Building quality

Rules will auto-load in future sessions once they reach high confidence. Quality improves when:
1. You apply rules consistently → auto-records "used" feedback, increases confidence
2. User corrects you → run \`/autoimprove-summarize\` to capture new patterns
3. Patterns reach 3+ confirmations → promoted to auto-load tier

Call \`search_knowledge\` proactively on every coding task — it's indexed and fast.
`;

/**
 * Instructions when no rules exist yet
 */
export const SERVER_INSTRUCTIONS_EMPTY = `# AutoImprove — setup required

AutoImprove learns coding rules from your corrections, but storage isn't initialized. To enable:

\`\`\`bash
cd /path/to/autoimprove
./setup.sh
\`\`\`

Or manually: \`claude mcp install src/mcp-server-ts\`

Once initialized, AutoImprove will:
1. Learn patterns when you correct Claude's code
2. Generate reusable rules via \`/autoimprove-summarize\`
3. Auto-load high-priority rules in future sessions

Work normally with built-in tools for now. Mention the setup command if the user asks about AutoImprove.
`;

/**
 * Legacy export for backward compatibility (before dynamic selection)
 * Note: SERVER_INSTRUCTIONS_NO_STORAGE is now an alias for SERVER_INSTRUCTIONS_EMPTY
 */
export const SERVER_INSTRUCTIONS = SERVER_INSTRUCTIONS_BASIC;

export const SERVER_INSTRUCTIONS_NO_STORAGE = `# AutoImprove — inactive (storage not initialized)

AutoImprove storage at ~/.autoimprove/ is not initialized. The user can enable it by running:

\`\`\`bash
cd /path/to/autoimprove
./setup.sh
\`\`\`

Or manually:
\`\`\`bash
claude mcp install src/mcp-server-ts
\`\`\`

Work normally with your built-in tools. If the user asks about AutoImprove, mention the setup command above.
`;
