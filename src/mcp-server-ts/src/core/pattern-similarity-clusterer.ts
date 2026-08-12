/**
 * Pattern Similarity Clusterer
 *
 * Groups similar patterns together for batch LLM processing.
 * Uses keyword overlap, description similarity, and type matching.
 */

import { Pattern, PatternType } from "./models.js";
import { EmbeddingEncoder } from "./embedding-encoder.js";
import { loadConfig } from "../storage/init.js";
import { tokenizeWithJieba } from "./jieba-utils.js";

export interface PatternClusterGroup {
  cluster_id: string;
  patterns: Pattern[];
  common_keywords: string[];
  pattern_type: PatternType;
  avg_confidence: number;
  total_occurrences: number;
  representative_description: string;
  session_count?: number;
  /** Memory ids discovered as backing this cluster (passthrough into rule generation). */
  source_memory_ids?: string[];
}

export class PatternSimilarityClusterer {
  // When local_ml.clusterer != "legacy" (or explicit pattern_clusterer == "semantic"),
  // keyword/text word-overlap is replaced by EmbeddingEncoder semantic similarity.
  private encoder: EmbeddingEncoder | null = null;

  constructor() {
    const cfg = loadConfig().local_ml;
    if (cfg && cfg.enabled && (cfg.pattern_clusterer === "semantic" || (cfg.pattern_clusterer === undefined && cfg.clusterer !== "legacy"))) {
      this.encoder = new EmbeddingEncoder({
        backend: cfg.embedding_backend || "char-ngram-tfidf",
      });
    }
  }

  /**
   * Cluster patterns by similarity for batch LLM processing
   */
  async clusterPatterns(patterns: Pattern[], options: {
    minSimilarity?: number;
    maxClusterSize?: number;
    minClusterSize?: number;
  } = {}): Promise<PatternClusterGroup[]> {
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
      const typeClusters = await this.clusterByType(
        typePatterns,
        minSimilarity,
        maxClusterSize,
        minClusterSize
      );
      clusters.push(...typeClusters);
    }

    // Cross-type merge: patterns assigned different types by the classifier
    // may describe the same underlying behaviour. If two clusters have very
    // high description similarity, merge them so the LLM sees them as one.
    if (clusters.length > 1) {
      const merged = this.mergeCrossTypeClusters(clusters, minSimilarity, maxClusterSize);
      return merged;
    }

