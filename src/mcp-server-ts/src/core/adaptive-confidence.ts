/**
 * Adaptive confidence calculator for AutoImprove.
 *
 * Learns weights from feedback and applies temporal decay for unused rules.
 */

import { Pattern } from "./models.js";
import { ConfidenceWeights } from "./confidence.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logger } from "./logger.js";

export interface RuleFeedback {
  rule_id: string;
  timestamp: string;
  feedback_type: "used" | "ignored" | "corrected" | "disabled";
  context?: string;
  user_rating?: number; // 1-5
}

export interface UserWeights {
  user_id: string;
  weights: ConfidenceWeights;
  learned_from_feedbacks: number;
  last_updated: string;
}

export class AdaptiveConfidenceCalculator {
  private defaultWeights: ConfidenceWeights = {
    frequency: 0.3,
    time_span: 0.1,
    behavior: 0.4,
    validation: 0.2,
  };

  private userWeightsCache = new Map<string, UserWeights>();
  private feedbackHistory: RuleFeedback[] = [];
  private readonly TEMPORAL_DECAY_DAYS = 90; // Rules decay after 90 days of no use

  constructor() {
    this.loadUserWeights();
    this.loadFeedbackHistory();
  }

  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
  }

  private getWeightsFile(): string {
    return join(this.getStorageRoot(), "user_weights.json");
  }

  private getFeedbackFile(): string {
    return join(this.getStorageRoot(), "feedback_history.jsonl");
  }

  /**
   * Calculate confidence with adaptive weights
   */
  calculateConfidence(pattern: Pattern, userId?: string): number {
    const weights = userId ? this.getUserWeights(userId) : this.defaultWeights;

    // Calculate base confidence
    const frequencyScore = this.calculateFrequencyScore(pattern);
    const timeSpanScore = this.calculateTimeSpanScore(pattern);
    const behaviorScore = this.calculateBehaviorScore(pattern);
    const validationScore = this.calculateValidationScore(pattern);

    const baseConfidence =
      frequencyScore * weights.frequency +
      timeSpanScore * weights.time_span +
      behaviorScore * weights.behavior +
      validationScore * weights.validation;

    return Math.min(baseConfidence, 1.0);
  }

  /**
   * Calculate confidence for existing rule with temporal decay
   */
  calculateRuleConfidence(
    baseConfidence: number,
    ruleId: string,
    lastUsed?: Date
  ): number {
    const decay = this.calculateTemporalDecay(ruleId, lastUsed);
    return baseConfidence * decay;
  }

  /**
   * Learn weights from feedback
   */
  learnWeightsFromFeedback(userId: string, feedbacks: RuleFeedback[]): ConfidenceWeights {
    // Store feedback
    this.feedbackHistory.push(...feedbacks);
    this.saveFeedbackHistory();

    // Analyze feedback patterns
    const positiveCount = feedbacks.filter(
      (f) => f.feedback_type === "used" || (f.user_rating && f.user_rating >= 4)
    ).length;
    const negativeCount = feedbacks.filter(
      (f) => f.feedback_type === "ignored" || f.feedback_type === "corrected" || f.feedback_type === "disabled"
    ).length;

    // Get current weights or use defaults
    const currentWeights = this.getUserWeights(userId);

    // Simple adjustment: increase validation weight if rules are validated,
    // increase behavior weight if user corrections matter
    const newWeights = { ...currentWeights };

    if (positiveCount > negativeCount) {
      // User likes validated rules - increase validation weight
      newWeights.validation = Math.min(newWeights.validation + 0.05, 0.5);
      newWeights.frequency = Math.max(newWeights.frequency - 0.02, 0.1);
    } else if (negativeCount > positiveCount) {
      // User doesn't like current rules - increase behavior weight (more user input focus)
      newWeights.behavior = Math.min(newWeights.behavior + 0.05, 0.6);
      newWeights.time_span = Math.max(newWeights.time_span - 0.02, 0.05);
    }

    // Normalize weights to sum to 1.0
    const sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
    const normalized: ConfidenceWeights = {
      frequency: newWeights.frequency / sum,
      time_span: newWeights.time_span / sum,
      behavior: newWeights.behavior / sum,
      validation: newWeights.validation / sum,
    };

    // Save user weights
    const userWeights: UserWeights = {
      user_id: userId,
      weights: normalized,
      learned_from_feedbacks: feedbacks.length,
      last_updated: new Date().toISOString(),
    };

    this.userWeightsCache.set(userId, userWeights);
    this.saveUserWeights();

    return normalized;
  }

  /**
   * Get personalized weights for a user
   */
  getUserWeights(userId: string): ConfidenceWeights {
    const userWeights = this.userWeightsCache.get(userId);
    return userWeights ? userWeights.weights : this.defaultWeights;
  }

  /**
   * Calculate temporal decay for a rule
   */
  private calculateTemporalDecay(ruleId: string, lastUsed?: Date): number {
    // Find last usage from feedback
    const ruleFeedbacks = this.feedbackHistory
      .filter((f) => f.rule_id === ruleId && f.feedback_type === "used")
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const lastUsedDate = lastUsed || (ruleFeedbacks.length > 0 ? new Date(ruleFeedbacks[0].timestamp) : null);

    if (!lastUsedDate) {
      // No usage data - use creation date proxy
      return 1.0;
    }

    const daysSinceUse = (Date.now() - lastUsedDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceUse < this.TEMPORAL_DECAY_DAYS) {
      return 1.0;
    }

    // Linear decay: from 1.0 at TEMPORAL_DECAY_DAYS to 0.5 at 2x TEMPORAL_DECAY_DAYS
    const decayFactor = Math.max(
      0.5,
      1.0 - (daysSinceUse - this.TEMPORAL_DECAY_DAYS) / this.TEMPORAL_DECAY_DAYS * 0.5
    );

    return decayFactor;
  }

  /**
   * Record feedback for a rule
   */
  recordFeedback(feedback: RuleFeedback): void {
    this.feedbackHistory.push(feedback);
    this.saveFeedbackHistory();
  }

  /**
   * Get feedback statistics
   */
  getFeedbackStats(ruleId?: string): {
    total: number;
    used: number;
    ignored: number;
    corrected: number;
    disabled: number;
    avg_rating?: number;
  } {
    const feedbacks = ruleId
      ? this.feedbackHistory.filter((f) => f.rule_id === ruleId)
      : this.feedbackHistory;

    const stats = {
      total: feedbacks.length,
      used: feedbacks.filter((f) => f.feedback_type === "used").length,
      ignored: feedbacks.filter((f) => f.feedback_type === "ignored").length,
      corrected: feedbacks.filter((f) => f.feedback_type === "corrected").length,
      disabled: feedbacks.filter((f) => f.feedback_type === "disabled").length,
    };

    const ratings = feedbacks.filter((f) => f.user_rating !== undefined).map((f) => f.user_rating!);
    if (ratings.length > 0) {
      return {
        ...stats,
        avg_rating: ratings.reduce((a, b) => a + b, 0) / ratings.length,
      };
    }

    return stats;
  }

  /**
   * Calculate frequency score
   */
  private calculateFrequencyScore(pattern: Pattern): number {
    let baseScore = Math.min(pattern.occurrences.length / 10, 1.0);

    const uniqueSessions = new Set(pattern.occurrences.map((o) => o.session_id));
    if (uniqueSessions.size === 1 && pattern.occurrences.length >= 3) {
      baseScore += 0.1;
    }

    return Math.min(baseScore, 1.0);
  }

  /**
   * Calculate time span score
   */
  private calculateTimeSpanScore(pattern: Pattern): number {
    try {
      const first = new Date(pattern.first_seen);
      const last = new Date(pattern.last_seen);
      const days = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24);
      return Math.min(days / 90, 1.0);
    } catch {
      return 0.0;
    }
  }

  /**
   * Calculate behavior score
   */
  private calculateBehaviorScore(pattern: Pattern): number {
    if (pattern.occurrences.length === 0) {
      return 0.0;
    }

    const validActions = pattern.occurrences.filter(
      (o) => o.user_action === "explicit_correction" || o.user_action === "accept"
    ).length;

    return validActions / pattern.occurrences.length;
  }

  /**
   * Calculate validation score
   */
  private calculateValidationScore(pattern: Pattern): number {
    let score = 0;
    let count = 0;

    for (const occurrence of pattern.occurrences) {
      if (occurrence.test_passed === true) {
        score += 1.0;
        count += 1;
      }
      if (occurrence.performance_improved === true) {
        score += 1.0;
        count += 1;
      }
      if (occurrence.security_issue) {
        score += 1.0;
        count += 1;
      }
    }

    return count > 0 ? score / count : 0.0;
  }

  /**
   * Load user weights from storage
   */
  private loadUserWeights(): void {
    const weightsFile = this.getWeightsFile();
    if (!existsSync(weightsFile)) {
      return;
    }

    try {
      const data = readFileSync(weightsFile, "utf-8");
      const userWeightsArray = JSON.parse(data) as UserWeights[];
      for (const userWeights of userWeightsArray) {
        this.userWeightsCache.set(userWeights.user_id, userWeights);
      }
    } catch (error) {
      logger.error("adaptive-confidence", "Failed to load user weights:", error instanceof Error ? error : undefined);
    }
  }

  /**
   * Save user weights to storage
   */
  private saveUserWeights(): void {
    const storageRoot = this.getStorageRoot();
    if (!existsSync(storageRoot)) {
      mkdirSync(storageRoot, { recursive: true });
    }

    const weightsFile = this.getWeightsFile();
    const userWeightsArray = Array.from(this.userWeightsCache.values());
    writeFileSync(weightsFile, JSON.stringify(userWeightsArray, null, 2));
  }

  /**
   * Load feedback history from storage
   */
  private loadFeedbackHistory(): void {
    const feedbackFile = this.getFeedbackFile();
    if (!existsSync(feedbackFile)) {
      return;
    }

    try {
      const data = readFileSync(feedbackFile, "utf-8");
      const lines = data.trim().split("\n");
      this.feedbackHistory = lines.map((line) => JSON.parse(line) as RuleFeedback);
    } catch (error) {
      logger.error("adaptive-confidence", "Failed to load feedback history:", error instanceof Error ? error : undefined);
    }
  }

  /**
   * Save feedback history to storage
   */
  private saveFeedbackHistory(): void {
    const storageRoot = this.getStorageRoot();
    if (!existsSync(storageRoot)) {
      mkdirSync(storageRoot, { recursive: true });
    }

    const feedbackFile = this.getFeedbackFile();
    const content = this.feedbackHistory.map((f) => JSON.stringify(f)).join("\n") + "\n";
    writeFileSync(feedbackFile, content);
  }
}
