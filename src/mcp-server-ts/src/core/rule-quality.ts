/**
 * Rule quality control for AutoImprove.
 *
 * Provides rule clarity assessment, conflict detection, and merge suggestions.
 */

import { RuleIndexEntry, RuleContent } from "./models.js";
import { tokenizeWithJieba } from "./jieba-utils.js";
import { checkMetaContent } from "./pattern-noise-filter.js";

export interface RuleQualityScore {
  overall: number;
  clarity: number;
  specificity: number;
  actionability: number;
  issues: string[];
  suggestions: string[];
}

export interface UnifiedRuleScore extends RuleQualityScore {
  evidence_confidence: number;
  scope_confidence: number;
  memory_support_score: number;
  /** Phase 3: how coding-relevant the rule is (0-1) */
  technical_relevance: number;
  /** Phase 3: completeness of the rule's scene coverage (0-1) */
  scene_completeness: number;
}

/** Single score used for persistence, filtering, and export decisions. */
export const UNIFIED_RULE_MIN_SCORE = 0.6;

export interface RuleConflict {
  rule1_id: string;
  rule2_id: string;
  conflict_type: "contradiction" | "overlap" | "redundancy";
  severity: "high" | "medium" | "low";
  description: string;
  resolution_suggestions: string[];
}

export interface MergeProposal {
  rule_ids: string[];
  merged_content: string;
  merged_reason: string;
  confidence: number;
  rationale: string;
}

export class RuleQualityController {
  assessUnifiedScore(
    rule: RuleContent,
    indexEntry: RuleIndexEntry,
    evidenceConfidence: number,
    scopeConfidence = 0.5,
    memorySupportScore = 0.5,
    technicalRelevance?: number,
    sceneCompleteness?: number
  ): UnifiedRuleScore {
    const clarity = this.assessClarity(rule);
    const specificity = this.assessSpecificity(rule);
    const actionability = this.assessActionability(rule);
    const techRel = technicalRelevance ?? this.assessTechnicalRelevance(rule, indexEntry);
    const sceneComp = sceneCompleteness ?? this.assessSceneCompleteness(indexEntry);
    const evidence = Math.max(0, Math.min(1, evidenceConfidence));
    const scope = Math.max(0, Math.min(1, scopeConfidence));
    const memory = Math.max(0, Math.min(1, memorySupportScore));

    // Phase 3 weighting (sums to 1.0):
    // evidence 0.25 | clarity 0.15 | specificity 0.15 | actionability 0.15 |
    // scope 0.10 | technicalRelevance 0.15 | sceneCompleteness 0.05
    const overall =
      evidence * 0.25 +
      clarity * 0.15 +
      specificity * 0.15 +
      actionability * 0.15 +
      scope * 0.10 +
      techRel * 0.15 +
      sceneComp * 0.05;

    const base = this.assessQuality(rule, { ...indexEntry, confidence: evidence });
    return {
      ...base,
      overall,
      evidence_confidence: evidence,
      scope_confidence: scope,
      memory_support_score: memory,
      technical_relevance: techRel,
      scene_completeness: sceneComp,
    };
  }

