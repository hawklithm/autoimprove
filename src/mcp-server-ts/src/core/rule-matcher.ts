/**
 * Rule matching for AutoImprove.
 *
 * Matches rules to current scene based on scene overlap, confidence, and keywords.
 * Enhanced with:
 * - KeywordSegmentIndex for fuzzy matching
 * - SceneThesaurus for synonym expansion
 * - ImprovedScorer for better relevance ranking
 */

import { Scene, RuleIndexEntry, RuleMatch, RuleScope } from "./models.js";
import { RuleIndexManager } from "../storage/rule-index.js";
import { KeywordSegmentIndex } from "./keyword-segment-index.js";
import { SceneThesaurus } from "./scene-thesaurus.js";
import { ImprovedScorer } from "./improved-scorer.js";
import { RuleContentManager } from "../storage/rule-content.js";
import { logger } from "./logger.js";

export class RuleMatcher {
  private matchCache: Map<string, RuleMatch[]> = new Map();
  private keywordIndex: KeywordSegmentIndex;
  private sceneThesaurus: SceneThesaurus;
  private scorer: ImprovedScorer;
  private contentManager: RuleContentManager;
  private initialized: boolean = false;

  constructor(
    private indexManager: RuleIndexManager,
    private maxResults: number = 10,
    private minConfidence: number = 0.3
  ) {
    this.contentManager = new RuleContentManager();
    this.keywordIndex = new KeywordSegmentIndex();
    this.sceneThesaurus = new SceneThesaurus();
    this.scorer = new ImprovedScorer(this.contentManager);
    this.ensureInitialized();
  }

  /**
   * Ensure indexes are built (lazy initialization)
   */
  private ensureInitialized(): void {
    if (this.initialized) return;

    const rules = this.indexManager.getAllRules();

    // Build keyword segment index
    this.keywordIndex.build(rules);

    // Build scorer statistics
    this.scorer.buildStatistics(rules);

    this.initialized = true;

    logger.info("rule-matcher", `Initialized with ${rules.length} rules`, {
      keyword_segments: this.keywordIndex.getStats().total_segments,
      unique_terms: this.scorer.getStats().unique_terms
    });
  }

  matchRules(
    scene: Scene,
    keywords?: string[],
    maxResults?: number,
    minConfidence?: number,
    scopeFilter?: {
      scopes?: RuleScope[];
      current_project?: string;
      organization_id?: string;
      team_id?: string;
      repository?: string;
      branch?: string;
    }
  ): RuleMatch[] {
    this.ensureInitialized();

    const cacheKey = this.getCacheKey(scene, keywords, scopeFilter);
    if (this.matchCache.has(cacheKey)) {
      return this.matchCache.get(cacheKey)!;
    }

    const expandedScene = this.sceneThesaurus.expandScene(scene);
    const effectiveMinConfidence = minConfidence ?? this.minConfidence;
    const effectiveMaxResults = maxResults ?? this.maxResults;

    // Try SQLite-optimized query first
    const sqliteStorage = this.indexManager.getSQLiteStorage();
    let candidates: RuleIndexEntry[];

    if (sqliteStorage) {
      candidates = this.querySQLiteCandidates(
        sqliteStorage,
        expandedScene,
        keywords,
        effectiveMaxResults * 2, // Fetch 2x for secondary scoring
        effectiveMinConfidence
      );
      logger.info("rule-matcher", `SQLite query returned ${candidates.length} candidates`);
    } else {
      candidates = this.queryMemoryCandidates(
        expandedScene,
        keywords,
        effectiveMinConfidence
      );
      logger.info("rule-matcher", `Memory query returned ${candidates.length} candidates`);
    }

    // Apply scope filtering
    candidates = candidates.filter(rule =>
      !scopeFilter || this.matchesScope(rule, scopeFilter)
    );

    // Calculate relevance and rank
    const matches = candidates.map(rule => {
      const { relevance, reason } = this.calculateRelevance(rule, expandedScene, keywords);
      return { rule, relevance_score: relevance, match_reason: reason };
    }).filter(m => m.relevance_score > 0);

    const sorted = this.sortMatches(matches);
    const limited = sorted.slice(0, effectiveMaxResults);

    this.matchCache.set(cacheKey, limited);
    logger.info("rule-matcher", `Matched ${limited.length} rules from ${candidates.length} candidates`);

    return limited;
  }

  /**
   * Query candidates using SQLite (optimized)
   */
  private querySQLiteCandidates(
    storage: any,
    scene: Scene,
    keywords: string[] | undefined,
    fetchLimit: number,
    minConfidence: number
  ): RuleIndexEntry[] {
    if (keywords && keywords.length > 0) {
      return storage.searchByKeywords(keywords, fetchLimit);
    } else if (this.hasSceneTerms(scene)) {
      return storage.searchByScene(scene, fetchLimit);
    } else {
      return storage.listAllRules(fetchLimit).filter((r: RuleIndexEntry) => r.confidence >= minConfidence);
    }
  }

  /**
   * Query candidates using in-memory index (fallback)
   */
  private queryMemoryCandidates(
    scene: Scene,
    keywords: string[] | undefined,
    minConfidence: number
  ): RuleIndexEntry[] {
    let candidateIds: Set<string> | null = null;

    if (keywords && keywords.length > 0) {
      candidateIds = new Set();
      for (const kw of keywords) {
        this.keywordIndex.search(kw).forEach(id => candidateIds!.add(id));
      }
    }

    let allRules = this.indexManager.listRules({ minConfidence });

    if (candidateIds && candidateIds.size > 0) {
      allRules = allRules.filter(r => candidateIds!.has(r.id));
    }

    return allRules;
  }

