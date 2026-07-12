/**
 * NeighborSignalMatcher — semantic (nearest-neighbor) signal matcher.
 *
 * Replaces Aho-Corasick exact substring matching (SignalMatcher) with
 * EmbeddingEncoder-based top-k cosine neighbor search over the signal dictionary.
 * This lets cross-lingual / paraphrased user messages match semantically
 * related signals that share no literal substring.
 *
 * Pure CPU, zero external deps (reuses EmbeddingEncoder.char-ngram-tfidf).
 * FAISS/hnswlib indexing (E3) is optional and not required for correctness.
 */

import { SignalDictionaryDB, SignalEntry } from "../storage/signal-dictionary-db.js";
import { EmbeddingEncoder } from "./embedding-encoder.js";
import { loadConfig } from "../storage/init.js";
import { logger } from "./logger.js";

// Re-export the same shapes SignalMatcher exposes so callers can stay agnostic.
export interface MatchedSignal {
  signal_text: string;
  signal_id: number;
  position: number;
  context_window: string;
  confidence: number;
  pattern_type: string;
  polarity: string;
  contribution_weight: number;
}

export interface MatchResult {
  content: string;
  matched_signals: MatchedSignal[];
  pattern_type?: string;
  aggregated_confidence: number;
  is_matched: boolean;
}

interface IndexedSignal {
  entry: SignalEntry;
  vector: Float32Array; // L2-normalized
}

export class NeighborSignalMatcher {
  private db: SignalDictionaryDB;
  private encoder: EmbeddingEncoder;
  private index: IndexedSignal[] = [];
  private signalMap: Map<string, SignalEntry> = new Map();
  private lastBuildTime = 0;
  private rebuildInterval = 5 * 60 * 1000; // 5 minutes (aligned with SignalMatcher)
  private matchThreshold: number;

  constructor() {
    this.db = new SignalDictionaryDB();
    const cfg = loadConfig().local_ml;
    const backend = (cfg?.embedding_backend as any) || "char-ngram-tfidf";
    this.encoder = new EmbeddingEncoder({ backend });
    this.matchThreshold = cfg?.signal_match?.threshold ?? 0.62;
    this.buildIndex();
  }

  /**
   * Encode all signal texts into a vector index (replaces Aho-Corasick automaton).
   */
  private buildIndex(): void {
    const signals = this.db.getAllSignals();
    this.signalMap.clear();
    this.index = [];

    if (signals.length === 0) {
      logger.consoleWarn("Warning: Signal dictionary is empty. Run initialization first.");
      this.lastBuildTime = Date.now();
      return;
    }

    // Encode all signal texts in one batch (shares IDF state, aligned dims).
    const texts = signals.map(s => s.text);
    const vectors = this.encoder.encodeBatch(texts);

    for (let i = 0; i < signals.length; i++) {
      const lowerText = signals[i].text.toLowerCase();
      this.signalMap.set(lowerText, signals[i]);
      this.index.push({ entry: signals[i], vector: vectors[i] });
    }

    this.lastBuildTime = Date.now();
    logger.consoleLog(`Built neighbor signal index with ${this.index.length} signals (threshold ${this.matchThreshold.toFixed(2)})`);
  }

  /**
   * Rebuild index if dictionary changed (interval-aligned, E3 hook point).
   */
  private maybeRebuild(): void {
    const now = Date.now();
    if (now - this.lastBuildTime > this.rebuildInterval) {
      this.buildIndex();
    }
  }

