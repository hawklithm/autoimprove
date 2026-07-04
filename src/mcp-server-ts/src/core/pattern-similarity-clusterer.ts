/**
 * Pattern Similarity Clusterer
 *
 * Groups similar patterns together for batch LLM processing.
 * Uses keyword overlap, description similarity, and type matching.
 */

import { Pattern, PatternType } from "./models.js";

export interface PatternClusterGroup {
  cluster_id: string;
  patterns: Pattern[];
  common_keywords: string[];
  pattern_type: PatternType;
  avg_confidence: number;
  total_occurrences: number;
  representative_description: string;
  session_count?: number;
}

export class PatternSimilarityClusterer {
  /**
   * Cluster patterns by similarity for batch LLM processing
   */
  clusterPatterns(patterns: Pattern[], options: {
    minSimilarity?: number;
    maxClusterSize?: number;
    minClusterSize?: number;
  } = {}): PatternClusterGroup[] {
    const {
      minSimilarity = 0.4,
      maxClusterSize = 10,
      minClusterSize = 2
    } = options;

    // Group by pattern type first
    const typeGroups = new Map<string, Pattern[]>();
    for (const pattern of patterns) {
      const existing = typeGroups.get(pattern.type) || [];
      existing.push(pattern);
      typeGroups.set(pattern.type, existing);
    }

    const clusters: PatternClusterGroup[] = [];

    // Cluster within each type
    for (const [type, typePatterns] of typeGroups) {
      const typeClusters = this.clusterByType(
        typePatterns,
        minSimilarity,
        maxClusterSize,
        minClusterSize
      );
      clusters.push(...typeClusters);
    }

    return clusters;
  }

  /**
   * Cluster patterns of the same type
   */
  private clusterByType(
    patterns: Pattern[],
    minSimilarity: number,
    maxClusterSize: number,
    minClusterSize: number
  ): PatternClusterGroup[] {
    if (patterns.length === 0) return [];

    const clusters: PatternClusterGroup[] = [];
    const visited = new Set<number>();

    // Sort by confidence (high to low) so high-quality patterns become cluster centers
    const sortedPatterns = [...patterns].sort((a, b) => b.confidence - a.confidence);

    for (let i = 0; i < sortedPatterns.length; i++) {
      if (visited.has(i)) continue;

      const seed = sortedPatterns[i];
      const clusterPatterns: Pattern[] = [seed];
      visited.add(i);

      // Find similar patterns
      for (let j = i + 1; j < sortedPatterns.length && clusterPatterns.length < maxClusterSize; j++) {
        if (visited.has(j)) continue;

        const candidate = sortedPatterns[j];
        const similarity = this.calculateSimilarity(seed, candidate);

        if (similarity >= minSimilarity) {
          clusterPatterns.push(candidate);
          visited.add(j);
        }
      }

      // Only keep clusters that meet minimum size
      if (clusterPatterns.length >= minClusterSize) {
        clusters.push(this.createClusterGroup(clusterPatterns, seed.type));
      } else if (clusterPatterns.length === 1) {
        // Singleton patterns go to their own "cluster" for processing
        clusters.push(this.createClusterGroup(clusterPatterns, seed.type));
      }
    }

    return clusters;
  }

  /**
   * Calculate similarity between two patterns (0-1)
   */
  private calculateSimilarity(p1: Pattern, p2: Pattern): number {
    let score = 0;
    let weights = 0;

    // 1. Keyword overlap (40%)
    const keywordSimilarity = this.jaccardSimilarity(
      new Set(p1.keywords),
      new Set(p2.keywords)
    );
    score += keywordSimilarity * 0.4;
    weights += 0.4;

    // 2. Description similarity (30%)
    const descSimilarity = this.textSimilarity(p1.description, p2.description);
    score += descSimilarity * 0.3;
    weights += 0.3;

    // 3. Type exact match bonus (20%)
    if (p1.type === p2.type) {
      score += 0.2;
      weights += 0.2;
    }

    // 4. Context similarity (10%)
    const context1 = p1.occurrences.map(o => o.context || "").join(" ");
    const context2 = p2.occurrences.map(o => o.context || "").join(" ");
    if (context1 && context2) {
      const contextSim = this.textSimilarity(context1, context2);
      score += contextSim * 0.1;
      weights += 0.1;
    }

    return weights > 0 ? score / weights : 0;
  }

  /**
   * Jaccard similarity for sets
   */
  private jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 1;
    if (set1.size === 0 || set2.size === 0) return 0;

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Simple text similarity using word overlap
   */
  private textSimilarity(text1: string, text2: string): number {
    const words1 = new Set(this.tokenize(text1));
    const words2 = new Set(this.tokenize(text2));

    return this.jaccardSimilarity(words1, words2);
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  /**
   * Create cluster group from patterns
   */
  private createClusterGroup(patterns: Pattern[], type: PatternType): PatternClusterGroup {
    // Use first (highest confidence) pattern as representative
    const representative = patterns[0];

    // Find common keywords
    const keywordSets = patterns.map(p => new Set(p.keywords));
    const commonKeywords = this.findCommonKeywords(keywordSets);

    // Calculate averages
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    const totalOccurrences = patterns.reduce((sum, p) => sum + p.occurrences.length, 0);

    // Calculate session count
    const sessionIds = new Set(patterns.flatMap(p => p.occurrences.map(o => o.session_id)));

    return {
      cluster_id: `cluster-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      patterns,
      common_keywords: commonKeywords,
      pattern_type: type,
      avg_confidence: avgConfidence,
      total_occurrences: totalOccurrences,
      representative_description: representative.description,
      session_count: sessionIds.size
    };
  }

  /**
   * Find keywords common to multiple patterns
   */
  private findCommonKeywords(keywordSets: Set<string>[]): string[] {
    if (keywordSets.length === 0) return [];
    if (keywordSets.length === 1) return Array.from(keywordSets[0]);

    // Count keyword frequency across patterns
    const keywordCounts = new Map<string, number>();

    for (const keywordSet of keywordSets) {
      for (const keyword of keywordSet) {
        keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
      }
    }

    // Return keywords that appear in at least 30% of patterns
    const threshold = Math.max(1, Math.ceil(keywordSets.length * 0.3));

    return Array.from(keywordCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([keyword]) => keyword);
  }

  /**
   * Get statistics about clustering results
   */
  getClusteringStats(clusters: PatternClusterGroup[]): {
    total_clusters: number;
    singleton_clusters: number;
    multi_pattern_clusters: number;
    largest_cluster_size: number;
    avg_cluster_size: number;
    total_patterns: number;
  } {
    const singletons = clusters.filter(c => c.patterns.length === 1).length;
    const multiPattern = clusters.filter(c => c.patterns.length > 1).length;
    const largestSize = Math.max(...clusters.map(c => c.patterns.length));
    const totalPatterns = clusters.reduce((sum, c) => sum + c.patterns.length, 0);
    const avgSize = totalPatterns / clusters.length;

    return {
      total_clusters: clusters.length,
      singleton_clusters: singletons,
      multi_pattern_clusters: multiPattern,
      largest_cluster_size: largestSize,
      avg_cluster_size: avgSize,
      total_patterns: totalPatterns
    };
  }
}
