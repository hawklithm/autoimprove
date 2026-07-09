/**
 * Indexed rule matcher for AutoImprove.
 *
 * Uses inverted indexes to accelerate rule matching queries.
 */

import { Scene, RuleIndexEntry, RuleScope } from "./models.js";
import { RuleIndexManager } from "../storage/rule-index.js";

export interface RuleMatch {
  rule: RuleIndexEntry;
  relevance_score: number;
  match_reason: string;
}

export class IndexedRuleMatcher {
  private keywordIndex: Map<string, Set<string>> = new Map(); // keyword -> rule IDs
  private techIndex: Map<string, Set<string>> = new Map(); // tech -> rule IDs
  private functionalIndex: Map<string, Set<string>> = new Map(); // functional -> rule IDs
  private businessIndex: Map<string, Set<string>> = new Map(); // business -> rule IDs
  private indexBuilt: boolean = false;
  private lastIndexBuildTime: number = 0;
  private indexManager: RuleIndexManager;

  constructor(indexManager: RuleIndexManager) {
    this.indexManager = indexManager;
  }

  /**
   * Build inverted indexes from all rules
   */
  buildIndex(rules: RuleIndexEntry[]): void {
    // Clear existing indexes
    this.keywordIndex.clear();
    this.techIndex.clear();
    this.functionalIndex.clear();
    this.businessIndex.clear();

    for (const rule of rules) {
      // Index keywords
      if (rule.keywords) {
        for (const keyword of rule.keywords) {
          const normalizedKeyword = keyword.toLowerCase().trim();
          if (!this.keywordIndex.has(normalizedKeyword)) {
            this.keywordIndex.set(normalizedKeyword, new Set());
          }
          this.keywordIndex.get(normalizedKeyword)!.add(rule.id);
        }
      }

      // Index scene dimensions
      if (rule.scenes) {
        // Tech stack
        for (const tech of rule.scenes.tech) {
          const normalizedTech = tech.toLowerCase().trim();
          if (!this.techIndex.has(normalizedTech)) {
            this.techIndex.set(normalizedTech, new Set());
          }
          this.techIndex.get(normalizedTech)!.add(rule.id);
        }

        // Functional domain
        for (const func of rule.scenes.functional) {
          const normalizedFunc = func.toLowerCase().trim();
          if (!this.functionalIndex.has(normalizedFunc)) {
            this.functionalIndex.set(normalizedFunc, new Set());
          }
          this.functionalIndex.get(normalizedFunc)!.add(rule.id);
        }

        // Business domain
        for (const biz of rule.scenes.business) {
          const normalizedBiz = biz.toLowerCase().trim();
          if (!this.businessIndex.has(normalizedBiz)) {
            this.businessIndex.set(normalizedBiz, new Set());
          }
          this.businessIndex.get(normalizedBiz)!.add(rule.id);
        }
      }
    }

    this.indexBuilt = true;
    this.lastIndexBuildTime = Date.now();
  }

