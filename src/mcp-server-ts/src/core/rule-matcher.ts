/**
 * Rule matching for AutoImprove.
 *
 * Matches rules to current scene based on scene overlap, confidence, and keywords.
 */

import { Scene, RuleIndexEntry, RuleMatch, RuleScope } from "./models.js";
import { RuleIndexManager } from "../storage/rule-index.js";

export class RuleMatcher {
  private matchCache: Map<string, RuleMatch[]> = new Map();

  constructor(
    private indexManager: RuleIndexManager,
    private maxResults: number = 10,
    private minConfidence: number = 0.3
  ) {}

  matchRules(
    scene: Scene,
    keywords?: string[],
    maxResults?: number,
    minConfidence?: number,
    scopeFilter?: {
      scopes?: RuleScope[];
      current_project?: string;
      organization_id?: string;
    }
  ): RuleMatch[] {
    // Check cache
    const cacheKey = this.getCacheKey(scene, keywords, scopeFilter);
    if (this.matchCache.has(cacheKey)) {
      return this.matchCache.get(cacheKey)!;
    }

    // Load all rules
    const effectiveMinConfidence = minConfidence ?? this.minConfidence;
    const allRules = this.indexManager.listRules({ minConfidence: effectiveMinConfidence });

    // Calculate relevance for each rule
    const matches: RuleMatch[] = [];
    for (const rule of allRules) {
      // Apply scope filtering
      if (scopeFilter && !this.matchesScope(rule, scopeFilter)) {
        continue;
      }

      const { relevance, reason } = this.calculateRelevance(rule, scene, keywords);
      if (relevance > 0) {
        matches.push({
          rule,
          relevance_score: relevance,
          match_reason: reason
        });
      }
    }

    // Sort by priority then relevance
    const sortedMatches = this.sortMatches(matches);

    // Limit results
    const effectiveMaxResults = maxResults ?? this.maxResults;
    const limitedMatches = sortedMatches.slice(0, effectiveMaxResults);

    // Cache results
    this.matchCache.set(cacheKey, limitedMatches);

    return limitedMatches;
  }

  /**
   * Check if rule matches scope filter
   */
  private matchesScope(
    rule: RuleIndexEntry,
    scopeFilter: {
      scopes?: RuleScope[];
      current_project?: string;
      organization_id?: string;
    }
  ): boolean {
    // If no scope specified, default to GLOBAL
    const ruleScope = rule.scope || RuleScope.GLOBAL;

    // If no scopes filter provided, allow all
    if (!scopeFilter.scopes || scopeFilter.scopes.length === 0) {
      return true;
    }

    // Check if rule scope is in allowed scopes
    if (!scopeFilter.scopes.includes(ruleScope)) {
      return false;
    }

    // For PROJECT scope, match project context
    if (ruleScope === RuleScope.PROJECT) {
      if (!scopeFilter.current_project || !rule.scope_context?.project_path) {
        return false;
      }
      // Match project path (exact or substring)
      return rule.scope_context.project_path === scopeFilter.current_project ||
             scopeFilter.current_project.includes(rule.scope_context.project_path) ||
             rule.scope_context.project_path.includes(scopeFilter.current_project);
    }

    // For ORGANIZATION scope, match organization context
    if (ruleScope === RuleScope.ORGANIZATION) {
      if (!scopeFilter.organization_id || !rule.scope_context?.organization_id) {
        return true; // Allow if no specific org context
      }
      return rule.scope_context.organization_id === scopeFilter.organization_id;
    }

    // GLOBAL scope always matches
    return true;
  }

  private calculateRelevance(
    rule: RuleIndexEntry,
    scene: Scene,
    keywords?: string[]
  ): { relevance: number; reason: string } {
    let score = 0.0;
    const reasons: string[] = [];

    // Scene overlap score
    const { score: overlapScore, reason: overlapReason } = this.calculateSceneOverlap(
      rule,
      scene
    );
    score += overlapScore;
    if (overlapScore > 0) {
      reasons.push(overlapReason);
    }

    // Keyword boost
    if (keywords && rule.keywords.length > 0) {
      const keywordBoost = this.calculateKeywordBoost(rule.keywords, keywords);
      if (keywordBoost > 0) {
        score += keywordBoost;
        reasons.push(`keyword match (+${keywordBoost.toFixed(2)})`);
      }
    }

    // Confidence factor
    score *= rule.confidence;

    const reason = reasons.length > 0 ? reasons.join(", ") : "no match";
    return { relevance: score, reason };
  }

