/**
 * Classification strategies for pattern types.
 *
 * Determines whether patterns should generate rules based on type-specific criteria.
 */

import { Pattern, PatternType, Priority, isFrameworkRule } from "./models.js";
import { PATTERN_STRATEGIES } from "./confidence.js";

export class RuleClassifier {
  shouldGenerateRule(pattern: Pattern): { shouldGenerate: boolean; reason: string } {
    const strategy = PATTERN_STRATEGIES[pattern.type];

    // Framework rule special case (checked before confidence)
    if (pattern.type === PatternType.ANTI_PATTERN) {
      if (isFrameworkRule(pattern)) {
        // Framework rules have lower threshold and don't need test validation
        if (pattern.confidence >= 0.3) {
          return { shouldGenerate: true, reason: "框架特定规则" };
        }
      }
    }

    // Check confidence threshold
    if (pattern.confidence < strategy.min_confidence) {
      return {
        shouldGenerate: false,
        reason: `置信度不足 (${pattern.confidence.toFixed(2)} < ${strategy.min_confidence})`
      };
    }

    // Check minimum occurrences
    if (pattern.occurrences.length < strategy.min_occurrences) {
      return {
        shouldGenerate: false,
        reason: `出现次数不足 (${pattern.occurrences.length} < ${strategy.min_occurrences})`
      };
    }

    // Check if requires multiple sessions
    if (strategy.requires_multiple_sessions) {
      const uniqueSessions = new Set(pattern.occurrences.map(o => o.session_id));
      if (uniqueSessions.size < 2) {
        return {
          shouldGenerate: false,
          reason: `需要跨会话出现 (当前只有 ${uniqueSessions.size} 个会话)`
        };
      }
    }

    // Check if requires test validation
    if (strategy.requires_test_validation) {
      const hasTest = pattern.occurrences.some(o => o.test_passed === true);
      if (!hasTest) {
        return { shouldGenerate: false, reason: "需要测试验证" };
      }
    }

    // Check if requires performance evidence
    if (strategy.requires_performance_evidence) {
      const hasPerf = pattern.occurrences.some(o => o.performance_improved === true);
      if (!hasPerf) {
        return { shouldGenerate: false, reason: "需要性能改善证据" };
      }
    }

    return { shouldGenerate: true, reason: "满足所有条件" };
  }

  determinePriority(pattern: Pattern): Priority {
    // Security always critical
    if (pattern.type === PatternType.SECURITY) {
      return Priority.CRITICAL;
    }

    // Base priority by type
    const basePriorityMap: Record<PatternType, Priority> = {
      [PatternType.ANTI_PATTERN]: Priority.HIGH,
      [PatternType.PERFORMANCE]: Priority.MEDIUM,
      [PatternType.REPEATED_CORRECTION]: Priority.MEDIUM,
      [PatternType.PREFERENCE]: Priority.LOW,
      [PatternType.SECURITY]: Priority.CRITICAL
    };

    let basePriority = basePriorityMap[pattern.type] || Priority.MEDIUM;

    // High confidence boosts priority by one level
    if (pattern.confidence >= 0.9) {
      if (basePriority === Priority.MEDIUM) {
        return Priority.HIGH;
      }
      if (basePriority === Priority.LOW) {
        return Priority.MEDIUM;
      }
    }

    return basePriority;
  }

  getStrategy(patternType: PatternType) {
    return PATTERN_STRATEGIES[patternType];
  }
}
