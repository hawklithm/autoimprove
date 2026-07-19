export const SEARCH_KNOWLEDGE_DESCRIPTION = `PRIMARY TOOL — call FIRST before any task, not just code changes.

Call this before doing analysis (investigating, tracing, explaining, planning) or executing file operations (read/edit/write/move/create), as well as when implementing, fixing, debugging, or refactoring.

Instead of guessing patterns or inferring conventions by reading existing code, call this first — it returns rules learned from your past corrections in <10ms. Match user requests such as "implement X", "fix Y", "why Z broken", "add feature", "debug", "how does X work", "where is Y", and "update/read this file".

Examples:
- search_knowledge({keywords: "auth,token,validation", scene_json: '{"tech":["react"],"functional":["auth"]}'})
- search_knowledge({keywords: "timeout,error", scene_json: '{"tech":["python"],"functional":["api","debug"]}'})
- search_knowledge({keywords: "migration,transaction", scene_json: '{"tech":["typescript"],"functional":["database"]}'})
- search_knowledge({}) — list all rules (omit keywords to browse, do NOT pass empty string)

Search by scene, keywords, or rule ID with scope-based filtering. Returns matched rules' IDs + content — cite the rule ID when applying (e.g. "Following RULE-005…"). Auto-records "used" feedback for matched rules unless skip_feedback=true.

⚠️  keywords parameter: must not be empty or whitespace-only. If you want to list all rules, omit keywords entirely (pass no keywords parameter), not an empty string.`;

export function emptyKnowledgeBaseMessage(): string {
  return "No rules in the knowledge base yet. After this coding session, run `npm run summarize` (or `tsx summarize.ts`) in the autoimprove repo to capture patterns from your corrections — future sessions will then surface them here.";
}

export function noMatchMessage(similarRuleIds: string[] = []): string {
  const references = similarRuleIds.length
    ? `\n\nClosest available rules for reference: ${similarRuleIds.map((id) => `\`${id}\``).join(", ")}.`
    : "";
  return "No rules matched this scene. Try broadening keywords, or this area may not have learned patterns yet." + references;
}
