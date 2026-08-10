/**
 * Pattern / rule noise filtering.
 *
 * During summarize, some "patterns" are not real project conventions but
 * meta-discussions about the assistant/tool itself (e.g. "strictly follow the
 * rules", "avoid hardcoding memory support values") or self-referential
 * boilerplate. Left alone they become noise rules that teach the learner about
 * itself. This module detects and filters them (defect C, P1-C1) and applies a
 * generality discount to generic best-practice rules that carry no
 * project-specific signal (P1-C2).
 */

import { Pattern } from "./models.js";

/**
 * Meta / system-prompt boilerplate phrases that should never become a learned
 * rule. Matching is case-insensitive substring. Covers English and Chinese.
 */
export const NOISE_PHRASES: string[] = [
  // English
  "strictly follow the rules",
  "strictly follow rules",
  "follow the defined rules",
  "adhere to the defined rules",
  "adhere to the rules",
  "complete multi-step tasks",
  "completing multi-step tasks",
  "after completing multi-step tasks",
  "system prompt",
  "system prompt says",
  "you are an ai",
  "you are a helpful ai",
  "as an ai assistant",
  "as an ai language model",
  "memory support",
  "memory support value",
  "meta-instruction",
  "meta instruction",
  "autoimprove",
  "the autoimprove",
  // Chinese
  "严格遵循规则",
  "严格遵循既定规则",
  "遵循既定规则",
  "遵循既定的规则",
  "完成多步任务",
  "在完成多步任务后",
  "在完成多步任务之前",
  "系统提示",
  "系统提示词",
  "作为ai",
  "作为人工智能",
  "作为助手",
  "记忆支持",
  "记忆支持值",
  "元指令",
  "元指令",
  "关于工具本身",
  "关于自身",
  "助手自身的规范",
  "自身的规范",
  "学习器",
  "本工具自身",
];

/**
 * Self-reference phrases indicating the content is about the assistant/tool/
 * system itself rather than a concrete project convention.
 */
export const SELF_REFERENCE_PHRASES: string[] = [
  "the rule itself",
  "this rule itself",
  "the system itself",
  "the assistant's own",
  "the assistant itself",
  "the tool itself",
  "our own guidelines",
  "about itself",
  "the learner",
  "规则本身",
  "本规则",
  "本系统",
  "本工具",
  "本助手",
  "元规则",
  "关于自身",
  "关于工具自身",
];

/**
 * Project-root hints that, if a pattern is scoped to them, mean the learner is
 * learning about itself (the autoimprove codebase) rather than a real project.
 */
export const SELF_REFERENCE_PROJECT_HINTS: string[] = [
  "autoimprove",
  "mcp-server-ts",
  "src/mcp-server-ts",
];

export interface NoiseCheckResult {
  noise: boolean;
  reasons: string[];
}

/**
 * Check free text (rule/pattern/memory content) for meta or self-referential
 * boilerplate. Returns every reason that matched so callers can log/debug.
 */
export function checkMetaContent(text: string): NoiseCheckResult {
  const t = (text || "").toLowerCase();
  const reasons: string[] = [];
  if (!t.trim()) return { noise: false, reasons };

  for (const phrase of NOISE_PHRASES) {
    if (t.includes(phrase.toLowerCase())) {
      reasons.push(`meta-phrase:${phrase}`);
    }
  }
  for (const phrase of SELF_REFERENCE_PHRASES) {
    if (t.includes(phrase.toLowerCase())) {
      reasons.push(`self-ref:${phrase}`);
    }
  }
  return { noise: reasons.length > 0, reasons: Array.from(new Set(reasons)) };
}

/**
 * True when the pattern's scope points at the autoimprove codebase itself
 * (the learner studying its own source) rather than a real user project.
 */
export function isProjectSelfReference(pattern: Pattern): boolean {
  const paths = pattern.project_paths || [];
  const haystack = (paths.join(" ") + " " + (pattern.keywords || []).join(" ")).toLowerCase();
  return SELF_REFERENCE_PROJECT_HINTS.some((h) => haystack.includes(h));
}

/**
 * Determine whether a pattern is noise that should not become a rule.
 */
export function isNoisePattern(pattern: Pattern): NoiseCheckResult {
  const text = [
    pattern.description,
    (pattern.keywords || []).join(" "),
    (pattern.evidence_excerpts || []).join(" "),
    (pattern.occurrences || []).map((o) => o.context || "").join(" "),
  ].join(" ");

  const meta = checkMetaContent(text);
  const reasons = [...meta.reasons];
  let noise = meta.noise;

  if (isProjectSelfReference(pattern)) {
    noise = true;
    reasons.push("project-self-reference");
  }
  return { noise, reasons: Array.from(new Set(reasons)) };
}

export interface FilterResult {
  kept: Pattern[];
  removed: { pattern: Pattern; reasons: string[] }[];
}

/**
 * Split a pattern list into kept (real conventions) and removed (noise).
 */
export function filterNoisePatterns(patterns: Pattern[]): FilterResult {
  const kept: Pattern[] = [];
  const removed: { pattern: Pattern; reasons: string[] }[] = [];
  for (const p of patterns) {
    const r = isNoisePattern(p);
    if (r.noise) removed.push({ pattern: p, reasons: r.reasons });
    else kept.push(p);
  }
  return { kept, removed };
}

/**
 * P1-C2: generality discount. A pattern that is a generic best-practice
 * (global scope, no project-specific signal) gets a mild confidence discount so
 * it must clear a higher bar to become a rule. Returns a multiplier in (0, 1].
 */
export function generalityDiscount(pattern: Pattern): number {
  const hasProjectSignal =
    (pattern.project_paths && pattern.project_paths.length > 0) ||
    (pattern.keywords || []).some((k) =>
      // a concrete tech/framework token implies a real, project-specific rule
      /^(react|vue|angular|typescript|javascript|python|node|express|prisma|graphql|postgres|mysql|sqlite|django|flask|spring|kotlin|go|rust|java)\b/i.test(
        k
      )
    );
  return hasProjectSignal ? 1.0 : 0.85;
}
