/**
 * Improved Scoring Algorithm
 *
 * Enhances rule matching relevance with:
 * - TF-IDF inspired keyword weighting (rare terms are more important)
 * - Position-based weighting (title > keywords > description)
 * - Multiple keyword match boosting
 */

import { RuleIndexEntry } from "./models.js";
import { RuleContentManager } from "../storage/rule-content.js";

/**
 * Configurable scoring weights
 */
export interface ScoringConfig {
  /** Position weights for keyword matching */
  positionWeights: {
    ruleId: number;      // Keywords in rule ID (default: 3.0)
    keywords: number;    // Keywords in keywords array (default: 2.5)
    scenes: number;      // Keywords in scenes (default: 2.0)
    title: number;       // Keywords in title (default: 1.5)
    description: number; // Keywords in description (default: 1.0)
  };
  /** Multi-match bonus multiplier (default: 0.2) */
  multiMatchBonus: number;
  /** IDF smoothing factor (default: 1.0) */
  idfSmoothing: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  positionWeights: {
    ruleId: 3.0,
    keywords: 2.5,
    scenes: 2.0,
    title: 1.5,
    description: 1.0,
  },
  multiMatchBonus: 0.2,
  idfSmoothing: 1.0,
};

export class ImprovedScorer {
  private termFrequency: Map<string, number>; // term → number of rules containing it
  private totalRules: number;
  private contentManager: RuleContentManager;
  private config: ScoringConfig;

  constructor(contentManager: RuleContentManager, config: ScoringConfig = DEFAULT_SCORING_CONFIG) {
    this.termFrequency = new Map();
    this.totalRules = 0;
    this.contentManager = contentManager;
    this.config = config;
  }

  /**
   * Build term frequency statistics from rules
   */
  buildStatistics(rules: RuleIndexEntry[]): void {
    this.termFrequency.clear();
    this.totalRules = rules.length;

    for (const rule of rules) {
      const terms = new Set<string>();

      // Collect all unique terms from this rule
      rule.keywords.forEach(kw => terms.add(kw.toLowerCase()));

      // From rule ID
      rule.id.split('-').forEach(part => {
        if (part !== 'rule') terms.add(part.toLowerCase());
      });

      // From scenes
      if (rule.scenes) {
        rule.scenes.tech.forEach(t => terms.add(t.toLowerCase()));
        rule.scenes.functional.forEach(f => terms.add(f.toLowerCase()));
        rule.scenes.business.forEach(b => terms.add(b.toLowerCase()));
      }

      // Update frequency count
      terms.forEach(term => {
        this.termFrequency.set(term, (this.termFrequency.get(term) || 0) + 1);
      });
    }
  }

  /**
   * Calculate improved keyword boost score
   *
   * Formula: sum of (IDF × position_weight) for each matched keyword
   */
  calculateKeywordBoost(
    rule: RuleIndexEntry,
    contextKeywords: string[]
  ): number {
    if (contextKeywords.length === 0) {
      return 0;
    }

    let score = 0;
    let matchedCount = 0;

    for (const keyword of contextKeywords) {
      const normalized = keyword.toLowerCase();

      // Check if rule contains this keyword (in various positions)
      const positions = this.findKeywordPositions(rule, normalized);

      if (positions.length > 0) {
        matchedCount++;

        // Calculate IDF weight
        const idf = this.getIDF(normalized);

        // Use the best position weight
        const bestPositionWeight = Math.max(...positions);

        score += idf * bestPositionWeight;
      }
    }

    // Boost score if multiple keywords match
    const multiMatchBonus = matchedCount > 1 ? 1 + (matchedCount - 1) * this.config.multiMatchBonus : 1;

    // Normalize and apply multi-match bonus
    const normalizedScore = Math.min(score / contextKeywords.length, 1.0);

    return normalizedScore * multiMatchBonus;
  }

  /**
   * Find keyword in rule and return position weights
   */
  private findKeywordPositions(rule: RuleIndexEntry, keyword: string): number[] {
    const positions: number[] = [];
    const weights = this.config.positionWeights;

    // Position 1: In rule ID (highest weight)
    if (rule.id.toLowerCase().includes(keyword)) {
      positions.push(weights.ruleId);
    }

    // Position 2: In keywords array
    if (rule.keywords.some(kw => kw.toLowerCase() === keyword)) {
      positions.push(weights.keywords);
    }

    // Position 3: In scenes (tech/functional/business)
    if (rule.scenes) {
      const allSceneTerms = [
        ...rule.scenes.tech,
        ...rule.scenes.functional,
        ...rule.scenes.business
      ];

      if (allSceneTerms.some(t => t.toLowerCase() === keyword)) {
        positions.push(weights.scenes);
      }
    }

    // Position 4: In rule content (title, description)
    // Note: This is expensive, only do if no other matches
    if (positions.length === 0) {
      const content = this.contentManager.loadContent(rule.id);
      if (content) {
        if (content.title?.toLowerCase().includes(keyword)) {
          positions.push(weights.title);
        } else if (content.description?.toLowerCase().includes(keyword)) {
          positions.push(weights.description);
        }
      }
    }

    return positions;
  }

  /**
   * Calculate IDF (Inverse Document Frequency)
   *
   * IDF = log(total_rules / rules_containing_term)
   *
   * Rare terms get higher weights.
   */
  private getIDF(term: string): number {
    if (this.totalRules === 0) {
      return 1.0;
    }

    const rulesContainingTerm = this.termFrequency.get(term) || 1;

    // IDF formula with configurable smoothing
    return Math.log((this.totalRules + 1) / (rulesContainingTerm + 1)) + this.config.idfSmoothing;
  }

  /**
   * Get statistics about term frequencies
   */
  getStats() {
    const frequencies = Array.from(this.termFrequency.entries())
      .sort((a, b) => b[1] - a[1]);

    return {
      total_rules: this.totalRules,
      unique_terms: this.termFrequency.size,
      most_common_terms: frequencies.slice(0, 10),
      rarest_terms: frequencies.slice(-10).reverse()
    };
  }

  /**
   * Get IDF score for a term (for debugging)
   */
  getTermIDF(term: string): number {
    return this.getIDF(term.toLowerCase());
  }
}
