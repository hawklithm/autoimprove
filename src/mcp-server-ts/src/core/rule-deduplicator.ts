/**
 * Rule Deduplicator - Automatic duplicate detection and merging
 *
 * Detects similar rules using multi-dimensional similarity scoring:
 * - Keyword Jaccard similarity (40%)
 * - Description semantic similarity (30%)
 * - Scene overlap (20%)
 * - Type consistency (10%)
 */

import { RuleIndexEntry, RuleContent, RuleScope } from "./models.js";

export interface SimilarityResult {
  existingRuleId: string;
  similarity: number; // 0.0-1.0
  action: "merge" | "keep-separate" | "update-existing";
  reason: string;
  existingRule: RuleIndexEntry;
}

export interface DeduplicationResult {
  action: "added" | "merged" | "updated" | "skipped";
  targetRuleId: string; // ID of final rule (existing or new)
  sourceRuleId?: string; // ID of rule being merged (if applicable)
  similarity?: number;
  reason: string;
}

export class RuleDeduplicator {
  // Similarity thresholds
  private readonly MERGE_THRESHOLD = 0.80; // Auto-merge if ≥80% similar
  private readonly SIMILAR_THRESHOLD = 0.65; // Consider similar if ≥65%

  /**
   * Find similar rules in existing rule set
   */
  findSimilarRules(
    newRule: RuleIndexEntry,
    existingRules: RuleIndexEntry[],
    contentByRuleId?: Map<string, RuleContent>
  ): SimilarityResult[] {
    const similarities: SimilarityResult[] = [];

    for (const existing of existingRules) {
      // Skip if different pattern type (critical rules shouldn't merge with preferences)
      if (newRule.type !== existing.type) {
        continue;
      }

      // Scope is part of a rule's meaning. Never merge global, organization,
      // and project rules, or two different project/organization contexts.
      if (!this.isCompatibleScope(newRule, existing)) {
        continue;
      }

      const similarity = this.calculateSimilarity(
        newRule,
        existing,
        contentByRuleId?.get(newRule.id),
        contentByRuleId?.get(existing.id)
      );

      if (similarity >= this.SIMILAR_THRESHOLD) {
        similarities.push({
          existingRuleId: existing.id,
          similarity,
          action: this.determineAction(similarity),
          reason: this.explainSimilarity(similarity, newRule, existing),
          existingRule: existing,
        });
      }
    }

    // Sort by similarity (highest first)
    return similarities.sort((a, b) => b.similarity - a.similarity);
  }

  private isCompatibleScope(a: RuleIndexEntry, b: RuleIndexEntry): boolean {
    const scopeA = a.scope || RuleScope.GLOBAL;
    const scopeB = b.scope || RuleScope.GLOBAL;
    if (scopeA !== scopeB) return false;
    if (scopeA === RuleScope.PROJECT) {
      const pathA = this.normalizePath(a.scope_context?.project_path);
      const pathB = this.normalizePath(b.scope_context?.project_path);
      return Boolean(pathA && pathB && (pathA === pathB || pathA.startsWith(`${pathB}/`) || pathB.startsWith(`${pathA}/`)));
    }
    if (scopeA === RuleScope.ORGANIZATION) {
      const orgA = a.scope_context?.organization_id;
      const orgB = b.scope_context?.organization_id;
      return Boolean(orgA && orgB && orgA.toLowerCase() === orgB.toLowerCase());
    }
    return true;
  }

