/**
 * Rule quality control for AutoImprove.
 *
 * Provides rule clarity assessment, conflict detection, and merge suggestions.
 */

import { RuleIndexEntry, RuleContent } from "./models.js";

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
    memorySupportScore = 0.5
  ): UnifiedRuleScore {
    const clarity = this.assessClarity(rule);
    const specificity = this.assessSpecificity(rule);
    const actionability = this.assessActionability(rule);
    const contentQuality = clarity * 0.4 + specificity * 0.3 + actionability * 0.3;
    const evidence = Math.max(0, Math.min(1, evidenceConfidence));
    const scope = Math.max(0, Math.min(1, scopeConfidence));
    const memory = Math.max(0, Math.min(1, memorySupportScore));
    const overall = evidence * 0.4 + contentQuality * 0.35 + scope * 0.15 + memory * 0.1;
    const base = this.assessQuality(rule, { ...indexEntry, confidence: evidence });
    return {
      ...base,
      overall,
      evidence_confidence: evidence,
      scope_confidence: scope,
      memory_support_score: memory,
    };
  }
  /**
   * Assess the clarity of a rule
   */
  assessClarity(rule: RuleContent): number {
    let score = 1.0;
    const content = rule.content.toLowerCase();

    // Penalty for vague language
    const vagueWords = ["maybe", "possibly", "sometimes", "might", "could"];
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
    if (rule.content.includes("```") || rule.content.includes("Example:")) {
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

    // Check for specific technical terms
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
    ];
    const foundTerms = technicalTerms.filter((term) => content.includes(term));
    score += foundTerms.length * 0.05;

    // Check for file/path mentions
    if (content.includes("/") || content.includes(".ts") || content.includes(".tsx")) {
      score += 0.1;
    }

    // Penalty for overly general terms
    const generalTerms = ["always", "never", "everything", "all", "any"];
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

    // Bonus for imperative verbs
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
    ];
    const foundVerbs = actionVerbs.filter((verb) => content.includes(verb));
    score += foundVerbs.length * 0.08;

    // Bonus for "do X instead of Y" pattern
    if (content.includes("instead of") || content.includes("rather than")) {
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

    // Cover the common "always use X" vs "never use X" form. The older
    // verb-pair matcher only handled "use X" vs "avoid X" and missed this
    // semantically equivalent contradiction.
    const polarity = (value: string): { subject: string; negative: boolean } | null => {
      const match = value.match(/\b(always|never)\s+(?:use|choose|prefer)\s+(.+?)(?:[.,;]|$)/i);
      return match ? { subject: match[2].trim(), negative: match[1].toLowerCase() === "never" } : null;
    };
    const polarity1 = polarity(content1);
    const polarity2 = polarity(content2);
    if (polarity1 && polarity2 && polarity1.negative !== polarity2.negative && this.calculateSimilarity(polarity1.subject, polarity2.subject) > 0.2) {
      return `Rules have opposite polarity for "${polarity1.subject}"`;
    }

    // Simple heuristic: opposite verbs
    const opposites = [
      ["use", "avoid"],
      ["prefer", "avoid"],
      ["always", "never"],
      ["enable", "disable"],
      ["add", "remove"],
    ];

    for (const [verb1, verb2] of opposites) {
      // Extract subject after verb
      const pattern1 = new RegExp(`${verb1}\\s+([\\w\\s]+?)(?:[.,;]|$)`, "i");
      const pattern2 = new RegExp(`${verb2}\\s+([\\w\\s]+?)(?:[.,;]|$)`, "i");

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
   * Calculate text similarity (Jaccard similarity on words)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

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

    // Only suggest merge if average similarity > 0.6
    if (avgSimilarity < 0.2) {
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
