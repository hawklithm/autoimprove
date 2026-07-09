/**
 * Message Clusterer - Groups similar user messages into coherent patterns
 *
 * Solves the problem where unrelated corrections are merged into one pattern,
 * or related corrections are split into separate patterns.
 *
 * Uses TF-IDF based text similarity (no external API needed)
 */

import { PatternType, PatternOccurrence } from "./models.js";
import { Message } from "./jsonl-parser.js";

export interface MessageCandidate {
  message: Message;
  occurrence: PatternOccurrence;
  extractedText: string;  // Cleaned, meaningful text
}

export interface MessageCluster {
  candidates: MessageCandidate[];
  centroid: string;              // Representative text
  keywords: string[];
  filePaths: Set<string>;
  averageSimilarity: number;
}

export class MessageClusterer {
  private readonly SIMILARITY_THRESHOLD = 0.25;  // Minimum similarity to join cluster (lowered for semantic grouping)
  private readonly MIN_CLUSTER_SIZE = 1;         // Allow single-occurrence patterns
  private readonly MAX_CLUSTER_SIZE = 20;        // Prevent over-aggregation

  // Semantic keyword groups - helps cluster related but differently-expressed messages
  private readonly SEMANTIC_GROUPS = [
    ['usestate', 'useeffect', 'usememo', 'usecallback', 'useref', 'hooks', 'hook'],  // React Hooks
    ['sql', 'query', 'database', '查询', '数据库', 'injection', '注入'],  // Database/SQL
    ['component', '组件', 'jsx', 'tsx', 'react'],  // React Components
    ['performance', '性能', 'optimize', '优化', 'slow', '慢'],  // Performance
    ['security', '安全', 'vulnerability', '漏洞', 'xss', 'csrf'],  // Security
  ];

  /**
   * Cluster candidates into semantically similar groups
   */
  clusterMessages(candidates: MessageCandidate[]): MessageCluster[] {
    if (candidates.length === 0) {
      return [];
    }

    // For single candidate, return as single cluster
    if (candidates.length === 1) {
      const keywords = this.extractKeywords(candidates[0].extractedText);
      const filePath = candidates[0].occurrence.context;

      return [{
        candidates: candidates,
        centroid: candidates[0].extractedText,
        keywords,
        filePaths: new Set(filePath && filePath !== "unknown" ? [filePath] : []),
        averageSimilarity: 1.0
      }];
    }

    // Build TF-IDF vectors for all candidates
    const vectors = this.buildTFIDFVectors(candidates);

    // Hierarchical clustering
    const clusters: MessageCluster[] = [];
    const assigned = new Set<number>();

    // Sort by length (longer messages first - better centroids)
    const sortedIndices = candidates
      .map((c, i) => ({ index: i, length: c.extractedText.length }))
      .sort((a, b) => b.length - a.length)
      .map(x => x.index);

    for (const seedIndex of sortedIndices) {
      if (assigned.has(seedIndex)) continue;

      const cluster = this.growCluster(
        seedIndex,
        candidates,
        vectors,
        assigned
      );

      if (cluster.candidates.length >= this.MIN_CLUSTER_SIZE) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Grow a cluster from a seed point
   */
  private growCluster(
    seedIndex: number,
    candidates: MessageCandidate[],
    vectors: Map<number, Map<string, number>>,
    assigned: Set<number>
  ): MessageCluster {
    const clusterCandidates: MessageCandidate[] = [candidates[seedIndex]];
    const filePaths = new Set<string>();
    const seedPath = candidates[seedIndex].occurrence.context;
    if (seedPath && seedPath !== "unknown") {
      filePaths.add(seedPath);
    }

    assigned.add(seedIndex);

    const seedVector = vectors.get(seedIndex)!;
    let totalSimilarity = 1.0;
    let count = 1;

    // Find similar candidates
    for (let i = 0; i < candidates.length; i++) {
      if (assigned.has(i)) continue;
      if (clusterCandidates.length >= this.MAX_CLUSTER_SIZE) break;

      const candidate = candidates[i];
      const candidateVector = vectors.get(i)!;

      // Calculate multiple similarity metrics
      const cosineSim = this.cosineSimilarity(seedVector, candidateVector);
      const pathSim = this.pathSimilarity(
        candidates[seedIndex].occurrence.context,
        candidate.occurrence.context
      );
      const semanticBoost = this.calculateSemanticBoost(
        candidates[seedIndex].extractedText,
        candidate.extractedText
      );

      // Weighted combined similarity with semantic boost
      const combinedSim =
        cosineSim * 0.6 +      // Text similarity
        pathSim * 0.2 +        // File context
        semanticBoost * 0.2;   // Semantic keyword overlap

      if (combinedSim >= this.SIMILARITY_THRESHOLD) {
        clusterCandidates.push(candidate);
        const candidatePath = candidate.occurrence.context;
        if (candidatePath && candidatePath !== "unknown") {
          filePaths.add(candidatePath);
        }
        assigned.add(i);
        totalSimilarity += combinedSim;
        count++;
      }
    }

    // Extract keywords from all messages in cluster
    const allText = clusterCandidates.map(c => c.extractedText).join(' ');
    const keywords = this.extractKeywords(allText);

    return {
      candidates: clusterCandidates,
      centroid: this.selectCentroid(clusterCandidates),
      keywords,
      filePaths,
      averageSimilarity: totalSimilarity / count
    };
  }

  /**
   * Build TF-IDF vectors for all candidates
   */
  private buildTFIDFVectors(
    candidates: MessageCandidate[]
  ): Map<number, Map<string, number>> {
    // Tokenize all documents
    const documents = candidates.map(c => this.tokenize(c.extractedText));

    // Calculate document frequency (DF)
    const df = new Map<string, number>();
    for (const doc of documents) {
      const uniqueTerms = new Set(doc);
      for (const term of uniqueTerms) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }

    const numDocs = documents.length;

    // Calculate TF-IDF for each document
    const vectors = new Map<number, Map<string, number>>();

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const vector = new Map<string, number>();

      // Count term frequency
      const tf = new Map<string, number>();
      for (const term of doc) {
        tf.set(term, (tf.get(term) || 0) + 1);
      }

      // Calculate TF-IDF
      for (const [term, termFreq] of tf.entries()) {
        const docFreq = df.get(term) || 1;
        const idf = Math.log(numDocs / docFreq);
        const tfidf = termFreq * idf;
        vector.set(term, tfidf);
      }

      // Normalize vector
      const magnitude = Math.sqrt(
        Array.from(vector.values()).reduce((sum, val) => sum + val * val, 0)
      );
      if (magnitude > 0) {
        for (const [term, value] of vector.entries()) {
          vector.set(term, value / magnitude);
        }
      }

      vectors.set(i, vector);
    }

    return vectors;
  }

  /**
   * Tokenize text into terms (simple word-based)
   */
  private tokenize(text: string): string[] {
    // Remove punctuation and convert to lowercase
    const normalized = text
      .toLowerCase()
      .replace(/[^\w\s一-龥]/g, ' ')  // Keep alphanumeric + Chinese chars
      .trim();

    // Split into words
    const words = normalized.split(/\s+/);

    // Filter stop words and short words
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'is', 'are',
      'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
      'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must',
      '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
      '这', '个', '上', '来', '说', '到', '要', '可以', '里', '着'
    ]);

