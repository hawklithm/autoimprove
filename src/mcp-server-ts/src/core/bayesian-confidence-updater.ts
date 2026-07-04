/**
 * Bayesian confidence updater for signal dictionary
 */

import { SignalDictionaryDB, SignalEntry } from "../storage/signal-dictionary-db.js";

export interface ConfidenceUpdateFeedback {
  outcome?: "true_positive" | "false_positive" | "uncertain";
  coOccurringSignals?: SignalEntry[];
  daysSinceLastSeen?: number;
}

export class BayesianConfidenceUpdater {
  private db: SignalDictionaryDB;
  private learningRate: number;

  constructor(learningRate: number = 0.1) {
    this.db = new SignalDictionaryDB();
    this.learningRate = learningRate;
  }

  /**
   * Update signal confidence based on match outcome
   * Uses Bayesian inference: P(H|E) = P(E|H) * P(H) / P(E)
   */
  updateByOutcome(
    signal: SignalEntry,
    outcome: "true_positive" | "false_positive" | "uncertain"
  ): number {
    const prior = signal.confidence;

    // Calculate likelihood based on outcome
    let likelihood: number;
    if (outcome === "true_positive") {
      likelihood = 0.9; // Strong positive evidence
    } else if (outcome === "false_positive") {
      likelihood = 0.1; // Strong negative evidence
    } else {
      likelihood = 0.5; // Neutral
    }

    // Bayesian update using weighted average
    // This is a simplified version: posterior ≈ prior * (1-α) + likelihood * α
    const posterior = prior * (1 - this.learningRate) + likelihood * this.learningRate;

    // Apply bounds [0.1, 0.95] to prevent extreme values
    return this.clamp(posterior, 0.1, 0.95);
  }

  /**
   * Update based on co-occurrence with high-confidence signals
   * If a signal often appears with high-confidence signals, boost its confidence
   */
  updateByCoOccurrence(
    signal: SignalEntry,
    coOccurringSignals: SignalEntry[]
  ): number {
    if (coOccurringSignals.length === 0) {
      return signal.confidence;
    }

    // Calculate average confidence of co-occurring signals
    const avgCoConfidence = coOccurringSignals.reduce(
      (sum, s) => sum + s.confidence,
      0
    ) / coOccurringSignals.length;

    // Weighted update with small weight for co-occurrence
    const coOccurrenceWeight = 0.05;
    const updated = signal.confidence * (1 - coOccurrenceWeight) + avgCoConfidence * coOccurrenceWeight;

    return this.clamp(updated, 0.1, 0.95);
  }

  /**
   * Apply time decay for signals that haven't been seen recently
   * Signals lose confidence over time if not used
   */
  applyTimeDecay(signal: SignalEntry, daysSinceLastSeen: number): number {
    if (daysSinceLastSeen < 30) {
      return signal.confidence; // No decay for recent signals
    }

    // Exponential decay: confidence * e^(-λt)
    const lambda = 0.01; // Decay rate
    const decayFactor = Math.exp(-lambda * daysSinceLastSeen);

    const decayed = signal.confidence * decayFactor;

    return this.clamp(decayed, 0.1, 0.95);
  }

  /**
   * Comprehensive multi-factor update
   * Combines all update factors in sequence
   */
  comprehensiveUpdate(
    signal: SignalEntry,
    feedback: ConfidenceUpdateFeedback
  ): number {
    let newConfidence = signal.confidence;
    const evidence: any = {};

    // Apply outcome-based update
    if (feedback.outcome) {
      const beforeOutcome = newConfidence;
      newConfidence = this.updateByOutcome(
        { ...signal, confidence: newConfidence },
        feedback.outcome
      );
      evidence.outcome_update = {
        before: beforeOutcome,
        after: newConfidence,
        outcome: feedback.outcome
      };
    }

    // Apply co-occurrence update
    if (feedback.coOccurringSignals && feedback.coOccurringSignals.length > 0) {
      const beforeCoOccurrence = newConfidence;
      newConfidence = this.updateByCoOccurrence(
        { ...signal, confidence: newConfidence },
        feedback.coOccurringSignals
      );
      evidence.co_occurrence = {
        before: beforeCoOccurrence,
        after: newConfidence,
        co_occurring_count: feedback.coOccurringSignals.length,
        avg_co_confidence: feedback.coOccurringSignals.reduce((sum, s) => sum + s.confidence, 0) / feedback.coOccurringSignals.length
      };
    }

    // Apply time decay
    if (feedback.daysSinceLastSeen !== undefined) {
      const beforeDecay = newConfidence;
      newConfidence = this.applyTimeDecay(
        { ...signal, confidence: newConfidence },
        feedback.daysSinceLastSeen
      );
      evidence.time_decay = {
        before: beforeDecay,
        after: newConfidence,
        days_since_last_seen: feedback.daysSinceLastSeen
      };
    }

    return newConfidence;
  }