  private calculateSceneOverlap(
    rule: RuleIndexEntry,
    scene: Scene
  ): { score: number; reason: string } {
    const ruleScene = rule.scenes;

    if (!ruleScene || Object.keys(ruleScene).length === 0) {
      return { score: 0.5, reason: "no scene specified" };
    }

    // Count matches in each dimension
    const techMatches = this.countSetIntersection(ruleScene.tech, scene.tech);
    const functionalMatches = this.countSetIntersection(
      ruleScene.functional,
      scene.functional
    );
    const businessMatches = this.countSetIntersection(ruleScene.business, scene.business);

    // Count total dimensions with content
    const ruleDimensions =
      (ruleScene.tech.length > 0 ? 1 : 0) +
      (ruleScene.functional.length > 0 ? 1 : 0) +
      (ruleScene.business.length > 0 ? 1 : 0);

    if (ruleDimensions === 0) {
      return { score: 0.5, reason: "no scene specified" };
    }

    // Calculate match ratio
    const totalMatches = techMatches + functionalMatches + businessMatches;
    const matchRatio = totalMatches / ruleDimensions;

    // Generate reason
    const matchParts: string[] = [];
    if (techMatches > 0) matchParts.push(`tech:${techMatches}`);
    if (functionalMatches > 0) matchParts.push(`functional:${functionalMatches}`);
    if (businessMatches > 0) matchParts.push(`business:${businessMatches}`);

    const reason = `scene overlap (${matchParts.join(", ")})`;

    return { score: matchRatio, reason };
  }

  private calculateKeywordBoost(ruleKeywords: string[], contextKeywords: string[]): number {
    if (ruleKeywords.length === 0 || contextKeywords.length === 0) {
      return 0.0;
    }

    // Check for keyword matches (case-insensitive)
    const ruleKwLower = ruleKeywords.map(kw => kw.toLowerCase());
    const contextKwLower = contextKeywords.map(kw => kw.toLowerCase());

    const matches = this.countSetIntersection(ruleKwLower, contextKwLower);

    return matches > 0 ? 0.2 : 0.0;
  }

  private sortMatches(matches: RuleMatch[]): RuleMatch[] {
    const priorityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3
    };

    return matches.sort((a, b) => {
      const aPriority = priorityOrder[a.rule.priority] ?? 4;
      const bPriority = priorityOrder[b.rule.priority] ?? 4;

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      return b.relevance_score - a.relevance_score;
    });
  }

  private getCacheKey(
    scene: Scene,
    keywords?: string[],
    scopeFilter?: {
      scopes?: RuleScope[];
      current_project?: string;
      organization_id?: string;
    }
  ): string {
    const sceneStr = `${scene.tech.sort().join(",")}|${scene.functional.sort().join(",")}|${scene.business.sort().join(",")}`;
    const kwStr = keywords ? keywords.sort().join(",") : "";
    const scopeStr = scopeFilter
      ? `${(scopeFilter.scopes || []).sort().join(",")}|${scopeFilter.current_project || ""}|${scopeFilter.organization_id || ""}`
      : "";
    return `${sceneStr}#${kwStr}#${scopeStr}`;
  }

  private countSetIntersection(arr1: string[], arr2: string[]): number {
    const set1 = new Set(arr1);
    return arr2.filter(item => set1.has(item)).length;
  }

  invalidateCache(): void {
    this.matchCache.clear();
  }

  getRulesByPriority(priority: string): RuleIndexEntry[] {
    return this.indexManager.listRules({ priorityFilter: priority });
  }

  getRulesByType(patternType: string): RuleIndexEntry[] {
    return this.indexManager.listRules({ typeFilter: patternType });
  }
}
