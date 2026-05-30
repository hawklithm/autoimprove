"""
Classification strategies for pattern types.

Determines whether patterns should generate rules based on type-specific criteria.
Ported from prototype/session_analyzer.py.
"""

from typing import Tuple
from core.models import Pattern, PatternType, is_framework_rule
from core.confidence import PATTERN_STRATEGIES


class RuleClassifier:
    """Classifies patterns and determines if they should generate rules."""

    def should_generate_rule(self, pattern: Pattern) -> Tuple[bool, str]:
        """
        Determine if pattern should generate a rule.

        Args:
            pattern: Pattern to evaluate

        Returns:
            Tuple of (should_generate, reason)
        """
        strategy = PATTERN_STRATEGIES[pattern.type]

        # Framework rule special case (checked before confidence)
        if pattern.type == PatternType.ANTI_PATTERN:
            if is_framework_rule(pattern):
                # Framework rules have lower threshold and don't need test validation
                if pattern.confidence >= 0.3:
                    return True, "框架特定规则"

        # Check confidence threshold
        if pattern.confidence < strategy['min_confidence']:
            return False, f"置信度不足 ({pattern.confidence:.2f} < {strategy['min_confidence']})"

        # Check minimum occurrences
        if len(pattern.occurrences) < strategy['min_occurrences']:
            return False, f"出现次数不足 ({len(pattern.occurrences)} < {strategy['min_occurrences']})"

        # Check if requires multiple sessions
        if strategy.get('requires_multiple_sessions', False):
            unique_sessions = set(o.session_id for o in pattern.occurrences)
            if len(unique_sessions) < 2:
                return False, f"需要跨会话出现 (当前只有 {len(unique_sessions)} 个会话)"

        # Check if requires test validation
        if strategy.get('requires_test_validation', False):
            has_test = any(o.test_passed is True for o in pattern.occurrences)
            if not has_test:
                return False, "需要测试验证"

        # Check if requires performance evidence
        if strategy.get('requires_performance_evidence', False):
            has_perf = any(o.performance_improved is True for o in pattern.occurrences)
            if not has_perf:
                return False, "需要性能改善证据"

        return True, "满足所有条件"

    def determine_priority(self, pattern: Pattern) -> str:
        """
        Determine rule priority based on pattern type and confidence.

        Args:
            pattern: Pattern to evaluate

        Returns:
            Priority level: 'critical', 'high', 'medium', or 'low'
        """
        # Security always critical
        if pattern.type == PatternType.SECURITY:
            return 'critical'

        # Base priority by type
        base_priority = {
            PatternType.ANTI_PATTERN: 'high',
            PatternType.PERFORMANCE: 'medium',
            PatternType.REPEATED_CORRECTION: 'medium',
            PatternType.PREFERENCE: 'low',
        }.get(pattern.type, 'medium')

        # High confidence boosts priority by one level
        if pattern.confidence >= 0.9:
            if base_priority == 'medium':
                return 'high'
            if base_priority == 'low':
                return 'medium'

        return base_priority

    def get_strategy(self, pattern_type: PatternType) -> dict:
        """
        Get classification strategy for a pattern type.

        Args:
            pattern_type: Type of pattern

        Returns:
            Strategy dictionary
        """
        return PATTERN_STRATEGIES[pattern_type]
