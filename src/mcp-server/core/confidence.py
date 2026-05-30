"""
Confidence calculation for AutoImprove patterns.

Implements v2.0 confidence formula with weighted components.
Ported from prototype/session_analyzer.py.
"""

from datetime import datetime
from typing import Dict
from core.models import Pattern, PatternType


# Pattern-specific strategies (imported from config at runtime)
PATTERN_STRATEGIES = {
    PatternType.REPEATED_CORRECTION: {
        'min_confidence': 0.45,
        'min_occurrences': 2,
        'requires_multiple_sessions': True,
        'weight_adjustment': 1.0,
        'detect_keywords': [],
    },
    PatternType.ANTI_PATTERN: {
        'min_confidence': 0.45,
        'min_occurrences': 1,
        'requires_test_validation': True,
        'weight_adjustment': 1.0,
        'detect_keywords': [],
    },
    PatternType.PREFERENCE: {
        'min_confidence': 0.3,
        'min_occurrences': 1,
        'requires_multiple_sessions': False,
        'weight_adjustment': 1.0,
        'detect_keywords': [
            '我们团队', '团队习惯', '我更喜欢', '我们约定',
            'we prefer', 'our team', 'we use', 'convention'
        ],
    },
    PatternType.PERFORMANCE: {
        'min_confidence': 0.4,
        'min_occurrences': 1,
        'requires_performance_evidence': True,
        'weight_adjustment': 1.0,
        'detect_keywords': [
            'useMemo', 'useCallback', 'React.memo',
            '重渲染', '性能', 'optimize', 'performance',
            'slow', 'lag', '卡顿'
        ],
    },
    PatternType.SECURITY: {
        'min_confidence': 0.3,
        'min_occurrences': 1,
        'requires_multiple_sessions': False,
        'weight_adjustment': 1.5,
        'priority': 'critical',
        'detect_keywords': [
            'sql injection', 'xss', 'csrf', 'injection',
            '注入', '安全', 'security', 'vulnerability',
            'sanitize', 'escape', 'validate', 'attack'
        ],
    },
}


class ConfidenceCalculator:
    """Calculates confidence scores for patterns."""

    def __init__(self, weights: Dict[str, float] = None):
        """
        Initialize confidence calculator.

        Args:
            weights: Optional custom weights for confidence components.
                    Default: frequency=0.3, time_span=0.1, behavior=0.4, validation=0.2
        """
        self.weights = weights or {
            'frequency': 0.3,
            'time_span': 0.1,
         'behavior': 0.4,
            'validation': 0.2
        }

    def calculate_confidence(self, pattern: Pattern) -> float:
        """
        Calculate pattern confidence (v2.0 formula).

        Args:
            pattern: Pattern to calculate confidence for

        Returns:
            Confidence score between 0.0 and 1.0
        """
        # Step 1: Calculate base confidence
        base_confidence = self._calculate_base_confidence(pattern)

        # Step 2: Apply type-specific adjustments
        adjusted_confidence = self._apply_type_adjustments(pattern, base_confidence)

        # Step 3: Apply keyword bonus
        final_confidence = self._apply_keyword_bonus(pattern, adjusted_confidence)

        return min(final_confidence, 1.0)

    def _calculate_base_confidence(self, pattern: Pattern) -> float:
        """Calculate base confidence from weighted components."""
        frequency_score = self._calculate_frequency_score(pattern)
        time_span_score = self._calculate_time_span_score(pattern)
        behavior_score = self._calculate_behavior_score(pattern)
        validation_score = self._calculate_validation_score(pattern)

        confidence = (
            frequency_score * self.weights['frequency'] +
            time_span_score * self.weights['time_span'] +
            behavior_score * self.weights['behavior'] +
            validation_score * self.weights['validation']
        )

        return confidence

    def _calculate_frequency_score(self, pattern: Pattern) -> float:
        """
        Calculate frequency score with same-session bonus.

        Returns:
            Score between 0.0 and 1.0
        """
        # Base frequency score
        base_score = min(len(pattern.occurrences) / 10, 1.0)

        # Same-session bonus: 3+ occurrences in one session
        unique_sessions = set(o.session_id for o in pattern.occurrences)
        if len(unique_sessions) == 1 and len(pattern.occurrences) >= 3:
            base_score += 0.1

        return min(base_score, 1.0)

    def _calculate_time_span_score(self, pattern: Pattern) -> float:
        """
        Calculate time span score.

        Returns:
            Score between 0.0 and 1.0 (normalized to 90 days)
        """
        try:
            first = datetime.fromisoformat(pattern.first_seen.replace('Z', '+00:00'))
            last = datetime.fromisoformat(pattern.last_seen.replace('Z', '+00:00'))
            days = (last - first).days
            return min(days / 90, 1.0)
        except (ValueError, AttributeError):
            return 0.0

    def _calculate_behavior_score(self, pattern: Pattern) -> float:
        """
        Calculate user behavior score.

        For preferences, 'accept' counts as valid action.
        For others, only 'explicit_correction' counts.

        Returns:
            Score between 0.0 and 1.0
        """
        if len(pattern.occurrences) == 0:
            return 0.0

        # For preferences, accept is valid
        if pattern.type == PatternType.PREFERENCE:
            valid_actions = sum(
                1 for o in pattern.occurrences
                if o.user_action in ['explicit_correction', 'accept']
            )
        else:
            valid_actions = sum(
                1 for o in pattern.occurrences
                if o.user_action == 'explicit_correction'
            )

        return valid_actions / len(pattern.occurrences)

    def _calculate_validation_score(self, pattern: Pattern) -> float:
        """
        Calculate validation score from test results, performance, and security.

        Retur         Score between 0.0 and 1.0
        """
        score = 0
        count = 0

        for occurrence in pattern.occurrences:
            # Test passed
            if occurrence.test_passed is True:
                score += 1.0
                count += 1

            # Performance improved
            if occurrence.performance_improved is True:
                score += 1.0
                count += 1

            # Security issue fixed
            if occurrence.security_issue:
                score += 1.0
                count += 1

        return score / count if count > 0 else 0.0

    def _apply_type_adjustments(self, pattern: Pattern, base_confidence: float) -> float:
        """Apply type-specific weight adjustments."""
        strategy = PATTERN_STRATEGIES[pattern.type]
        return base_confidence * strategy['weight_adjustment']

    def _apply_keyword_bonus(self, pattern: Pattern, confidence: float) -> float:
        """
        Apply keyword bonus if relevant keywords found.

        Adds 0.2 to confidence if keywords detected.

        Args:
            pattern: Pattern to check (will be modified to add keywords)
            confidence: Current confidence score

        Returns:
            Adjusted confidence score
        """
        strategy = PATTERN_STRATEGIES[pattern.type]
        keywords = strategy.get('detect_keywords', [])

        if not keywords:
            return confidence

        found_keywords = []

        # Check description
        for keyword in keywords:
            if keyword.lower() in pattern.description.lower():
                found_keywords.append(keyword)

        # Check user input in occurrences
        for occurrence in pattern.occurrences:
            if occurrence.user_input:
                for keyword in keywords:
                    if keyword.lower() in occurrence.user_input.lower():
                        if keyword not in found_keywords:
                            found_keywords.append(keyword)

        # Apply bonus if keywords found
        if found_keywords:
            pattern.keywords = found_keywords
            return confidence + 0.2

        return confidence
