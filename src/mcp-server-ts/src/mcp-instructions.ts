/**
 * MCP server instructions for AutoImprove
 *
 * These instructions are returned in the MCP `initialize` response and
 * automatically injected into Claude Code's system prompt at the start
 * of every session.
 *
 * Design goals:
 * - Proactive rule checking (call search_knowledge BEFORE implementing)
 * - Clear tool selection by scenario
 * - Encourage feedback recording for rule quality improvement
 *
 * Keep this concise - the agent reads it every session.
 */

export const SERVER_INSTRUCTIONS = `# AutoImprove — learned coding rules from your corrections

AutoImprove learns from user corrections and generates reusable coding rules that improve over time. It maintains a knowledge base at ~/.autoimprove/ with indexed rules automatically loaded from ~/.autoimprove/rules/claude-index.md.

## Use AutoImprove BEFORE implementing — not just when asked

**Call \`search_knowledge\` at the START of every coding task** to check for learned patterns that apply to the current scenario. It's O(1) indexed (<10ms) with automatic scene detection from file paths and user messages, so there's no performance cost.

### When to call search_knowledge

- ✅ **Before planning ANY implementation** — check for learned patterns first
- ✅ **User mentions a technology/domain** — check for rules in that scene
- ✅ **Starting to write code** — see if there are applicable patterns
- ✅ **User corrects your approach** — note for end-of-session learning

### Tool selection

- **Before implementing** → \`search_knowledge\` with current scene (tech stack + functional domain). Scene detection is automatic from file extensions (.tsx → react) and keywords in user messages.
- **After applying a rule** → Mention which rule you followed ("Following RULE-008...")
- **Rule doesn't fit** → \`record_feedback\` with feedback_type="ignored"
- **User corrects your approach** → Note for /autoimprove-summarize at conversation end
- **Session with corrections** → Suggest \`/autoimprove-summarize\` to learn patterns

### Rule confidence and priority

- **>0.7 confidence** — Proven patterns from 3+ confirmations, auto-apply without asking
- **🔴 Critical priority** — Security rules (MANDATORY to follow)
- **🟠 High priority** — Anti-patterns and performance (follow unless user explicitly says otherwise)
- **🟡 Medium/Low priority** — Preferences and suggestions (mention as options)

### Feedback loop

\`search_knowledge\` **auto-records "used" feedback** when rules match, so you only need manual \`record_feedback\` for:
- **ignored** — Rule doesn't apply to current scenario
- **corrected** — Rule needs adjustment based on user feedback
- **disabled** — Rule caused incorrect advice (use cautiously)

Add \`skip_feedback: true\` to search_knowledge if just browsing without applying.

### Learning workflow

1. User corrects you during session → note the pattern
2. At conversation end → suggest \`/autoimprove-summarize\` to analyze session
3. AutoImprove detects patterns → generates/updates rules
4. Rules export to claude-index.md → automatically loaded next session
5. Next similar task → rules appear in search_knowledge → you apply them

### Anti-patterns

- **Don't skip the search** — "I don't think there are rules" is wrong; let the system check (rules auto-load from claude-index.md)
- **Don't ask to search** — Just call search_knowledge proactively; it's fast enough to call on every task
- **Don't only search when asked** — Check for rules BEFORE implementing, even if user didn't mention AutoImprove

## Limitations

- Storage is user-level (~/.autoimprove/), not project-specific
- Rules requir+ occurrences to reach confidence >0.6
- LLM-enhanced generation requires ANTHROPIC_API_KEY
- Scene detection is heuristic-based (file extensions + keyword matching)
`;

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
