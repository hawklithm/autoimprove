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
export const SERVER_INSTRUCTIONS_RICH = `# AutoImprove — learned coding rules auto-loaded

AutoImprove learns from your corrections and generates reusable rules. High-priority rules matching the current tech stack are **automatically loaded into this session** — you don't need to search for them explicitly. Apply them when relevant.

## Automatically loaded rules

Rules are pre-filtered by scene (tech stack + functional domain) and loaded as resources at session start. When a rule applies to the current task:

1. **Auto-apply high-confidence rules (>70%)** without asking
2. **Mention the rule ID** when applying ("Following RULE-010...")
3. **Record feedback** if it doesn't fit: \`record_feedback\` with feedback_type="ignored"

## Rule priority

- **🔴 Critical** — Security rules (MANDATORY to follow, no exceptions)
- **🟠 High** — Anti-patterns and performance (follow unless user explicitly overrides)
- **🟡 Medium/Low** — Preferences (mention as suggestions)

## When to call search_knowledge

Most relevant rules are already loaded, but call \`search_knowledge\` when:
- User asks about a **different tech stack** than current files
- You need rules for a **specific functional domain** (e.g., "authentication", "payment")
- Checking for rules **after user corrects** your approach

## Feedback and learning

- \`search_knowledge\` **auto-records "used" feedback** when called (skip with \`skip_feedback: true\`)
- Manually call \`record_feedback\` for: **ignored** (doesn't apply), **corrected** (needs adjustment), **disabled** (caused bad advice)
- When user corrects you repeatedly → suggest \`/autoimprove-summarize\` at conversation end to learn new patterns

## Anti-patterns

- **Don't ignore loaded rules** — they're proven patterns from 3+ confirmations
- **Don't ask whether to apply Critical (🔴) rules** — they're mandatory (security/correctness)
- **Don't search redundantly** — rules for the current scene are already loaded

## Limitations

- Rules lag by one session (learned patterns appear next session after \`/autoimprove-summarize\`)
- Scene detection is heuristic (file extensions + keywords)
- Storage is user-level (~/.autoimprove/), not project-specific
`;

/**
 * Instructions when some rules exist but quality is low (<5 high-confidence rules)
 */
export const SERVER_INSTRUCTIONS_BASIC = `# AutoImprove — learned coding rules available

AutoImprove learns from your corrections. Some rules exist but quality is still building. Call \`search_knowledge\` BEFORE implementing to check for applicable patterns.

## Usage

- **Before planning** → \`search_knowledge\` with current scene (auto-detected from file paths)
- **After applying a rule** → Mention rule ID ("Following RULE-005...")
- **Rule doesn't fit** → \`record_feedback\` with feedback_type="ignored"
- **User corrects you** → Note pattern, suggest \`/autoimprove-summarize\` at conversation end

## Rule priority

- **🔴 Critical** — Security (MANDATORY)
- **🟠 High** — Anti-patterns/performance (follow unless user says otherwise)
- **🟡 Medium/Low** — Preferences (suggestions)

## Building quality

Current rules have <5 high-confidence patterns. Quality improves as:
1. You apply rules → auto-records "used" feedback
2. User corrects you → run \`/autoimprove-summarize\` to learn
3. Rules gain confirmations → confidence increases → auto-loaded in future sessions

\`search_knowledge\` is O(1) indexed (<10ms), so check proactively on every coding task.
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
