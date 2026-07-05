/**
 * Pattern clusterer - groups labeled content by semantic similarity
 */

import { SignalDictionaryDB, LabeledContent } from "../storage/signal-dictionary-db.js";
import { PatternType } from "./models.js";

export interface PatternCluster {
  cluster_id: string;
  pattern_type: PatternType;
  labeled_content_ids: number[];
  common_signals: string[];
  representative_phrases: string[];
  representative_description?: string;
  total_occurrences: number;
  session_count: number;
  avg_confidence: number;
  created_at: string;
}

interface ClusterFeatures {
  signals: string[];
  contentLength: number;
  confidence: number;
}

export class PatternClusterer {
  private db: SignalDictionaryDB;
  private similarityThreshold: number;

  constructor(similarityThreshold: number = 0.7) {
    this.db = new SignalDictionaryDB();
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Cluster labeled content by semantic similarity
   */
  clusterPatterns(labeledContent: LabeledContent[]): PatternCluster[] {
    if (labeledContent.length === 0) {
      return [];
    }

    // Group by pattern type first
    const byType = this.groupByType(labeledContent);
    const allClusters: PatternCluster[] = [];

    for (const [type, contents] of Object.entries(byType)) {
      const typeClusters = this.clusterByType(type as PatternType, contents);
      allClusters.push(...typeClusters);
    }

    return allClusters;
  }

  /**
   * Group content by pattern type
   */
  private groupByType(content: LabeledContent[]): Record<PatternType, LabeledContent[]> {
    const groups: Record<string, LabeledContent[]> = {};

    for (const item of content) {
      if (!groups[item.pattern_type]) {
        groups[item.pattern_type] = [];
      }
      groups[item.pattern_type].push(item);
    }

    return groups as Record<PatternType, LabeledContent[]>;
  }

  /**
   * Cluster content of the same pattern type
   */
  private clusterByType(patternType: PatternType, contents: LabeledContent[]): PatternCluster[] {
    const clusters: PatternCluster[] = [];
    const visited = new Set<number>();

    // Extract features for each content
    const features = contents.map(c => this.extractFeatures(c));

    for (let i = 0; i < contents.length; i++) {
      if (visited.has(i)) continue;

      const content1 = contents[i];
      if (!content1.id) continue;

      // Start new cluster
      const clusterContentIds: number[] = [content1.id];
      const clusterSignals: Set<string> = new Set();
      const clusterPhrases: string[] = [this.extractRepresentativePhrase(content1.content)];
      const sessionIds = new Set<string>([content1.session_id]);
      let totalConfidence = content1.confidence;

      // Parse matched signals
      const signals1 = this.parseMatchedSignals(content1.matched_signals);
      signals1.forEach(s => clusterSignals.add(s.signal_text));

      visited.add(i);

      // Find similar items
      for (let j = i + 1; j < contents.length; j++) {
        if (visited.has(j)) continue;

        const content2 = contents[j];
        if (!content2.id) continue;

        const similarity = this.calculateSimilarity(features[i], features[j]);

        if (similarity > this.similarityThreshold) {
          // Add to cluster
          clusterContentIds.push(content2.id);
          sessionIds.add(content2.session_id);
          totalConfidence += content2.confidence;

          // Add phrase sample (limit to 3)
          if (clusterPhrases.length < 3) {
            clusterPhrases.push(this.extractRepresentativePhrase(content2.content));
          }

          // Update common signals (intersection)
          const signals2 = this.parseMatchedSignals(content2.matched_signals);
          const signals2Set = new Set(signals2.map(s => s.signal_text));

          // Keep only signals that appear in both
          const intersection = new Set([...clusterSignals].filter(s => signals2Set.has(s)));       if (intersection.size > 0) {
            clusterSignals.clear();
            intersection.forEach(s => clusterSignals.add(s));
          }

          visited.add(j);
        }
      }

      // Create cluster with representative description
      const cluster: PatternCluster = {
        cluster_id: `cluster-${patternType}-${Date.now()}-${i}`,
        pattern_type: patternType,
        labeled_content_ids: clusterContentIds,
        common_signals: Array.from(clusterSignals),
        representative_phrases: clusterPhrases,
        representative_description: Array.from(clusterSignals).join(", ") || clusterPhrases[0],
        total_occurrences: clusterContentIds.length,
        session_count: sessionIds.size,
        avg_confidence: totalConfidence / clusterContentIds.length,
        created_at: new Date().toISOString()
      };

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * Extract representative phrase from content with intelligent truncation
   * Preserves complete words/sentences instead of arbitrary character limits
   */
  private extractRepresentativePhrase(content: string, maxLength: number = 200): string {
    const trimmed = content.trim();

    // Try to extract the first complete sentence (even if content is short)
    const sentenceEnd = trimmed.search(/[.!?]\s/);
    if (sentenceEnd > 0 && sentenceEnd <= maxLength) {
      return trimmed.substring(0, sentenceEnd + 1);
    }

    // Try to extract first paragraph
    const paragraphEnd = trimmed.indexOf('\n\n');
    if (paragraphEnd > 0 && paragraphEnd <= maxLength) {
      return trimmed.substring(0, paragraphEnd);
    }

    // If content is within limit and no sentence/paragraph boundaries, return all
    if (trimmed.length <= maxLength) {
      return trimmed;
    }

    // Find last complete word within limit
    const truncated = trimmed.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > 0) {
      return truncated.substring(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  /**
   * Extract features for clustering
   */
  private extractFeatures(content: LabeledContent): ClusterFeatures {
    const signals = this.parseMatchedSignals(content.matched_signals);

    return {
      signals: signals.map(s => s.signal_text),
      contentLength: content.content.length,
      confidence: content.confidence
    };
  }

  /**
   * Calculate similarity between two feature sets
   */
  private calculateSimilarity(f1: ClusterFeatures, f2: ClusterFeatures): number {
    // Signal overlap (Jaccard similarity)
    const signalSimilarity = this.jaccardSimilarity(f1.signals, f2.signals);

    // Content length similarity (normalized difference)
    const lengthDiff = Math.abs(f1.contentLength - f2.contentLength);
    const maxLength = Math.max(f1.contentLength, f2.contentLength);
    const lengthSimilarity = 1 - (lengthDiff / maxLength);

    // Confidence similarity
    const confidenceSimilarity = 1 - Math.abs(f1.confidence - f2.confidence);

    // Weighted combination
    return (
      signalSimilarity * 0.7 +
      lengthSimilarity * 0.1 +
      confidenceSimilarity * 0.2
    );
  }

  /**
   * Jaccard similarity between two sets
   */
  private jaccardSimilarity(set1: string[], set2: string[]): number {
    const s1 = new Set(set1);
    const s2 = new Set(set2);

    if (s1.size === 0 && s2.size === 0) return 1;
    if (s1.size === 0 || s2.size === 0) return 0;

    const intersection = new Set([...s1].filter(x => s2.has(x)));
    const union = new Set([...s1, ...s2]);

    return intersection.size / union.size;
  }

  /**
   * Parse matched signals JSON string
   */
  private parseMatchedSignals(matchedSignalsJson: string): Array<{ signal_text: string; confidence: number }> {
    try {
      const parsed = JSON.parse(matchedSignalsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get clusters for a specific pattern type
   */
  getClustersForType(patternType: PatternType): PatternCluster[] {
    const labeledContent = this.db.getLabeledContentByPatternType(patternType);
    return this.clusterByType(patternType, labeledContent);
  }

  /**
   * Get cluster statistics
   */
  getClusterStats(clusters: PatternCluster[]) {
    const byType: Record<string, number> = {};
    let totalOccurrences = 0;
    let totalSessions = new Set<string>();

    for (const cluster of clusters) {
      byType[cluster.pattern_type] = (byType[cluster.pattern_type] || 0) + 1;
      totalOccurrences += cluster.total_occurrences;

      // Would need to load labeled content to get session IDs
      // For now, use session_count as approximation
      totalSessions.add(cluster.cluster_id); // Placeholder
    }

    const avgClusterSize = clusters.length > 0
      ? totalOccurrences / clusters.length
      : 0;

    const avgConfidence = clusters.length > 0
      ? clusters.reduce((sum, c) => sum + c.avg_confidence, 0) / clusters.length
      : 0;

    return {
      total_clusters: clusters.length,
      by_type: byType,
      total_occurrences: totalOccurrences,
      avg_cluster_size: avgClusterSize,
      avg_confidence: avgConfidence
    };
  }

  /**
   * Merge small clusters into larger ones
   */
  mergeSmallClusters(clusters: PatternCluster[], minSize: number = 2): PatternCluster[] {
    const large: PatternCluster[] = [];
    const small: PatternCluster[] = [];

    // Separate large and small clusters
    for (const cluster of clusters) {
      if (cluster.total_occurrences >= minSize) {
        large.push(cluster);
      } else {
        small.push(cluster);
      }
    }

    // Try to merge small clusters into large ones
    for (const smallCluster of small) {
      let bestMatch: PatternCluster | null = null;
      let bestSimilarity = 0;

      for (const largeCluster of large) {
        if (largeCluster.pattern_type !== smallCluster.pattern_type) continue;

        const similarity = this.jaccardSimilarity(
          smallCluster.common_signals,
          largeCluster.common_signals
        );

        if (similarity > bestSimilarity && similarity > 0.5) {
          bestSimilarity = similarity;
          bestMatch = largeCluster;
        }
      }

      if (bestMatch) {
        // Merge into best match
        bestMatch.labeled_content_ids.push(...smallCluster.labeled_content_ids);
        bestMatch.total_occurrences += smallCluster.total_occurrences;
        bestMatch.session_count = Math.max(bestMatch.session_count, smallCluster.session_count);

        // Recalculate average confidence
        bestMatch.avg_confidence =
          (bestMatch.avg_confidence * (bestMatch.total_occurrences - smallCluster.total_occurrences) +
           smallCluster.avg_confidence * smallCluster.total_occurrences) /
          bestMatch.total_occurrences;

        // Update common signals (intersection)
        const intersection = new Set(
          bestMatch.common_signals.filter(s => smallCluster.common_signals.includes(s))
        );
        if (intersection.size > 0) {
          bestMatch.common_signals = Array.from(intersection);
        }
      } else {
        // No good match, keep as separate small cluster
        large.push(smallCluster);
      }
    }

    return large;
  }

  /**
   * Filter clusters by confidence threshold
   */
  filterByConfidence(clusters: PatternCluster[], minConfidence: number): PatternCluster[] {
    return clusters.filter(c => c.avg_confidence >= minConfidence);
  }

  /**
   * Sort clusters by various criteria
   */
  sortClusters(
    clusters: PatternCluster[],
    sortBy: "confidence" | "occurrences" | "sessions" = "confidence"
  ): PatternCluster[] {
    return [...clusters].sort((a, b) => {
      switch (sortBy) {
        case "confidence":
          return b.avg_confidence - a.avg_confidence;
        case "occurrences":
          return b.total_occurrences - a.total_occurrences;
        case "sessions":
          return b.session_count - a.session_count;
        default:
          return 0;
      }
    });
  }

  close() {
    this.db.close();
  }
}
