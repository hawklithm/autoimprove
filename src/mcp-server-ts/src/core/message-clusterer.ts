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
import { EmbeddingEncoder } from "./embedding-encoder.js";
import { loadConfig } from "../storage/init.js";
import { ClusterCentroid } from "../storage/session-cache.js";
import { tokenizeWithJieba } from "./jieba-utils.js";

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

export interface ClusterRunStats {
  candidates: number;
  clusters: number;
  singletons: number;        // clusters with a single candidate
  singletonRate: number;      // singletons / clusters
  avgClusterSize: number;
  crossSessionMerges: number; // candidates merged across different sessions
}

export class MessageClusterer {
  private readonly SIMILARITY_THRESHOLD = 0.25;  // Minimum similarity to join cluster (lowered for semantic grouping)
  private readonly MIN_CLUSTER_SIZE = 1;         // Allow single-occurrence patterns
  private readonly MAX_CLUSTER_SIZE = 20;        // Prevent over-aggregation

  // When local_ml.clusterer != "legacy", semantic vectors back the similarity.
  private encoder: EmbeddingEncoder | null = null;
  private lastRunStats: ClusterRunStats = {
    candidates: 0, clusters: 0, singletons: 0, singletonRate: 0, avgClusterSize: 0, crossSessionMerges: 0,
  };

  constructor() {
    const cfg = loadConfig().local_ml;
    if (cfg && cfg.enabled && cfg.clusterer !== "legacy") {
      this.encoder = new EmbeddingEncoder({
        backend: cfg.embedding_backend || "char-ngram-tfidf",
      });
    }
  }

  /** G1: last run clustering metrics (singleton rate, avg cluster size, cross-session merges). */
  getLastRunStats(): ClusterRunStats {
    return this.lastRunStats;
  }

  // Semantic keyword groups - helps cluster related but differently-expressed messages
  private readonly SEMANTIC_GROUPS = [
    ['usestate', 'useeffect', 'usememo', 'usecallback', 'useref', 'hooks', 'hook'],  // React Hooks
    ['sql', 'query', 'database', '查询', '数据库', 'injection', '注入'],  // Database/SQL
    ['component', '组件', 'jsx', 'tsx', 'react'],  // React Components
    ['performance', '性能', 'optimize', '优化', 'slow', '慢'],  // Performance
    ['security', '安全', 'vulnerability', '漏洞', 'xss', 'csrf'],  // Security
  ];

