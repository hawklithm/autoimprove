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
export const SERVER_INSTRUCTIONS_UNIFIED = `# AutoImprove — learned-rule lookup

Instead of inferring conventions by reading existing code or guessing patterns, call \`search_knowledge\`: it returns rules your past corrections already established. One call (<10ms) can replace reading 3–5 files to discover “how do we do X here?”.

## When to call (before any task — not just code changes)

- **Analysis** — "how does X work", "why Y", "where is Z", tracing or explaining a flow → query the tech/domain before investigating.
- **File operations** — read/edit/write/move/create → query established patterns for that file's area first.
- **Implement/add X** → query the feature's tech and domain.
- **Fix/debug X** → query the error, component, and stack before investigating.
- **Refactor X** → query established architecture and style patterns.
- User corrects you → query the pattern, then run \`/autoimprove-summarize\` after the session to capture a new rule.

Example: \`search_knowledge({scene_json: '{"tech":["react"],"functional":["auth"]}', keywords: "token,validation"})\`.

Apply matched rules and cite their IDs (for example, “Following RULE-005…”). Searches record “used” feedback automatically; use \`record_feedback\` only when a rule is ignored or corrected.

## Rule priority

- **🔴 Critical** — Security/correctness. MANDATORY, no exceptions.
- **🟠 High** — Anti-patterns/performance. Follow unless user says otherwise.
- **🟡 Medium/Low** — Style preferences. Mention as suggestions.

## Anti-patterns

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

/** Instructions for initialized storage that has not learned rules yet. */
export const SERVER_INSTRUCTIONS_WARMING_UP = `# AutoImprove — warming up

AutoImprove storage is ready but no rules have been learned yet. Call \`search_knowledge\` proactively before any task — analysis, file operations, or code changes — even when no conventions seem to apply; it will confirm whether prior guidance exists without failing. After the user corrects you, run \`/autoimprove-summarize\` to capture patterns so future sessions can surface them here.
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