  /**
   * Phase 3: technical relevance (0-1). Measures how coding/engineering-specific
   * the rule is. Business-only rules score low; rules with code keywords, tech
   * stack labels, or file paths score high.
   */
  assessTechnicalRelevance(rule: RuleContent, indexEntry?: RuleIndexEntry): number {
    const content = (rule.content || "").toLowerCase();
    let score = 0;

    const codeKeywords = [
      "function", "class", "method", "api", "endpoint", "component", "hook", "module",
      "import", "export", "async", "await", "promise", "type", "interface", "query",
      "database", "test", "build", "deploy", "docker", "kubernetes", "cache", "typescript",
      "javascript", "python", "react", "vue", "node", "sql", "graphql", "http", "rest",
    ];
    const hits = codeKeywords.filter((k) => content.includes(k));
    score += Math.min(hits.length * 0.1, 0.6); // up to 0.6 from keyword density

    // Tech stack labels in keywords / scenes boost relevance.
    const techLabels = (indexEntry?.keywords || []).concat(indexEntry?.scenes?.tech || []);
    const techHit = techLabels.filter((t) => /[a-z0-9+#]/i.test(t) && t.length > 1).length;
    score += Math.min(techHit * 0.05, 0.25);

    // File-path / code-block signals.
    if (content.includes("```") || /\.\w{1,4}\b/.test(content) || content.includes("/")) {
      score += 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Phase 3: scene completeness (0-1). Empty scenes → 0; full coverage of
   * tech / functional / business → 1.
   */
  assessSceneCompleteness(indexEntry: RuleIndexEntry): number {
    const scenes = indexEntry.scenes;
    if (!scenes) return 0;
    const dims = [scenes.tech || [], scenes.functional || [], scenes.business || []];
    const filled = dims.filter((d) => d.length > 0).length;
    if (filled === 0) return 0;
    return filled / dims.length;
  }
  /**
   * Assess the clarity of a rule
   */
  assessClarity(rule: RuleContent): number {
    let score = 1.0;
    const content = rule.content.toLowerCase();

    // Penalty for vague language (English + Chinese)
    const vagueWords = [
      "maybe", "possibly", "sometimes", "might", "could",
      "也许", "可能", "或许", "大概", "有时", "尽量",
    ];
    for (const word of vagueWords) {
      if (content.includes(word)) {
        score -= 0.21;
      }
    }

    // Penalty for too short (< 20 chars)
    if (rule.content.length < 20) {
      score -= 0.3;
    }

    // Penalty for too long (> 500 chars without structure)
    if (rule.content.length > 500 && !rule.content.includes("\n")) {
      score -= 0.2;
    }

    // Bonus for examples or code
    if (rule.content.includes("```") || rule.content.includes("Example:") || rule.content.includes("示例") || rule.content.includes("例子")) {
      score += 0.1;
    }

    // Bonus for clear structure (bullet points, numbering)
    if (rule.content.match(/^[-*]\s/m) || rule.content.match(/^\d+\.\s/m)) {
      score += 0.15;
    }

    return Math.max(0, Math.min(1.0, score));
  }

  /**
   * Assess rule specificity
   */
  assessSpecificity(rule: RuleContent): number {
    let score = 0.5;
    const content = rule.content.toLowerCase();

    // P1-C3: meta / self-reference boilerplate (e.g. "strictly follow the rules",
    // "avoid hardcoding memory support values") is the opposite of a specific,
    // project-grounded rule — penalize hard so such noise scores low and gets cleaned.
    if (checkMetaContent(rule.content).noise) {
      score -= 0.5;
    }

    // Check for specific technical terms (English + Chinese)
    const technicalTerms = [
      "useeffect",
      "async/await",
      "props",
      "state",
      "component",
      "api",
      "database",
      "query",
      "function",
      "class",
      "组件",
      "状态",
      "函数",
      "类",
      "数据库",
      "查询",
      "接口",
      "异步",
      "渲染",
      "钩子",
      "模块",
    ];
    const foundTerms = technicalTerms.filter((term) => content.includes(term));
    score += foundTerms.length * 0.05;

    // Check for file/path mentions
    if (content.includes("/") || content.includes(".ts") || content.includes(".tsx")) {
      score += 0.1;
    }

    // Penalty for overly general terms (English + Chinese)
    const generalTerms = ["always", "never", "everything", "all", "any", "总是", "从不", "所有", "任何", "全部", "一切"];
    for (const term of generalTerms) {
      if (content.includes(term)) {
        score -= 0.05;
      }
    }

    return Math.max(0, Math.min(1.0, score));
  }

  /**
   * Assess rule actionability
   */
  assessActionability(rule: RuleContent): number {
    let score = 0.5;
    const content = rule.content.toLowerCase();

    // Bonus for imperative verbs (English + Chinese)
    const actionVerbs = [
      "use",
      "avoid",
      "prefer",
      "ensure",
      "check",
      "validate",
      "wrap",
      "extract",
      "refactor",
      "implement",
      "使用",
      "避免",
      "优先",
      "确保",
      "检查",
      "验证",
      "封装",
      "提取",
      "重构",
      "实现",
      "采用",
    ];
    const foundVerbs = actionVerbs.filter((verb) => content.includes(verb));
    score += foundVerbs.length * 0.08;

    // Bonus for "do X instead of Y" pattern (English + Chinese)
    if (content.includes("instead of") || content.includes("rather than") || content.includes("而不是") || content.includes("而非")) {
      score += 0.15;
    }

    // Bonus for concrete steps
    if (content.match(/\d+\.\s/)) {
      score += 0.1;
    }

    return Math.max(0, Math.min(1.0, score));
  }

  /**
   * Comprehensive quality assessment
   */
  assessQuality(rule: RuleContent, indexEntry: RuleIndexEntry): RuleQualityScore {
    const clarity = this.assessClarity(rule);
    const specificity = this.assessSpecificity(rule);
    const actionability = this.assessActionability(rule);

    const overall = clarity * 0.4 + specificity * 0.3 + actionability * 0.3;

    const issues: string[] = [];
    const suggestions: string[] = [];

    // Identify issues
    if (clarity < 0.5) {
      issues.push("Rule description is unclear or vague");
      suggestions.push("Add specific examples or code snippets");
    }

    if (specificity < 0.4) {
      issues.push("Rule is too general");
      suggestions.push("Add context about when and where this rule applies");
    }

    if (actionability < 0.4) {
      issues.push("Rule doesn't provide clear action");
      suggestions.push("Use imperative verbs and provide concrete steps");
    }

    if (indexEntry.confidence < 0.4) {
      issues.push("Low confidence score");
      suggestions.push("Need more evidence (occurrences or validation)");
    }

    if (!indexEntry.keywords || indexEntry.keywords.length === 0) {
      suggestions.push("Consider adding keywords for better matching");
    }

    return {
      overall,
      clarity,
      specificity,
      actionability,
      issues,
      suggestions,
    };
  }

  /**
   * Detect conflicts between rules
   */
  detectConflicts(newRule: RuleContent, existingRules: Array<{ index: RuleIndexEntry; content: RuleContent }>): RuleConflict[] {
    const conflicts: RuleConflict[] = [];

    for (const existing of existingRules) {
      // Skip same rule
      if (existing.content.id === newRule.id) {
        continue;
      }

      // Check for contradiction
      const contradiction = this.checkContradiction(newRule, existing.content);
      if (contradiction) {
        conflicts.push({
          rule1_id: newRule.id,
          rule2_id: existing.content.id,
          conflict_type: "contradiction",
          severity: "high",
          description: contradiction,
          resolution_suggestions: [
            "Review both rules and determine which is correct",
            "Consider if they apply to different contexts",
            "Merge into a single rule with conditional logic",
          ],
        });
      }

      // Check for overlap (similar content but not identical)
      const similarity = this.calculateSimilarity(newRule.content, existing.content.content);
      if (similarity > 0.7 && similarity < 0.95) {
        conflicts.push({
          rule1_id: newRule.id,
          rule2_id: existing.content.id,
          conflict_type: "overlap",
          severity: "medium",
          description: `Rules have ${(similarity * 100).toFixed(0)}% similarity`,
          resolution_suggestions: [
            "Consider merging these rules",
            "Clarify the differences in scope or context",
            "Keep as separate if they apply to different scenarios",
          ],
        });
      }

      // Check for redundancy (almost identical)
      if (similarity >= 0.95) {
        conflicts.push({
          rule1_id: newRule.id,
          rule2_id: existing.content.id,
          conflict_type: "redundancy",
          severity: "low",
          description: "Rules are nearly identical",
          resolution_suggestions: [
            "Merge these rules into one",
            "Delete the redundant rule",
            "Update the existing rule if new one has better evidence",
          ],
        });
      }
    }

    return conflicts;
  }

  /**
   * Check for contradiction between two rules
   */
  private checkContradiction(rule1: RuleContent, rule2: RuleContent): string | null {
    const content1 = rule1.content.toLowerCase();
    const content2 = rule2.content.toLowerCase();

    // Cover the common "always use X" vs "never use X" form, for both English
    // ("always use X") and Chinese ("总是使用X"). The older verb-pair matcher
    // only handled "use X" vs "avoid X" and missed this semantically
    // equivalent contradiction.
    const polarity = (value: string): { subject: string; negative: boolean } | null => {
      const en = value.match(/\b(always|never)\s+(?:use|choose|prefer)\s+(.+?)(?:[.,;]|$)/i);
      if (en) return { subject: en[2].trim(), negative: en[1].toLowerCase() === "never" };
      const cjk = value.match(/(?:总是|绝不|从不|不要)\s*(?:使用|选择|采用|用|优先)\s*([一-鿿㐀-䶿A-Za-z0-9_]+)/);
      if (cjk) return { subject: cjk[1], negative: /(?:绝不|从不|不要)/.test(cjk[0]) };
      return null;
    };
    const polarity1 = polarity(content1);
    const polarity2 = polarity(content2);
    if (polarity1 && polarity2 && polarity1.negative !== polarity2.negative && this.calculateSimilarity(polarity1.subject, polarity2.subject) > 0.2) {
      return `Rules have opposite polarity for "${polarity1.subject}"`;
    }

    // Simple heuristic: opposite verbs (English + Chinese), CJK-aware subjects.
    const opposites = [
      ["use", "avoid"],
      ["prefer", "avoid"],
      ["always", "never"],
      ["enable", "disable"],
      ["add", "remove"],
      ["使用", "避免"],
      ["优先", "避免"],
      ["总是", "从不"],
      ["启用", "禁用"],
      ["添加", "移除"],
    ];

    const SUBJECT_RE = "[一-鿿㐀-䶿A-Za-z0-9_\\s]+?";

    for (const [verb1, verb2] of opposites) {
      // Extract subject after verb
      const pattern1 = new RegExp(`${verb1}\\s*(${SUBJECT_RE})(?:[.,;，。]|$)`);
      const pattern2 = new RegExp(`${verb2}\\s*(${SUBJECT_RE})(?:[.,;，。]|$)`);

      const match1 = content1.match(pattern1);
      const match2 = content2.match(pattern2);

      if (match1 && match2) {
        const subject1 = match1[1].trim();
        const subject2 = match2[1].trim();

        // Check if subjects are similar
        const subjectSimilarity = this.calculateSimilarity(subject1, subject2);
        if (subjectSimilarity > 0.6) {
          return `Rule 1 says "${verb1} ${subject1}" while Rule 2 says "${verb2} ${subject2}"`;
        }
      }
    }

    return null;
  }

  /**
   * Calculate text similarity (Jaccard similarity on tokens).
   *
   * Uses jieba-based tokenization so Chinese text is split into words instead
   * of being treated as a single whitespace-delimited token (which made the
   * similarity collapse to 0 or 1 for Chinese rules).
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(tokenizeWithJieba(text1));
    const words2 = new Set(tokenizeWithJieba(text2));

    if (words1.size === 0 && words2.size === 0) return 0;

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Suggest merging similar rules
   */
  suggestMerge(similarRules: Array<{ index: RuleIndexEntry; content: RuleContent }>): MergeProposal | null {
    if (similarRules.length < 2) {
      return null;
    }

    // Calculate pairwise similarities
    const similarities: number[] = [];
    for (let i = 0; i < similarRules.length - 1; i++) {
      for (let j = i + 1; j < similarRules.length; j++) {
        const sim = this.calculateSimilarity(
          similarRules[i].content.content,
          similarRules[j].content.content
        );
        similarities.push(sim);
      }
    }

    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;

    // Only suggest a merge when the rules are on the same topic (>= 0.25
    // token overlap). This is deliberately looser than the 0.80 auto-merge
    // threshold in RuleDeduplicator: suggestMerge produces *candidates for
    // human review*, so it should surface same-topic rules that are similar
    // but not exact duplicates. Below 0.25 the rules are distinct enough to
    // keep separate.
    if (avgSimilarity < 0.25) {
      return null;
    }

    // Merge content: combine unique points
    const allContents = similarRules.map((r) => r.content.content);
    const mergedContent = this.mergeContents(allContents);

    // Merge reasons
    const allReasons = similarRules.map((r) => r.content.reason);
    const mergedReason = allReasons.join("; ");

    // Average confidence
    const avgConfidence =
      similarRules.reduce((sum, r) => sum + r.index.confidence, 0) / similarRules.length;

    return {
      rule_ids: similarRules.map((r) => r.index.id),
      merged_content: mergedContent,
      merged_reason: mergedReason,
      confidence: avgConfidence,
      rationale: `${similarRules.length} similar rules (${(avgSimilarity * 100).toFixed(0)}% similarity) can be merged into one comprehensive rule`,
    };
  }

  /**
   * Merge multiple rule contents intelligently
   */
  private mergeContents(contents: string[]): string {
    // Extract unique sentences/points
    const points = new Set<string>();

    for (const content of contents) {
      // Split by sentences or bullet points
      const sentences = content.split(/[.!?]\s+|\n[-*]\s+/);
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length > 10) {
          points.add(trimmed);
        }
      }
    }

    // Format as bullet points if multiple points
    if (points.size > 1) {
      return Array.from(points)
        .map((p) => `- ${p}`)
        .join("\n");
    } else {
      return Array.from(points).join(". ");
    }
  }

  /**
   * Enhance rule description (prepare for potential LLM integration)
   */
  enhanceDescription(rule: RuleContent, context?: { occurrences?: number; sessions?: number }): string {
    let enhanced = rule.content;

    // Add context information if available
    if (context) {
      const footer = [];
      if (context.occurrences) {
        footer.push(`Observed ${context.occurrences} time(s)`);
      }
      if (context.sessions) {
        footer.push(`across ${context.sessions} session(s)`);
      }
      if (footer.length > 0) {
        enhanced += `\n\n_${footer.join(", ")}_`;
      }
    }

    return enhanced;
  }
}
