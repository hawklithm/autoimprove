/**
 * Signal matcher using Aho-Corasick algorithm for efficient multi-pattern matching
 */

import AhoCorasick from "aho-corasick";
import { SignalDictionaryDB, SignalEntry } from "../storage/signal-dictionary-db.js";

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

export class SignalMatcher {
  private db: SignalDictionaryDB;
  private ac: any; // Aho-Corasick automaton
  private signalMap: Map<string, SignalEntry>;
  private lastBuildTime: number;
  private rebuildInterval: number = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.db = new SignalDictionaryDB();
    this.signalMap = new Map();
    this.lastBuildTime = 0;
    this.buildAutomaton();
  }

  /**
   * Build Aho-Corasick automaton from signal dictionary
   */
  private buildAutomaton() {
    const signals = this.db.getAllSignals();

    if (signals.length === 0) {
      // console.error("Warning: Signal dictionary is empty. Run initialization first.");
      return;
    }

    // Build pattern array and signal map
    const patterns: string[] = [];
    this.signalMap.clear();

    for (const signal of signals) {
      // Add both lowercase and original case
      const lowerText = signal.text.toLowerCase();
      patterns.push(lowerText);
      this.signalMap.set(lowerText, signal);
    }

    // Build Aho-Corasick automaton
    this.ac = new AhoCorasick(patterns);
    this.lastBuildTime = Date.now();

    // console.error(`Built signal matcher with ${patterns.length} patterns`);
  }

  /**
   * Rebuild automaton if signal dictionary has been updated
   */
  private maybeRebuild() {
    const now = Date.now();
    if (now - this.lastBuildTime > this.rebuildInterval) {
      this.buildAutomaton();
    }
  }

  /**
   * Match signals in content
   */
  match(content: string, sessionId?: string, messageId?: string): MatchResult {
    this.maybeRebuild();

    if (!this.ac) {
      return {
        content,
        matched_signals: [],
        aggregated_confidence: 0,
        is_matched: false
      };
    }

    const lowerContent = content.toLowerCase();
    const matches = this.ac.search(lowerContent);

    if (matches.length === 0) {
      return {
        content,
        matched_signals: [],
        aggregated_confidence: 0,
        is_matched: false
      };
    }

    // Process matches
    const matchedSignals: MatchedSignal[] = [];
    const signalCounts = new Map<string, number>();

    for (const match of matches) {
      const [endIndex, patterns] = match;

      for (const pattern of patterns) {
        const signal = this.signalMap.get(pattern);
        if (!signal || !signal.id) continue;

        const position = endIndex - pattern.length + 1;
        const contextWindow = this.extractContextWindow(content, position, pattern.length);

        // Count occurrences for contribution weight
        signalCounts.set(pattern, (signalCounts.get(pattern) || 0) + 1);

        matchedSignals.push({
          signal_text: signal.text,
          signal_id: signal.id,
          position,
          context_window: contextWindow,
          confidence: signal.confidence,
          pattern_type: signal.pattern_type,
          polarity: signal.polarity,
          contribution_weight: 0 // Will be calculated below
        });

        // Record match in database
        if (sessionId && messageId) {
          this.db.recordSignalMatch({
            signal_id: signal.id,
            session_id: sessionId,
            message_id: messageId,
            matched_at: new Date().toISOString(),
            context_window: contextWindow
          });
          this.db.incrementMatchCount(signal.id);
        }
      }
    }

    // Calculate contribution weights (normalized)
    const totalMatches = matchedSignals.length;
    for (const match of matchedSignals) {
      const count = signalCounts.get(match.signal_text.toLowerCase()) || 1;
      match.contribution_weight = count / totalMatches;
    }

    // Determine dominant pattern type and aggregate confidence
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
   * Batch match multiple contents
   */
  batchMatch(contents: Array<{ content: string; sessionId?: string; messageId?: string }>): MatchResult[] {
    return contents.map(({ content, sessionId, messageId }) =>
      this.match(content, sessionId, messageId)
    );
  }

  /**
   * Extract context window around match
   */
  private extractContextWindow(content: string, position: number, length: number, windowSize: number = 50): string {
    const start = Math.max(0, position - windowSize);
    const end = Math.min(content.length, position + length + windowSize);

    let window = content.substring(start, end);

    // Add ellipsis
    if (start > 0) window = "..." + window;
    if (end < content.length) window = window + "...";

    return window;
  }

  /**
   * Aggregate signals to determine pattern type and confidence
   */
  private aggregateSignals(signals: MatchedSignal[]): { pattern_type?: string; aggregated_confidence: number } {
    if (signals.length === 0) {
      return { aggregated_confidence: 0 };
    }

    // Group by pattern type
    const typeGroups = new Map<string, MatchedSignal[]>();
    for (const signal of signals) {
      const group = typeGroups.get(signal.pattern_type) || [];
      group.push(signal);
      typeGroups.set(signal.pattern_type, group);
    }

    // Find dominant type (by weighted confidence)
    let maxWeightedConfidence = 0;
    let dominantType: string | undefined;

    for (const [type, group] of typeGroups) {
      const weightedConfidence = group.reduce(
        (sum, s) => sum + s.confidence * s.contribution_weight,
        0
      );

      if (weightedConfidence > maxWeightedConfidence) {
        maxWeightedConfidence = weightedConfidence;
        dominantType = type;
      }
    }

    // Calculate aggregated confidence (weighted average)
    const aggregated = signals.reduce(
      (sum, s) => sum + s.confidence * s.contribution_weight,
      0
    );

    return {
      pattern_type: dominantType,
      aggregated_confidence: Math.min(0.95, aggregated) // Cap at 0.95
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      total_patterns: this.signalMap.size,
      last_build: new Date(this.lastBuildTime).toISOString(),
      dictionary_stats: this.db.getDictionaryStats()
    };
  }

  /**
   * Force rebuild automaton
   */
  rebuild() {
    this.buildAutomaton();
  }

  close() {
    this.db.close();
  }
}