  /**
   * Update signal confidence in database and record history
   */
  updateSignalConfidence(
    signalId: number,
    feedback: ConfidenceUpdateFeedback,
    reason: "bayesian_update" | "feedback" | "co_occurrence" | "time_decay"
  ): { oldConfidence: number; newConfidence: number } {
    const signal = this.db.getSignalById(signalId);
    if (!signal) {
      throw new Error(`Signal ${signalId} not found`);
    }

    const oldConfidence = signal.confidence;
    const newConfidence = this.comprehensiveUpdate(signal, feedback);

    // Build evidence object
    const evidence: any = {};
    if (feedback.outcome) {
      evidence.outcome = feedback.outcome;
    }
    if (feedback.coOccurringSignals) {
      evidence.co_occurring_count = feedback.coOccurringSignals.length;
    }
    if (feedback.daysSinceLastSeen !== undefined) {
      evidence.days_since_last_seen = feedback.daysSinceLastSeen;
    }

    // Update in database
    this.db.updateSignalConfidence(signalId, newConfidence, reason, evidence);

    return { oldConfidence, newConfidence };
  }

  /**
   * Batch update multiple signals (e.g., after a session analysis)
   */
  batchUpdate(updates: Array<{ signalId: number; feedback: ConfidenceUpdateFeedback; reason: string }>) {
    const results: Array<{ signalId: number; oldConfidence: number; newConfidence: number }> = [];

    for (const update of updates) {
      try {
        const result = this.updateSignalConfidence(
          update.signalId,
          update.feedback,
          update.reason as any
        );
        results.push({ signalId: update.signalId, ...result });
      } catch (error) {
        // console.error(`Failed to update signal ${update.signalId}:`, error);
      }
    }

    return results;
  }

  /**
   * Update signal based on user feedback (from feedback recording)
   */
  updateFromUserFeedback(
    signalId: number,
    feedbackType: "used" | "ignored" | "corrected" | "disabled",
    userRating?: number
  ) {
    const signal = this.db.getSignalById(signalId);
    if (!signal) {
      throw new Error(`Signal ${signalId} not found`);
    }

    let outcome: "true_positive" | "false_positive" | "uncertain";

    switch (feedbackType) {
      case "used":
        outcome = "true_positive";
        this.db.recordMatchOutcome(signalId, "true_positive");
        break;
      case "corrected":
        outcome = "false_positive";
        this.db.recordMatchOutcome(signalId, "false_positive");
        break;
      case "ignored":
        outcome = userRating && userRating >= 4 ? "true_positive" : "false_positive";
        break;
      case "disabled":
        outcome = "false_positive";
        this.db.recordMatchOutcome(signalId, "false_positive");
        break;
      default:
        outcome = "uncertain";
    }

    return this.updateSignalConfidence(signalId, { outcome }, "feedback");
  }

  /**
   * Periodic maintenance: apply time decay to all signals
   */
  applyGlobalTimeDecay() {
    const signals = this.db.getAllSignals();
    const now = Date.now();
    const updates: Array<{ signalId: number; feedback: ConfidenceUpdateFeedback; reason: string }> = [];

    for (const signal of signals) {
      if (!signal.id) continue;

      const lastSeen = new Date(signal.last_seen);
      const daysSince = (now - lastSeen.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSince > 30) {
        updates.push({
          signalId: signal.id,
          feedback: { daysSinceLastSeen: daysSince },
          reason: "time_decay"
        });
      }
    }

    // console.error(`Applying time decay to ${updates.length} signals`);
    return this.batchUpdate(updates);
  }

  /**
   * Calculate precision for a signal based on true/false positive counts
   */
  calculatePrecision(signal: SignalEntry): number {
    const total = signal.true_positive + signal.false_positive;
    if (total === 0) return 0.5; // Unknown, assume neutral

    return signal.true_positive / total;
  }

  /**
   * Suggest confidence adjustment based on precision
   */
  suggestConfidenceFromPrecision(signal: SignalEntry): number {
    const precision = this.calculatePrecision(signal);
    const currentConfidence = signal.confidence;

    // Weighted combination of precision and current confidence
    const precisionWeight = Math.min(1.0, (signal.true_positive + signal.false_positive) / 10);
    const suggested = currentConfidence * (1 - precisionWeight) + precision * precisionWeight;

    return this.clamp(suggested, 0.1, 0.95);
  }

  /**
   * Prune low-confidence signals that have many false positives
   */
  identifyPruningCandidates(minConfidence: number = 0.2, minMatches: number = 10): SignalEntry[] {
    const signals = this.db.getAllSignals();
    const candidates: SignalEntry[] = [];

    for (const signal of signals) {
      if (signal.confidence < minConfidence && signal.match_count >= minMatches) {
        const precision = this.calculatePrecision(signal);
        if (precision < 0.3) {
          candidates.push(signal);
        }
      }
    }

    return candidates;
  }

  /**
   * Utility: clamp value to range
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  close() {
    this.db.close();
  }
}
