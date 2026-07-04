/**
 * Confidence calculation for AutoImprove patterns.
 *
 * Implements v2.0 confidence formula with weighted components.
 */

import { Pattern, PatternType } from "./models.js";

// Pattern-specific strategies
export const PATTERN_STRATEGIES: Record<
  PatternType,
  {
    min_confidence: number;
    min_occurrences: number;
    requires_multiple_sessions?: boolean;
    requires_test_validation?: boolean;
    requires_performance_evidence?: boolean;
    weight_adjustment: number;
    detect_keywords: string[];
    priority?: string;
  }
> = {
  [PatternType.REPEATED_CORRECTION]: {
    min_confidence: 0.45,
    min_occurrences: 2,
    requires_multiple_sessions: false,
    weight_adjustment: 1.0,
    detect_keywords: []
  },
  [PatternType.ANTI_PATTERN]: {
    min_confidence: 0.45,
    min_occurrences: 1,
    requires_test_validation: true,
    weight_adjustment: 1.0,
    detect_keywords: []
  },
  [PatternType.PREFERENCE]: {
    min_confidence: 0.3,
    min_occurrences: 1,
    requires_multiple_sessions: false,
    weight_adjustment: 1.0,
    detect_keywords: [
      "我们团队",
      "团队习惯",
      "我更喜欢",
      "我们约定",
      "we prefer",
      "our team",
      "we use",
      "convention"
    ]
  },
  [PatternType.PERFORMANCE]: {
    min_confidence: 0.4,
    min_occurrences: 1,
    requires_performance_evidence: true,
    weight_adjustment: 1.0,
    detect_keywords: [
      "useMemo",
      "useCallback",
      "React.memo",
      "重渲染",
      "性能",
      "optimize",
      "performance",
      "slow",
      "lag",
      "卡顿"
    ]
  },
  [PatternType.SECURITY]: {
    min_confidence: 0.5,
    min_occurrences: 1,
    requires_multiple_sessions: false,
    weight_adjustment: 1.0,  // Changed from 1.5 - no automatic bonus
    priority: "critical",
    detect_keywords: [
      "sql injection",
      "xss",
      "csrf",
      "injection",
      "注入",
      "安全",
      "security",
      "vulnerability",
      "sanitize",
      "escape",
      "validate",
      "attack"
    ]
  }
};

export interface ConfidenceWeights {
  frequency: number;
  time_span: number;
  behavior: number;
  validation: number;
}

export class ConfidenceCalculator {
  private weights: ConfidenceWeights;

  constructor(weights?: Partial<ConfidenceWeights>) {
    this.weights = {
      frequency: 0.3,
      time_span: 0.1,
      behavior: 0.4,
      validation: 0.2,
      ...weights
    };
  }

  calculateConfidence(pattern: Pattern): number {
    // Step 1: Calculate base confidence
    const baseConfidence = this.calculateBaseConfidence(pattern);

    // Step 2: Apply occurrence-based cap (single occurrence max 0.6)
    const cappedConfidence = this.applyOccurrenceCap(pattern, baseConfidence);

    // Step 3: Apply session diversity requirement
    const sessionAdjusted = this.applySessionDiversityBonus(pattern, cappedConfidence);

    // Step 4: Apply type-specific adjustments
    const adjustedConfidence = this.applyTypeAdjustments(pattern, sessionAdjusted);

    // Step 5: Apply keyword bonus
    const finalConfidence = this.applyKeywordBonus(pattern, adjustedConfidence);

    return Math.min(finalConfidence, 1.0);
  }

  /**
   * Cap confidence based on occurrence count
   * Single occurrence patterns max out at 0.6 confidence
   */
  private applyOccurrenceCap(pattern: Pattern, baseConfidence: number): number {
    const occurrenceCount = pattern.occurrences.length;

    // Single occurrence: max 0.6
    if (occurrenceCount === 1) {
      return Math.min(baseConfidence, 0.6);
    }

    // 2 occurrences: max 0.75
    if (occurrenceCount === 2) {
      return Math.min(baseConfidence, 0.75);
    }

    // 3+ occurrences: no cap (allow reaching higher confidence)
    return baseConfidence;
  }