  /**
   * Cluster candidates into semantically similar groups.
   * @param candidates  Message candidates to cluster.
   * @param sessionId   Optional session ID for embedding cache (C2) — when provided,
   *                    avoids re-encoding texts that were already encoded in a previous run.
   */
  async clusterMessages(
    candidates: MessageCandidate[],
    sessionId?: string,
  ): Promise<MessageCluster[]> {
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

    // Build vectors: semantic (char n-gram / ONNX) when encoder active, else legacy word TF-IDF.
    const vectors = this.encoder
      ? await this.buildSemanticVectors(candidates, sessionId)
      : this.buildTFIDFVectors(candidates);

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

    // G1: compute run stats (singleton rate, cross-session merges).
    const singletons = clusters.filter(c => c.candidates.length === 1).length;
    let crossSessionMerges = 0;
    for (const c of clusters) {
      const sessions = new Set(c.candidates.map(cand => cand.occurrence.session_id));
      if (sessions.size > 1) crossSessionMerges += sessions.size - 1;
    }
    const totalCandidates = clusters.reduce((s, c) => s + c.candidates.length, 0);
    this.lastRunStats = {
      candidates: totalCandidates,
      clusters: clusters.length,
      singletons,
      singletonRate: clusters.length > 0 ? singletons / clusters.length : 0,
      avgClusterSize: clusters.length > 0 ? totalCandidates / clusters.length : 0,
      crossSessionMerges,
    };

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

      // Calculate similarity. When a semantic encoder is active, the vector already
      // captures cross-lingual meaning, so we drop the hand-written SEMANTIC_GROUPS
      // boost and weight: 0.8 semantic cosine + 0.2 file-path context (D2).
      const cosineSim = this.cosineSimilarity(seedVector, candidateVector);
      const pathSim = this.pathSimilarity(
        candidates[seedIndex].occurrence.context,
        candidate.occurrence.context
      );

      const combinedSim = this.encoder
        ? cosineSim * 0.8 + pathSim * 0.2
        : cosineSim * 0.6 + pathSim * 0.2 + this.calculateSemanticBoost(
            candidates[seedIndex].extractedText,
            candidate.extractedText
          ) * 0.2;

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
   * Build semantic vectors via EmbeddingEncoder (char n-gram TF-IDF / ONNX) for all candidates.
   * Returns the same sparse-Map shape as buildTFIDFVectors so growCluster/cosineSimilarity
   * are reused unchanged. Only called when a semantic encoder is active (non-legacy mode).
   *
   * C2: embedding results are cached to disk per session. On subsequent runs, previously
   * encoded sessions skip the expensive ONNX inference entirely. Cache is keyed by
   * (sessionId, text). Texts that differ from the cached set trigger a full re-encode.
   */
  private async buildSemanticVectors(
    candidates: MessageCandidate[],
    sessionId?: string,
  ): Promise<Map<number, Map<string, number>>> {
    const texts = candidates.map(c => c.extractedText);

    // C2: try disk cache first — skip ONNX/ngram encoding for unchanged sessions.
    if (sessionId && this.encoder) {
      const cached = this.encoder.loadCache(sessionId);
      if (cached && cached.length === texts.length) {
        const sparse = new Map<number, Map<string, number>>();
        cached.forEach((vec, i) => {
          const m = new Map<string, number>();
          for (let j = 0; j < vec.length; j++) {
            if (vec[j] !== 0) m.set(String(j), vec[j]);
          }
          sparse.set(i, m);
        });
        return sparse;
      }
    }

    const dense = await this.encoder!.encodeBatch(texts); // L2-normalized Float32Array
    const sparse = new Map<number, Map<string, number>>();
    dense.forEach((vec, i) => {
      const m = new Map<string, number>();
      // Index by n-gram feature; encoder stores features implicitly, so we use the
      // index as key (cosine over aligned indices works since encodeBatch is per-batch).
      for (let j = 0; j < vec.length; j++) {
        if (vec[j] !== 0) m.set(String(j), vec[j]);
      }
      sparse.set(i, m);
    });

    // C2: persist encoded vectors for future runs.
    if (sessionId && this.encoder) {
      this.encoder.saveCache(sessionId, dense);
    }

    return sparse;
  }

  /**
   * Tokenize text into terms (word-based with jieba for Chinese).
   *
   * Uses jieba for Chinese word segmentation when available, falls back to
   * whitespace/character-level tokenization. Shared jieba instance from
   * jieba-utils ensures consistent segmentation across the pipeline.
   */
  private tokenize(text: string): string[] {
    // Handle undefined or null text
    if (!text) {
      return [];
    }

    // Use jieba for Chinese text, whitespace split for English
    // minTokenLength=2 so we filter out single-char tokens early
    const jiebaTokens = tokenizeWithJieba(text, 2);

    // If jieba was used (Chinese detected), apply stop word filtering on its output
    const hasChinese = /[一-鿿㐀-䶿]/.test(text);
    if (hasChinese) {
      const stopWords = new Set([
        '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
        '这', '个', '上', '来', '说', '到', '要', '可以', '里', '着', '我们',
        '他们', '它', '那', '什么', '怎么', '为什么', '这个', '那个', '一个',
        '没有', '不是', '但是', '如果', '因为', '所以', '而且', '或者', '虽然',
        '已经', '可以', '应该', '需要', '可能', '然后', '之后', '时候', '问题',
        '方法', '方式', '情况', '结果', '信息', '内容', '东西', '事情',
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'is', 'are',
        'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
        'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must',
      ]);

      return jiebaTokens.filter(w =>
        w.length >= 2 &&
        !stopWords.has(w) &&
        !/^\d+$/.test(w) &&
        /[a-zA-Z0-9一-鿿㐀-䶿]/.test(w)  // Must contain at least one alphanumeric or CJK char
      );
    }

    // English path: use the tokens from jieba-utils directly (it falls back to
    // whitespace split for non-Chinese text), then apply English stop word filter
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'is', 'are',
      'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
      'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must',
    ]);