  /**
   * Fast rule matching using indexes with scope filtering
   */
  fastMatch(
    scene: Scene,
    keywords?: string[],
    maxResults: number = 20,
    minConfidence: number = 0.3,
    scopeFilter?: {
      scopes?: RuleScope[];          // Allowed scopes (default: all)
      current_project?: string;       // Current project path for PROJECT scope matching
      organization_id?: string;       // Organization ID for ORGANIZATION scope matching
    }
  ): RuleMatch[] {
    // Rebuild index if needed (cache invalidation)
    if (!this.indexBuilt || Date.now() - this.lastIndexBuildTime > 60000) {
      const rules = this.indexManager.listRules();
      this.buildIndex(rules);
    }

    // Collect candidate rule IDs
    const candidateScores = new Map<string, { score: number; reasons: string[] }>();

    // Match by tech stack
    for (const tech of scene.tech) {
      const normalizedTech = tech.toLowerCase().trim();
      const ruleIds = this.techIndex.get(normalizedTech);
      if (ruleIds) {
        for (const ruleId of ruleIds) {
          this.addCandidateScore(candidateScores, ruleId, 0.4, `tech: ${tech}`);
        }
      }
    }

    // Match by functional domain
    for (const func of scene.functional) {
      const normalizedFunc = func.toLowerCase().trim();
      const ruleIds = this.functionalIndex.get(normalizedFunc);
      if (ruleIds) {
        for (const ruleId of ruleIds) {
          this.addCandidateScore(candidateScores, ruleId, 0.5, `functional: ${func}`);
        }
      }
    }

    // Match by business domain
    for (const biz of scene.business) {
      const normalizedBiz = biz.toLowerCase().trim();
      const ruleIds = this.businessIndex.get(normalizedBiz);
      if (ruleIds) {
        for (const ruleId of ruleIds) {
          this.addCandidateScore(candidateScores, ruleId, 0.3, `business: ${biz}`);
        }
      }
    }

    // Match by keywords
    if (keywords) {
      for (const keyword of keywords) {
        const normalizedKeyword = keyword.toLowerCase().trim();
        const ruleIds = this.keywordIndex.get(normalizedKeyword);
        if (ruleIds) {
          for (const ruleId of ruleIds) {
            this.addCandidateScore(candidateScores, ruleId, 0.6, `keyword: ${keyword}`);
          }
        }
      }
    }

    // Convert candidates to matches
    const matches: RuleMatch[] = [];
    for (const [ruleId, scoreInfo] of candidateScores.entries()) {
      const rule = this.indexManager.getRule(ruleId);
      if (!rule) continue;

      // Filter by confidence
      if (rule.confidence < minConfidence) continue;

      // Apply scope filtering
      if (scopeFilter) {
        if (!this.matchesScope(rule, scopeFilter)) {
          continue;
        }
      }

      // Adjust score by rule confidence
      const relevanceScore = scoreInfo.score * (0.7 + rule.confidence * 0.3);

      matches.push({
        rule,
        relevance_score: relevanceScore,
        match_reason: scoreInfo.reasons.join(", "),
      });
    }

    // Sort by relevance and return top N
    matches.sort((a, b) => b.relevance_score - a.relevance_score);
    return matches.slice(0, maxResults);
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

  /**
   * Fast rule matching using multiple scenes (fuzzy multi-scene matching)
   * Supports weighted scene matching where scenes with weight >= threshold are included
   */
  fastMatchMultiScene(
    scenes: Array<{ scene: Scene; weight: number }>,
    keywords?: string[],
    maxResults: number = 20,
    minConfidence: number = 0.3,
    weightThreshold: number = 0.3,
    scopeFilter?: {
      scopes?: RuleScope[];
      current_project?: string;
      organization_id?: string;
    }
  ): RuleMatch[] {
    // Filter scenes by weight threshold
    const relevantScenes = scenes.filter(sw => sw.weight >= weightThreshold);

    if (relevantScenes.length === 0) {
      return [];
    }

    // Rebuild index if needed
    if (!this.indexBuilt || Date.now() - this.lastIndexBuildTime > 60000) {
      const rules = this.indexManager.listRules();
      this.buildIndex(rules);
    }

    // Collect candidate rule IDs from all relevant scenes
    const candidateScores = new Map<string, { score: number; reasons: string[]; sceneWeights: number[] }>();

    for (const sceneWeight of relevantScenes) {
      const scene = sceneWeight.scene;
      const weight = sceneWeight.weight;

      // Match by tech stack (weighted by scene weight)
      for (const tech of scene.tech) {
        const normalizedTech = tech.toLowerCase().trim();
        const ruleIds = this.techIndex.get(normalizedTech);
        if (ruleIds) {
          for (const ruleId of ruleIds) {
            this.addCandidateScoreWeighted(
              candidateScores,
              ruleId,
              0.4 * weight,
              `tech: ${tech} (scene weight: ${weight.toFixed(2)})`,
              weight
            );
          }
        }
      }

      // Match by functional domain (weighted by scene weight)
      for (const func of scene.functional) {
        const normalizedFunc = func.toLowerCase().trim();
        const ruleIds = this.functionalIndex.get(normalizedFunc);
        if (ruleIds) {
          for (const ruleId of ruleIds) {
            this.addCandidateScoreWeighted(
              candidateScores,
              ruleId,
              0.5 * weight,
              `functional: ${func} (scene weight: ${weight.toFixed(2)})`,
              weight
            );
          }
        }
      }

      // Match by business domain (weighted by scene weight)
      for (const biz of scene.business) {
        const normalizedBiz = biz.toLowerCase().trim();
        const ruleIds = this.businessIndex.get(normalizedBiz);
        if (ruleIds) {
          for (const ruleId of ruleIds) {
            this.addCandidateScoreWeighted(
              candidateScores,
              ruleId,
              0.3 * weight,
              `business: ${biz} (scene weight: ${weight.toFixed(2)})`,
              weight
            );
          }
        }
      }
    }

    // Match by keywords (not weighted by scene)
    if (keywords) {
      for (const keyword of keywords) {
        const normalizedKeyword = keyword.toLowerCase().trim();
        const ruleIds = this.keywordIndex.get(normalizedKeyword);
        if (ruleIds) {
          for (const ruleId of ruleIds) {
            this.addCandidateScoreWeighted(
              candidateScores,
              ruleId,
              0.6,
              `keyword: ${keyword}`,
              1.0
            );
          }
        }
      }
    }

    // Convert candidates to matches
    const matches: RuleMatch[] = [];
    for (const [ruleId, scoreInfo] of candidateScores.entries()) {
      const rule = this.indexManager.getRule(ruleId);
      if (!rule) continue;

      // Filter by confidence
      if (rule.confidence < minConfidence) continue;

      // Apply scope filtering
      if (scopeFilter) {
        if (!this.matchesScope(rule, scopeFilter)) {
          continue;
        }
      }

      // Adjust score by rule confidence
      const relevanceScore = scoreInfo.score * (0.7 + rule.confidence * 0.3);

      matches.push({
        rule,
        relevance_score: relevanceScore,
        match_reason: scoreInfo.reasons.join(", "),
      });
    }

    // Sort by relevance and return top N
    matches.sort((a, b) => b.relevance_score - a.relevance_score);
    return matches.slice(0, maxResults);
  }

  /**
   * Search by keyword with fuzzy matching
   */
  searchByKeyword(query: string, maxResults: number = 10): RuleMatch[] {
    if (!this.indexBuilt) {
      const rules = this.indexManager.listRules();
      this.buildIndex(rules);
    }

    const queryLower = query.toLowerCase().trim();
    const candidateScores = new Map<string, { score: number; reasons: string[] }>();

    // Exact match
    const exactMatch = this.keywordIndex.get(queryLower);
    if (exactMatch) {
      for (const ruleId of exactMatch) {
        this.addCandidateScore(candidateScores, ruleId, 1.0, "exact keyword match");
      }
    }

    // Fuzzy match (substring)
    for (const [keyword, ruleIds] of this.keywordIndex.entries()) {
      if (keyword.includes(queryLower) || queryLower.includes(keyword)) {
        const similarity = this.calculateStringSimilarity(keyword, queryLower);
        for (const ruleId of ruleIds) {
          this.addCandidateScore(candidateScores, ruleId, similarity * 0.7, `fuzzy match: ${keyword}`);
        }
      }
    }

    // Convert to matches
    const matches: RuleMatch[] = [];
    for (const [ruleId, scoreInfo] of candidateScores.entries()) {
      const rule = this.indexManager.getRule(ruleId);
      if (!rule) continue;

      matches.push({
        rule,
        relevance_score: scoreInfo.score,
        match_reason: scoreInfo.reasons.join(", "),
      });
    }

    matches.sort((a, b) => b.relevance_score - a.relevance_score);
    return matches.slice(0, maxResults);
  }

  /**
   * Get index statistics
   */
  getIndexStats(): {
    keyword_count: number;
    tech_count: number;
    functional_count: number;
    business_count: number;
    indexed_rules: number;
    last_build: string;
  } {
    const indexedRules = new Set<string>();
    for (const ruleIds of this.keywordIndex.values()) {
      for (const id of ruleIds) indexedRules.add(id);
    }

    return {
      keyword_count: this.keywordIndex.size,
      tech_count: this.techIndex.size,
      functional_count: this.functionalIndex.size,
      business_count: this.businessIndex.size,
      indexed_rules: indexedRules.size,
      last_build: new Date(this.lastIndexBuildTime).toISOString(),
    };
  }

  /**
   * Invalidate cache and force rebuild
   */
  invalidateCache(): void {
    this.indexBuilt = false;
  }

  /**
   * Add or increment candidate score
   */
  private addCandidateScore(
    map: Map<string, { score: number; reasons: string[] }>,
    ruleId: string,
    scoreIncrement: number,
    reason: string
  ): void {
    const existing = map.get(ruleId);
    if (existing) {
      existing.score += scoreIncrement;
      existing.reasons.push(reason);
    } else {
      map.set(ruleId, {
        score: scoreIncrement,
        reasons: [reason],
      });
    }
  }

  /**
   * Add or increment candidate score with scene weight tracking (for multi-scene matching)
   */
  private addCandidateScoreWeighted(
    map: Map<string, { score: number; reasons: string[]; sceneWeights: number[] }>,
    ruleId: string,
    scoreIncrement: number,
    reason: string,
    sceneWeight: number
  ): void {
    const existing = map.get(ruleId);
    if (existing) {
      existing.score += scoreIncrement;
      existing.reasons.push(reason);
      existing.sceneWeights.push(sceneWeight);
    } else {
      map.set(ruleId, {
        score: scoreIncrement,
        reasons: [reason],
        sceneWeights: [sceneWeight],
      });
    }
  }

  /**
   * Calculate string similarity (simple ratio)
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }
}