    return words.filter(w =>
      w.length >= 2 &&
      !stopWords.has(w) &&
      !/^\d+$/.test(w)  // Remove pure numbers
    );
  }

  /**
   * Calculate cosine similarity between two TF-IDF vectors
   */
  private cosineSimilarity(
    vec1: Map<string, number>,
    vec2: Map<string, number>
  ): number {
    let dotProduct = 0;

    // Calculate dot product
    for (const [term, val1] of vec1.entries()) {
      const val2 = vec2.get(term);
      if (val2 !== undefined) {
        dotProduct += val1 * val2;
      }
    }

    // Vectors are already normalized, so cosine = dot product
    return dotProduct;
  }

  /**
   * Calculate file path similarity
   */
  private pathSimilarity(path1?: string, path2?: string): number {
    if (!path1 || !path2 || path1 === "unknown" || path2 === "unknown") {
      return 0.5;  // Neutral if either missing
    }

    if (path1 === path2) {
      return 1.0;  // Exact match
    }

    // Check if same directory
    const dir1 = path1.split('/').slice(0, -1).join('/');
    const dir2 = path2.split('/').slice(0, -1).join('/');

    if (dir1 === dir2) {
      return 0.8;  // Same directory
    }

    // Check if same parent directory
    const parent1 = dir1.split('/').slice(0, -1).join('/');
    const parent2 = dir2.split('/').slice(0, -1).join('/');

    if (parent1 === parent2) {
      return 0.6;  // Same parent
    }

    // Check if same top-level directory (e.g., both in src/)
    const top1 = path1.split('/')[0];
    const top2 = path2.split('/')[0];

    if (top1 === top2) {
      return 0.4;  // Same top-level
    }

    return 0.0;  // Completely different
  }

  /**
   * Calculate semantic boost based on shared keyword groups
   * Helps cluster messages about the same topic even if worded differently
   */
  private calculateSemanticBoost(text1: string, text2: string): number {
    const tokens1 = new Set(this.tokenize(text1));
    const tokens2 = new Set(this.tokenize(text2));

    let maxGroupOverlap = 0;

    // Check each semantic group for overlap
    for (const group of this.SEMANTIC_GROUPS) {
      const groupSet = new Set(group);

      // Count how many tokens from each text belong to this group
      const matches1 = Array.from(tokens1).filter(t => groupSet.has(t)).length;
      const matches2 = Array.from(tokens2).filter(t => groupSet.has(t)).length;

      if (matches1 > 0 && matches2 > 0) {
        // Both texts have keywords from this semantic group
        // Higher overlap = stronger boost
        const groupOverlap = Math.min(matches1, matches2) / Math.max(matches1, matches2);
        maxGroupOverlap = Math.max(maxGroupOverlap, groupOverlap);
      }
    }

    return maxGroupOverlap;
  }

  /**
   * Select best centroid from cluster
   */
  private selectCentroid(candidates: MessageCandidate[]): string {
    if (candidates.length === 1) {
      return candidates[0].extractedText; }

    // Choose the longest, most informative message
    const sorted = [...candidates].sort((a, b) => {
      const lengthDiff = b.extractedText.length - a.extractedText.length;
      return lengthDiff;
    });

    return sorted[0].extractedText;
  }

  /**
   * Extract keywords from text using TF-IDF
   */
  extractKeywords(text: string, maxKeywords: number = 10): string[] {
    const tokens = this.tokenize(text);

    if (tokens.length === 0) {
      return [];
    }

    // Count frequency
    const freq = new Map<string, number>();
    for (const token of tokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }

    // Sort by frequency and length (prefer longer, more specific terms)
    const sorted = Array.from(freq.entries())
      .sort((a, b) => {
        const freqDiff = b[1] - a[1];
        if (freqDiff !== 0) return freqDiff;
        return b[0].length - a[0].length;  // Tie-breaker: longer terms
      });

    return sorted.slice(0, maxKeywords).map(([term]) => term);
  }
}