    return jiebaTokens.filter(w =>
      w.length >= 2 &&
      !stopWords.has(w) &&
      !/^\d+$/.test(w) &&
      /[a-zA-Z0-9一-鿿㐀-䶿]/.test(w)  // Must contain at least one alphanumeric or CJK char
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
   * D3: incrementally cluster new candidates against existing centroids.
   *
   * Each new candidate is compared to all existing cluster centroids (via
   * EmbeddingEncoder cosine). If it falls within SIMILARITY_THRESHOLD of a
   * centroid, it joins that cluster. Otherwise it becomes an "outlier" —
   * collected separately so the caller can decide to form new clusters or
   * discard as noise.
   *
   * Returns merged clusters (existing centroids + new candidates attached)
   * plus any outliers that did not match any centroid.
   *
   * NOTE: only called when a semantic encoder is active (non-legacy mode).
   */
  async incrementalCluster(
    newCandidates: MessageCandidate[],
    existingCentroids: ClusterCentroid[]
  ): Promise<{ clusters: MessageCluster[]; outliers: MessageCandidate[] }> {
    if (!this.encoder || newCandidates.length === 0) {
      // Legacy or no new data — return all as outliers for full clustering.
      return { clusters: [], outliers: newCandidates };
    }

    // Encode new candidates
    const newTexts = newCandidates.map(c => c.extractedText);
    const newVectors = await this.encoder.encodeBatch(newTexts);

    // Reconstruct dense vectors for existing centroids
    const centroidVectors = existingCentroids.map(c =>
      new Float32Array(c.vector)
    );

    const outliers: MessageCandidate[] = [];
    const assigned = new Set<number>();
    // Map from centroid index -> merged candidates
    const mergedMap = new Map<number, MessageCandidate[]>();
    for (let i = 0; i < existingCentroids.length; i++) {
      mergedMap.set(i, []);
    }

    for (let i = 0; i < newCandidates.length; i++) {
      const cand = newCandidates[i];
      const vec = newVectors[i];

      // Find best-matching centroid
      let bestIdx = -1;
      let bestSim = 0;
      for (let j = 0; j < centroidVectors.length; j++) {
        const sim = EmbeddingEncoder.cosine(vec, centroidVectors[j]);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = j;
        }
      }

      if (bestIdx >= 0 && bestSim >= this.SIMILARITY_THRESHOLD) {
        // Join existing cluster
        mergedMap.get(bestIdx)!.push(cand);
        assigned.add(i);
      } else {
        // Outlier — did not match any centroid
        outliers.push(cand);
      }
    }

    // Build result clusters from centroids + newly merged candidates
    const clusters: MessageCluster[] = [];
    for (let i = 0; i < existingCentroids.length; i++) {
      const cent = existingCentroids[i];
      const merged = mergedMap.get(i)!;
      if (merged.length === 0) continue; // no new additions

      const filePaths = new Set(cent.filePaths);
      const allCandidates: MessageCandidate[] = [];
      // Reconstruct candidate list — we don't store full candidates in the
      // centroid cache, so we only include the new merged ones. The cluster
      // centroid text and keywords remain from the original.
      for (const mc of merged) {
        allCandidates.push(mc);
        const ctx = mc.occurrence.context;
        if (ctx && ctx !== "unknown") filePaths.add(ctx);
      }

      clusters.push({
        candidates: allCandidates,
        centroid: cent.centroidText,
        keywords: cent.keywords,
        filePaths,
        averageSimilarity: cent.averageSimilarity,
      });
    }

    return { clusters, outliers };
  }

  /**
   * D3: serialise current clusters into ClusterCentroid[] for cache.
   * Called after full clustering so subsequent incremental runs can use them.
   */
  async clustersToCentroids(clusters: MessageCluster[]): Promise<ClusterCentroid[]> {
    if (!this.encoder) return [];

    const centroids: ClusterCentroid[] = [];
    for (const c of clusters) {
      // Encode centroid text to get the dense vector
      const vec = await this.encoder.encode(c.centroid);
      centroids.push({
        vector: Array.from(vec),
        centroidText: c.centroid,
        size: c.candidates.length,
        averageSimilarity: c.averageSimilarity,
        keywords: c.keywords,
        filePaths: Array.from(c.filePaths),
      });
    }
    return centroids;
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