  /**
   * Check if scene has any terms
   */
  private hasSceneTerms(scene: Scene): boolean {
    return scene.tech.length > 0 || scene.functional.length > 0 || scene.business.length > 0;
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
      team_id?: string;
      repository?: string;
      branch?: string;
    }
  ): boolean {
    // If no scope specified, default to GLOBAL
    const ruleScope = rule.scope || RuleScope.GLOBAL;

    if (rule.status && rule.status !== "active") {
      return false;
    }

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
      const rulePath = this.normalizeProjectPath(rule.scope_context.project_path);
      const currentPath = this.normalizeProjectPath(scopeFilter.current_project);
      return rulePath === currentPath || currentPath.startsWith(`${rulePath}/`) || rulePath.startsWith(`${currentPath}/`);
    }

    // For ORGANIZATION scope, match organization context
    if (ruleScope === RuleScope.ORGANIZATION) {
      const context = rule.scope_context;
      if (context?.organization_id && context.organization_id !== scopeFilter.organization_id) return false;
      if (context?.organization_id && !scopeFilter.organization_id) return false;
      if (context?.team_id && context.team_id !== scopeFilter.team_id) return false;
      if (context?.repository && context.repository !== scopeFilter.repository) return false;
      if (context?.branch && context.branch !== scopeFilter.branch) return false;
      return true;
    }

    // GLOBAL scope always matches
    return true;
  }

  private normalizeProjectPath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }

  private calculateRelevance(
    rule: RuleIndexEntry,
    scene: Scene,
    keywords?: string[]
  ): { relevance: number; reason: string } {
    let score = 0.0;
    const reasons: string[] = [];

    // Scene overlap score (weighted 0.6)
    const { score: overlapScore, reason: overlapReason } = this.calculateSceneOverlap(
      rule,
      scene
    );
    const weightedSceneScore = overlapScore * 0.6;
    score += weightedSceneScore;
    if (overlapScore > 0) {
      reasons.push(overlapReason);
    }

    // Improved keyword boost (weighted 0.4)
    if (keywords && keywords.length > 0) {
      const keywordBoost = this.scorer.calculateKeywordBoost(rule, keywords);
      const weightedKeywordScore = keywordBoost * 0.4;
      score += weightedKeywordScore;
      if (keywordBoost > 0) {
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
    this.initialized = false;

    // Rebuild indexes on next search
    logger.info("rule-matcher", "Cache invalidated, indexes will be rebuilt on next search");
  }

  getRulesByPriority(priority: string): RuleIndexEntry[] {
    return this.indexManager.listRules({ priorityFilter: priority });
  }

  getRulesByType(patternType: string): RuleIndexEntry[] {
    return this.indexManager.listRules({ typeFilter: patternType });
  }

  /**
   * Match rules using multiple scenes with weighted fuzzy matching
   * Optimization 4: Multi-scene fuzzy matching support
   */
  fastMatchMultiScene(
    sceneWeights: Array<{ scene: Scene; weight: number }>,
    keywords?: string[],
    maxResults?: number,
    minConfidence?: number,
    weightThreshold: number = 0.3,
    scopeFilter?: {
      scopes?: RuleScope[];
      current_project?: string;
      organization_id?: string;
    }
  ): RuleMatch[] {
    // Filter scenes by weight threshold
    const relevantScenes = sceneWeights.filter(sw => sw.weight >= weightThreshold);

    if (relevantScenes.length === 0) {
      logger.warn("rule-matcher", "No scenes above weight threshold", { weightThreshold });
      return [];
    }

    logger.info("rule-matcher", "Multi-scene fuzzy matching", {
      total_scenes: sceneWeights.length,
      relevant_scenes: relevantScenes.length,
      weight_threshold: weightThreshold,
    });

    // Collect matches from all relevant scenes
    const allMatches: RuleMatch[] = [];
    const seenRuleIds = new Set<string>();

    for (const sceneWeight of relevantScenes) {
      const scene = sceneWeight.scene;
      const weight = sceneWeight.weight;

      // Match rules for this scene
      const matches = this.matchRules(
        scene,
        keywords,
        maxResults ? maxResults * 2 : undefined, // Get more candidates
        minConfidence,
        scopeFilter
      );

      // Adjust relevance scores by scene weight
      for (const match of matches) {
        if (!seenRuleIds.has(match.rule.id)) {
          seenRuleIds.add(match.rule.id);
          allMatches.push({
            ...match,
            relevance_score: match.relevance_score * weight,
            match_reason: `${match.match_reason} (scene weight: ${weight.toFixed(2)})`,
          });
        } else {
          // Rule already matched by another scene, boost its score
          const existing = allMatches.find(m => m.rule.id === match.rule.id);
          if (existing) {
            existing.relevance_score += match.relevance_score * weight * 0.5; // 50% boost for multi-scene match
            existing.match_reason += ` + multi-scene(${weight.toFixed(2)})`;
          }
        }
      }
    }

    // Sort by adjusted relevance score and return top N
    allMatches.sort((a, b) => b.relevance_score - a.relevance_score);
    const finalResults = allMatches.slice(0, maxResults || this.maxResults);

    logger.info("rule-matcher", "Multi-scene matching completed", {
      total_candidates: allMatches.length,
      returned_results: finalResults.length,
      top_relevance: finalResults.length > 0 ? finalResults[0].relevance_score.toFixed(3) : "N/A",
    });

    return finalResults;
  }
}