  private normalizePath(path: string | undefined): string {
    return (path || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }

  /**
   * Calculate overall similarity between two rules
   */
  calculateSimilarity(rule1: RuleIndexEntry, rule2: RuleIndexEntry, content1?: RuleContent, content2?: RuleContent): number {
    const keywordSim = this.calculateKeywordSimilarity(rule1.keywords, rule2.keywords);
    const descSim = this.calculateDescriptionSimilarity(
      rule1.description || content1?.description || content1?.content || "",
      rule2.description || content2?.description || content2?.content || ""
    );
    const sceneSim = this.calculateSceneSimilarity(rule1.scenes, rule2.scenes);
    const typeSim = rule1.type === rule2.type ? 1.0 : 0.0;

    // Weighted average (keywords and scenes are primary signals)
    return keywordSim * 0.5 + sceneSim * 0.3 + descSim * 0.1 + typeSim * 0.1;
  }

  /**
   * Jaccard similarity for keywords
   */
  private calculateKeywordSimilarity(keywords1: string[], keywords2: string[]): number {
    if (keywords1.length === 0 && keywords2.length === 0) return 1.0;
    if (keywords1.length === 0 || keywords2.length === 0) return 0.0;

    const set1 = new Set(keywords1.map((k) => k.toLowerCase()));
    const set2 = new Set(keywords2.map((k) => k.toLowerCase()));

    const intersection = new Set([...set1].filter((k) => set2.has(k)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Simple description similarity using word overlap
   * (lightweight alternative to embeddings)
   */
  private calculateDescriptionSimilarity(description1: string, description2: string): number {
    if (!description1 || !description2) return 0;
    const words1 = new Set(this.extractWords(description1));
    const words2 = new Set(this.extractWords(description2));
    if (words1.size === 0 && words2.size === 0) return 1;
    if (words1.size === 0 || words2.size === 0) return 0;
    return new Set([...words1].filter(word => words2.has(word))).size /
      new Set([...words1, ...words2]).size;
  }

  /**
   * Extract meaningful words from text
   */
  private extractWords(text: string): string[] {
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "as",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "should",
      "could",
      "may",
      "might",
      "must",
      "can",
      "this",
      "that",
      "these",
      "those",
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));
  }

  /**
   * Calculate scene overlap (tech/functional/business)
   */
  private calculateSceneSimilarity(
    scene1: { tech: string[]; functional: string[]; business: string[] },
    scene2: { tech: string[]; functional: string[]; business: string[] }
  ): number {
    const techSim = this.calculateArraySimilarity(scene1.tech, scene2.tech);
    const funcSim = this.calculateArraySimilarity(scene1.functional, scene2.functional);
    const bizSim = this.calculateArraySimilarity(scene1.business, scene2.business);

    // Average of three dimensions (weight equally)
    return (techSim + funcSim + bizSim) / 3;
  }

  /**
   * Jaccard similarity for arrays
   */
  private calculateArraySimilarity(arr1: string[], arr2: string[]): number {
    if (arr1.length === 0 && arr2.length === 0) return 1.0;
    if (arr1.length === 0 || arr2.length === 0) return 0.0;

    const set1 = new Set(arr1.map((s) => s.toLowerCase()));
    const set2 = new Set(arr2.map((s) => s.toLowerCase()));

    const intersection = new Set([...set1].filter((s) => set2.has(s)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Determine action based on similarity score
   */
  private determineAction(similarity: number): "merge" | "keep-separate" | "update-existing" {
    if (similarity >= this.MERGE_THRESHOLD) {
      return "merge"; // High similarity - merge into existing
    } else if (similarity >= 0.75) {
      return "update-existing"; // Very similar - update existing with new examples
    } else {
      return "keep-separate"; // Moderate similarity - keep as separate rule
    }
  }

  /**
   * Explain why rules are similar
   */
  private explainSimilarity(
    similarity: number,
    rule1: RuleIndexEntry,
    rule2: RuleIndexEntry
  ): string {
    const reasons: string[] = [];

    const keywordSim = this.calculateKeywordSimilarity(rule1.keywords, rule2.keywords);
    if (keywordSim > 0.6) {
      reasons.push(`${(keywordSim * 100).toFixed(0)}% keyword overlap`);
    }

    const sceneSim = this.calculateSceneSimilarity(rule1.scenes, rule2.scenes);
    if (sceneSim > 0.5) {
      reasons.push(`${(sceneSim * 100).toFixed(0)}% scene overlap`);
    }

    if (rule1.type === rule2.type) {
      reasons.push(`same pattern type (${rule1.type})`);
    }

    return reasons.join(", ");
  }

  /**
   * Merge two rules intelligently
   */
  mergeRules(
    existing: RuleIndexEntry,
    newRule: RuleIndexEntry,
    existingContent?: RuleContent,
    newContent?: RuleContent
  ): { indexEntry: RuleIndexEntry; content?: RuleContent } {
    // Merge keywords (union, deduplicate)
    const mergedKeywords = Array.from(
      new Set([...existing.keywords, ...newRule.keywords])
    );

    // Merge scenes (union)
    const mergedScenes = {
      tech: Array.from(new Set([...existing.scenes.tech, ...newRule.scenes.tech])),
      functional: Array.from(
        new Set([...existing.scenes.functional, ...newRule.scenes.functional])
      ),
      business: Array.from(new Set([...existing.scenes.business, ...newRule.scenes.business])),
    };

    // Update confidence (simple average with boost for multiple observations)
    const avgConfidence = (existing.confidence + newRule.confidence) / 2;
    const boostFactor = 0.05; // Small boost for repeated pattern
    const mergedConfidence = Math.min(1.0, avgConfidence + boostFactor);

    // Update timestamps
    const now = new Date().toISOString();

    // Merged index entry
    const mergedEntry: RuleIndexEntry = {
      ...existing,
      keywords: mergedKeywords,
      scenes: mergedScenes,
      confidence: mergedConfidence,
      source_memory_ids: Array.from(new Set([
        ...(existing.source_memory_ids || []),
        ...(newRule.source_memory_ids || [])
      ])),
      updated_at: now,
    };

    // Merge content if provided
    let mergedContent: RuleContent | undefined;
    if (existingContent && newContent) {
      mergedContent = this.mergeRuleContent(existingContent, newContent);
    }

    return { indexEntry: mergedEntry, content: mergedContent };
  }

  /**
   * Merge rule content (examples, descriptions)
   */
  private mergeRuleContent(
    existing: RuleContent,
    newContent: RuleContent
  ): RuleContent {
    // Merge examples (keep unique ones, max 5)
    const allExamples = [...(existing.examples || []), ...(newContent.examples || [])];
    const uniqueExamples = this.deduplicateExamples(allExamples).slice(0, 5);

    // Keep existing description (more established), but note new observation
    let mergedDescription = existing.description || newContent.description;
    if (newContent.description && newContent.description !== existing.description) {
      mergedDescription += `\n\n**Note**: ${newContent.description}`;
    }

    return {
      ...existing,
      description: mergedDescription,
      examples: uniqueExamples,
      metadata: {
        ...existing.metadata,
        ...newContent.metadata,
        source_memory_ids: Array.from(new Set([
          ...((existing.metadata?.source_memory_ids as string[] | undefined) || []),
          ...((newContent.metadata?.source_memory_ids as string[] | undefined) || [])
        ]))
      }
    };
  }

  /**
   * Deduplicate code examples
   */
  private deduplicateExamples(examples: any[]): any[] {
    const seen = new Set<string>();
    return examples.filter((ex) => {
      const key = `${ex.good || ""}:${ex.bad || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
