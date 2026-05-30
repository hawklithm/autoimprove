"""
Keyword detection for AutoImprove patterns.

Detects relevant keywords in pattern descriptions and user input.
"""

from typing import List, Set
from core.models import Pattern, PatternType


# Keyword lists by pattern type
PREFERENCE_KEYWORDS = [
    '我们团队', '团队习惯', '我更喜欢', '我们约定',
    'we prefer', 'our team', 'we use', 'convention',
    '约定', '规范', 'standard', 'guideline'
]

PERFORMANCE_KEYWORDS = [
    'useMemo', 'useCallback', 'React.memo',
    '重渲染', '性能', 'optimize', 'performance',
    'slow', 'lag', '卡顿', '优化', 'cache',
    'memoize', 'debounce', 'throttle'
]

SECURITY_KEYWORDS = [
    'sql injection', 'xss', 'csrf', 'injection',
    '注入', '安全', 'security', 'vulnerability',
    'sanitize', 'escape', 'validate', 'attack',
    'exploit', '漏洞', 'breach', 'unauthorized'
]


class KeywordDetector:
    """Detects keywords in patterns."""

    def __init__(self):
        """Initialize keyword detector with default keyword lists."""
        self.keyword_lists = {
            PatternType.PREFERENCE: PREFERENCE_KEYWORDS,
            PatternType.PERFORMANCE: PERFORMANCE_KEYWORDS,
            PatternType.SECURITY: SECURITY_KEYWORDS,
            PatternType.REPEATED_CORRECTION: [],
            PatternType.ANTI_PATTERN: []
        }

    def detect_keywords(self, pattern: Pattern) -> List[str]:
        """
        Detect keywords in pattern description and user input.

        Args:
            pattern: Pattern to analyze

        Returns:
            List of detected keywords
        """
        keywords = self.keyword_lists.get(pattern.type, [])

        if not keywords:
            return []

        found_keywords: Set[str] = set()

        # Check description
        description_lower = pattern.description.lower()
        for keyword in keywords:
            if keyword.lower() in description_lower:
                found_keywords.add(keyword)

        # Check user input in occurrences
        for occurrence in pattern.occurrences:
            if occurrence.user_input:
                input_lower = occurrence.user_input.lower()
                for keyword in keywords:
                    if keyword.lower() in input_lower:
                        found_keywords.add(keyword)

        return list(found_keywords)

    def has_keywords(self, pattern: Pattern) -> bool:
        """
        Check if pattern has any relevant keywords.

        Args:
            pattern: Pattern to check

        Returns:
            True if keywords found, False otherwise
        """
        return len(self.detect_keywords(pattern)) > 0

    def add_keywords(self, pattern_type: PatternType, keywords: List[str]) -> None:
        """
        Add custom keywords for a pattern type.

        Args:
            pattern_type: Type of pattern
            keywords: List of keywords to add
        """
        if pattern_type not in self.keyword_lists:
            self.keyword_lists[pattern_type] = []

        self.keyword_lists[pattern_type].extend(keywords)

    def get_keywords_for_type(self, pattern_type: PatternType) -> List[str]:
        """
        Get keyword list for a pattern type.

        Args:
            pattern_type: Type of pattern

        Returns:
            List of keywords
        """
        return self.keyword_lists.get(pattern_type, [])
