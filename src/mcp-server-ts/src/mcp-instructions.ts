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
 * Unified instructions for all rule availability levels
 */
export const SERVER_INSTRUCTIONS_UNIFIED = `# AutoImprove — proactive rule lookup

AutoImprove learns coding rules from your past corrections. Call \`search_knowledge\` BEFORE implementing features to check for applicable patterns — it's a fast O(1) index lookup (<10ms).

## Usage workflow

Before writing or editing code:

1. **Call \`search_knowledge\`** with current scene (auto-detected from file extensions/keywords)
   - Example: \`search_knowledge({scene_json: '{"tech":["react"],"functional":["auth"]}', keywords: "token,validation"})\`
2. **Apply matched rules** — mention rule ID: "Following RULE-005, using async/await pattern"
3. **Feedback is auto-recorded** — \`search_knowledge\` automatically tracks "used" when rules match
4. **Manual feedback only for exceptions**:
   - Rule doesn't fit → \`record_feedback({rule_id, feedback_type: "ignored", context: "why"})\`
   - User corrects rule → \`record_feedback({rule_id, feedback_type: "corrected", context: "what changed"})\`

## Rule priority

- **🔴 Critical** — Security/correctness. MANDATORY, no exceptions.
- **🟠 High** — Anti-patterns/performance. Follow unless user says otherwise.
- **🟡 Medium/Low** — Style preferences. Mention as suggestions.

## When to call search_knowledge

- **Before implementing** any feature or fix (proactive lookup)
- **After user corrects you** — check if a rule already exists for this pattern
- **When switching tech stacks** — get domain-specific patterns

## Anti-patterns

- **Don't skip \`search_knowledge\`** — it's fast and prevents reinventing known patterns
- **Don't manually record "used" feedback** — \`search_knowledge\` does this automatically
- **Don't ask permission for 🔴 Critical rules** — just apply and mention the rule ID

## Building quality

Quality improves when:
1. You call \`search_knowledge\` consistently → builds usage data
2. User corrects you → run \`/autoimprove-summarize\` to capture new patterns
3. Rules get validated through repeated use → confidence increases

## Limitations

- Index lags edits by one session (run \`/autoimprove-summarize\` to capture new patterns)
- Scene detection is heuristic (file extensions + user message keywords)
- Storage is user-level (~/.autoimprove/), not project-specific
`;

// Legacy exports for backward compatibility
export const SERVER_INSTRUCTIONS_RICH = SERVER_INSTRUCTIONS_UNIFIED;
export const SERVER_INSTRUCTIONS_BASIC = SERVER_INSTRUCTIONS_UNIFIED;

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
 */
export const SERVER_INSTRUCTIONS = SERVER_INSTRUCTIONS_UNIFIED;

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