  /**
   * Match signals in content via top-k cosine neighbor search.
   */
  match(content: string, sessionId?: string, messageId?: string): MatchResult {
    this.maybeRebuild();

    if (this.index.length === 0) {
      return { content, matched_signals: [], aggregated_confidence: 0, is_matched: false };
    }

    const queryVec = this.encoder.encode(content);

    // Top-k neighbor scan (exact; E3 may swap for hnswlib/FAISS).
    const scored: { idx: number; sim: number }[] = [];
    for (let i = 0; i < this.index.length; i++) {
      const sim = EmbeddingEncoder.cosine(queryVec, this.index[i].vector);
      if (sim >= this.matchThreshold) {
        scored.push({ idx: i, sim });
      }
    }

    if (scored.length === 0) {
      return { content, matched_signals: [], aggregated_confidence: 0, is_matched: false };
    }

    // Sort by similarity desc, keep top-k (bounded to avoid runaway matches).
    scored.sort((a, b) => b.sim - a.sim);
    const topK = scored.slice(0, 10);

    const matchedSignals: MatchedSignal[] = [];
    const signalCounts = new Map<string, number>();
    const lowerContent = content.toLowerCase();

    for (const { idx, sim } of topK) {
      const entry = this.index[idx].entry;
      if (!entry.id) continue;

      const pos = lowerContent.indexOf(entry.text.toLowerCase());
      const position = pos >= 0 ? pos : 0;
      const contextWindow = this.extractContextWindow(content, position, entry.text.length);

      signalCounts.set(entry.text.toLowerCase(), (signalCounts.get(entry.text.toLowerCase()) || 0) + 1);

      matchedSignals.push({
        signal_text: entry.text,
        signal_id: entry.id,
        position,
        context_window: contextWindow,
        confidence: entry.confidence * Math.min(1, 0.5 + sim / 2), // blend dict confidence with semantic strength
        pattern_type: entry.pattern_type,
        polarity: entry.polarity,
        contribution_weight: 0 // calculated below
      });

      // Record match side-effects (same as SignalMatcher).
      if (sessionId && messageId) {
        this.db.recordSignalMatch({
          signal_id: entry.id,
          session_id: sessionId,
          message_id: messageId,
          matched_at: new Date().toISOString(),
          context_window: contextWindow
        });
        this.db.incrementMatchCount(entry.id);
      }
    }

    const totalMatches = matchedSignals.length;
    for (const m of matchedSignals) {
      const count = signalCounts.get(m.signal_text.toLowerCase()) || 1;
      m.contribution_weight = count / totalMatches;
    }

    const { pattern_type, aggregated_confidence } = this.aggregateSignals(matchedSignals);

    return {
      content,
      matched_signals: matchedSignals,
      pattern_type,
      aggregated_confidence,
      is_matched: true
    };
  }

  /**
   * Batch match — reuses single match (keeps interface identical to SignalMatcher).
   */
  batchMatch(contents: Array<{ content: string; sessionId?: string; messageId?: string }>): MatchResult[] {
    return contents.map(({ content, sessionId, messageId }) => this.match(content, sessionId, messageId));
  }

  /**
   * Extract context window around a match position (mirrors SignalMatcher).
   */
  private extractContextWindow(content: string, position: number, length: number, windowSize = 50): string {
    const start = Math.max(0, position - windowSize);
    const end = Math.min(content.length, position + length + windowSize);
    let window = content.substring(start, end);
    if (start > 0) window = "..." + window;
    if (end < content.length) window = window + "...";
    return window;
  }

  /**
   * Aggregate matched signals into dominant pattern type + weighted confidence.
   * Logic preserved verbatim from SignalMatcher.aggregateSignals.
   */
  private aggregateSignals(signals: MatchedSignal[]): { pattern_type?: string; aggregated_confidence: number } {
    if (signals.length === 0) return { aggregated_confidence: 0 };

    const typeGroups = new Map<string, MatchedSignal[]>();
    for (const signal of signals) {
      const group = typeGroups.get(signal.pattern_type) || [];
      group.push(signal);
      typeGroups.set(signal.pattern_type, group);
    }

    let maxWeightedConfidence = 0;
    let dominantType: string | undefined;
    for (const [type, group] of typeGroups) {
      const weightedConfidence = group.reduce((sum, s) => sum + s.confidence * s.contribution_weight, 0);
      if (weightedConfidence > maxWeightedConfidence) {
        maxWeightedConfidence = weightedConfidence;
        dominantType = type;
      }
    }

    const aggregated = signals.reduce((sum, s) => sum + s.confidence * s.contribution_weight, 0);
    return { pattern_type: dominantType, aggregated_confidence: Math.min(0.95, aggregated) };
  }

  /**
   * Get statistics (compatible with SignalMatcher.getStats).
   */
  getStats() {
    return {
      total_patterns: this.index.length,
      mode: "neighbor",
      match_threshold: this.matchThreshold,
      last_build: new Date(this.lastBuildTime).toISOString(),
      dictionary_stats: this.db.getDictionaryStats()
    };
  }

  /**
   * Force rebuild index.
   */
  rebuild(): void {
    this.buildIndex();
  }

  close(): void {
    this.db.close();
  }
}