  /**
   * Bonus for patterns verified across multiple independent sessions
   * Required for reaching 0.9+ confidence
   */
  private applySessionDiversityBonus(pattern: Pattern, confidence: number): number {
    const uniqueSessions = new Set(pattern.occurrences.map(o => o.session_id));
    const sessionCount = uniqueSessions.size;

    // Need 3+ sessions for high confidence (0.9+)
    if (sessionCount >= 3) {
      return confidence + 0.15;
    }

    // 2 sessions: moderate bonus
    if (sessionCount === 2) {
      return confidence + 0.08;
    }

    // Single session: no bonus
    return confidence;
  }

  private calculateBaseConfidence(pattern: Pattern): number {
    const frequencyScore = this.calculateFrequencyScore(pattern);
    const timeSpanScore = this.calculateTimeSpanScore(pattern);
    const behaviorScore = this.calculateBehaviorScore(pattern);
    const validationScore = this.calculateValidationScore(pattern);

    return (
      frequencyScore * this.weights.frequency +
      timeSpanScore * this.weights.time_span +
      behaviorScore * this.weights.behavior +
      validationScore * this.weights.validation
    );
  }

  private calculateFrequencyScore(pattern: Pattern): number {
    // Base frequency score
    let baseScore = Math.min(pattern.occurrences.length / 10, 1.0);

    // Same-session bonus: 3+ occurrences in one session
    const uniqueSessions = new Set(pattern.occurrences.map(o => o.session_id));
    if (uniqueSessions.size === 1 && pattern.occurrences.length >= 3) {
      baseScore += 0.1;
    }

    return Math.min(baseScore, 1.0);
  }

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

  private calculateBehaviorScore(pattern: Pattern): number {
    if (pattern.occurrences.length === 0) {
      return 0.0;
    }

    // For preferences, accept is valid
    let validActions: number;
    if (pattern.type === PatternType.PREFERENCE) {
      validActions = pattern.occurrences.filter(
        o => o.user_action === "explicit_correction" || o.user_action === "accept"
      ).length;
    } else {
      validActions = pattern.occurrences.filter(
        o => o.user_action === "explicit_correction"
      ).length;
    }

    return validActions / pattern.occurrences.length;
  }

  private calculateValidationScore(pattern: Pattern): number {
    let score = 0;
    let count = 0;

    for (const occurrence of pattern.occurrences) {
      // Test passed
      if (occurrence.test_passed === true) {
        score += 1.0;
        count += 1;
      }

      // Performance improved
      if (occurrence.performance_improved === true) {
        score += 1.0;
        count += 1;
      }

      // Security issue fixed
      if (occurrence.security_issue) {
        score += 1.0;
        count += 1;
      }
    }

    return count > 0 ? score / count : 0.0;
  }

  private applyTypeAdjustments(pattern: Pattern, baseConfidence: number): number {
    const strategy = PATTERN_STRATEGIES[pattern.type];
    return baseConfidence * strategy.weight_adjustment;
  }

  private applyKeywordBonus(pattern: Pattern, confidence: number): number {
    const strategy = PATTERN_STRATEGIES[pattern.type];
    const keywords = strategy.detect_keywords;

    if (keywords.length === 0) {
      return confidence;
    }

    const foundKeywords: string[] = [];

    // Check description
    const descriptionLower = pattern.description.toLowerCase();
    for (const keyword of keywords) {
      if (descriptionLower.includes(keyword.toLowerCase())) {
        foundKeywords.push(keyword);
      }
    }

    // Check user input in occurrences
    for (const occurrence of pattern.occurrences) {
      if (occurrence.user_input) {
        const inputLower = occurrence.user_input.toLowerCase();
        for (const keyword of keywords) {
          if (inputLower.includes(keyword.toLowerCase()) && !foundKeywords.includes(keyword)) {
            foundKeywords.push(keyword);
          }
        }
      }
    }

    // Apply bonus if keywords found
    if (foundKeywords.length > 0) {
      pattern.keywords = foundKeywords;
      return confidence + 0.2;
    }

    return confidence;
  }
}