    return clusters;
  }

  /**
   * Second-pass cross-type cluster merging.
   *
   * After the type-grouped first pass, clusters (especially singletons) of
   * different types may represent the same real-world pattern — the
   * classifier simply assigned them different labels.  We use a higher
   * similarity bar to avoid over-merging; the threshold is deliberately
   * stricter than `minSimilarity` because we are merging across the type
   * barrier that the first pass was unable to cross.
   */
  private async mergeCrossTypeClusters(
    clusters: PatternClusterGroup[],
    _minSimilarity: number,
    _maxClusterSize: number
  ): Promise<PatternClusterGroup[]> {
    const CROSS_TYPE_SIMILARITY_THRESHOLD = 0.65;

    // Sort so larger clusters (more patterns) are considered first as keepers
    const sorted = [...clusters].sort((a, b) => b.patterns.length - a.patterns.length);
    const result: PatternClusterGroup[] = [];
    const absorbed = new Set<number>();

    for (let i = 0; i < sorted.length; i++) {
      if (absorbed.has(i)) continue;
      let keeper = sorted[i];

      for (let j = i + 1; j < sorted.length; j++) {
        if (absorbed.has(j)) continue;
        const candidate = sorted[j];
        // Only attempt cross-type merge
        if (keeper.pattern_type === candidate.pattern_type) continue;

        const sim = await this.semanticOrTextSimilarity(
          keeper.representative_description,
          candidate.representative_description
        );

        if (sim >= CROSS_TYPE_SIMILARITY_THRESHOLD) {
          // Absorb the smaller (or equally-sized) cluster into the larger one
          keeper = this.absorbCluster(keeper, candidate);
          absorbed.add(j);
        }
      }

      result.push(keeper);
    }

    return result;
  }

  /**
   * Semantic similarity when encoder is available, otherwise text overlap.
   */
  private async semanticOrTextSimilarity(text1: string, text2: string): Promise<number> {
    if (this.encoder) {
      return this.semanticSimilarity(text1, text2);
    }
    return this.textSimilarity(text1, text2);
  }

  /**
   * Absorb candidate cluster into the keeper. The keeper keeps its
   * cluster identity; the candidate's patterns are appended.
   */
  private absorbCluster(
    keeper: PatternClusterGroup,
    candidate: PatternClusterGroup
  ): PatternClusterGroup {
    const allPatterns = [...keeper.patterns, ...candidate.patterns];
    // Re-derive common keywords with the combined set
    const keywordSets = allPatterns.map(p => new Set(p.keywords));
    const commonKeywords = this.findCommonKeywords(keywordSets);
    const avgConfidence =
      allPatterns.reduce((s, p) => s + p.confidence, 0) / allPatterns.length;
    const totalOccurrences = allPatterns.reduce((s, p) => s + p.occurrences.length, 0);
    const sessionIds = new Set(allPatterns.flatMap(p => p.occurrences.map(o => o.session_id)));

    return {
      ...keeper,
      patterns: allPatterns,
      common_keywords: commonKeywords,
      avg_confidence: avgConfidence,
      total_occurrences: totalOccurrences,
      session_count: sessionIds.size,
    };
  }

  /**
   * Cluster patterns of the same type
   */
  private async clusterByType(
    patterns: Pattern[],
    minSimilarity: number,
    maxClusterSize: number,
    minClusterSize: number
  ): Promise<PatternClusterGroup[]> {
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
        const similarity = await this.calculateSimilarity(seed, candidate);

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
  private async calculateSimilarity(p1: Pattern, p2: Pattern): Promise<number> {
    // 3. Type exact match bonus (20%) — always applied
    let typeScore = 0;
    if (p1.type === p2.type) {
      typeScore = 0.2;
    }

    // 4. Context similarity (10%) — always applied (semantic or text)
    const context1 = p1.occurrences.map(o => o.context || "").join(" ");
    const context2 = p2.occurrences.map(o => o.context || "").join(" ");
    const contextScore = (context1 && context2)
      ? (this.encoder
          ? await this.semanticSimilarity(context1, context2)
          : this.textSimilarity(context1, context2)) * 0.1
      : 0;

    if (this.encoder) {
      // Semantic mode: keyword(0.4) + text(0.3) replaced by semantic cosine over
      // combined representative text (description + keywords), weighted 0.7.
      const semanticSim = await this.semanticSimilarity(
        this.representativeText(p1),
        this.representativeText(p2)
      );
      // score / weights: semantic 0.7 + type 0.2 + context 0.1 = 1.0
      return semanticSim * 0.7 + typeScore + contextScore;
    }

    // Legacy mode: keyword overlap (40%) + description similarity (30%) + type + context
    const keywordSimilarity = this.jaccardSimilarity(
      new Set(p1.keywords),
      new Set(p2.keywords)
    );
    const descSimilarity = this.textSimilarity(p1.description, p2.description);
    const legacyScore =
      keywordSimilarity * 0.4 +
      descSimilarity * 0.3 +
      typeScore +
      contextScore;

    // legacy contextScore already includes the 0.1 weight; normalize denominator is 1.0
    return legacyScore;
  }

  /** Combined text used for semantic similarity (description carries the meaning). */
  private representativeText(p: Pattern): string {
    return [p.description, ...p.keywords].filter(Boolean).join(" ");
  }

  /** Semantic cosine similarity between two texts using the shared encoder. */
  private async semanticSimilarity(text1: string, text2: string): Promise<number> {
    if (!this.encoder) return 0;
    const [v1, v2] = await this.encoder.encodeBatch([text1, text2]);
    return EmbeddingEncoder.cosine(v1, v2);
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
   * Tokenize text into words (uses jieba for Chinese, whitespace split for English).
   * minTokenLength=3 to filter out very short/stop words for keyword matching.
   */
  private tokenize(text: string): string[] {
    return tokenizeWithJieba(text, 3);
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
