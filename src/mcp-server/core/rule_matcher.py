"""
Rule matching for AutoImprove.

Matches rules to current scene based on scene overlap, confidence, and keywords.
"""

from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

from core.models import Scene
from storage.rule_index import RuleIndexEntry, RuleIndexManager


@dataclass
class RuleMatch:
    """Represents a matched rule with relevance score."""
    rule: RuleIndexEntry
    relevance_score: float
    match_reason: str


class RuleMatcher:
    """Matches rules to scenes."""

    def __init__(
        self,
        index_manager: RuleIndexManager,
        max_results: int = 10,
        min_confidence: float = 0.3
    ):
        """
        Initialize rule matcher.

        Args:
            index_manager: Rule index manager
            max_results: Maximum number of results to return
            min_confidence: Minimum confidence threshold
        """
        self.index_manager = index_manager
        self.max_results = max_results
        self.min_confidence = min_confidence
        self._match_cache: Dict[str, List[RuleMatch]] = {}

    def match_rules(
        self,
        scene: Scene,
        keywords: Optional[List[str]] = None
    ) -> List[RuleMatch]:
        """
        Match rules to a scene.

        Args:
            scene: Current scene
            keywords: Optional keywords to boost relevance

        Returns:
            List of matched rules sorted by relevance
        """
        # Check cache
        cache_key = self._get_cache_key(scene, keywords)
        if cache_key in self._match_cache:
            return self._match_cache[cache_key]

        # Load all rules
        all_rules = self.index_manager.list_rules(min_confidence=self.min_confidence)

        # Calculate relevance for each rule
        matches = []
        for rule in all_rules:
            relevance, reason = self._calculate_relevance(rule, scene, keywords)
            if relevance > 0:
                matches.append(RuleMatch(
                    rule=rule,
                    relevance_score=relevance,
                    match_reason=reason
                ))

        # Sort by priority then relevance
        matches = self._sort_matches(matches)

        # Limit results
        matches = matches[:self.max_results]

        # Cache results
        self._match_cache[cache_key] = matches

        return matches

    def _calculate_relevance(
        self,
        rule: RuleIndexEntry,
        scene: Scene,
        keywords: Optional[List[str]] = None
    ) -> Tuple[float, str]:
        """
        Calculate relevance score for a rule.

        Args:
            rule: Rule to evaluate
            scene: Current scene
            keywords: Optional keywords

        Returns:
            Tuple of (relevance_score, reason)
        """
        score = 0.0
        reasons = []

        # Scene overlap score
        overlap_score, overlap_reason = self._calculate_scene_overlap(rule, scene)
        score += overlap_score
        if overlap_score > 0:
            reasons.append(overlap_reason)

        # Keyword boost
        if keywords and rule.keywords:
            keyword_boost = self._calculate_keyword_boost(rule.keywords, keywords)
            if keyword_boost > 0:
                score += keyword_boost
                reasons.append(f"keyword match (+{keyword_boost:.2f})")

        # Confidence factor
        score *= rule.confidence

        reason = ", ".join(reasons) if reasons else "no match"
        return score, reason

    def _calculate_scene_overlap(
        self,
        rule: RuleIndexEntry,
        scene: Scene
    ) -> Tuple[float, str]:
        """Calculate scene overlap score."""
        if not rule.scenes:
            return 0.5, "no scene specified"  # Neutral score

        rule_scene = Scene.from_dict(rule.scenes)

        # Count matches in each dimension
        tech_matches = len(set(rule_scene.tech) & set(scene.tech))
        functional_matches = len(set(rule_scene.functional) & set(scene.functional))
        business_matches = len(set(rule_scene.business) & set(scene.business))

        # Count total dimensions with content
        rule_dimensions = sum([
            len(rule_scene.tech) > 0,
            len(rule_scene.functional) > 0,
            len(rule_scene.business) > 0
        ])

        if rule_dimensions == 0:
            return 0.5, "no scene specified"

        # Calculate match ratio
        total_matches = tech_matches + functional_matches + business_matches
        match_ratio = total_matches / rule_dimensions

        # Generate reason
        match_parts = []
        if tech_matches > 0:
            match_parts.append(f"tech:{tech_matches}")
        if functional_matches > 0:
            match_parts.append(f"functional:{functional_matches}")
        if business_matches > 0:
            match_parts.append(f"business:{business_matches}")

        reason = f"scene overlap ({', '.join(match_parts)})"

        return match_ratio, reason

    def _calculate_keyword_boost(
        self,
        rule_keywords: List[str],
        context_keywords: List[str]
    ) -> float:
        """Calculate keyword match boost."""
        if not rule_keywords or not context_keywords:
            return 0.0

        # Check for keyword matches (case-insensitive)
        rule_kw_lower = [kw.lower() for kw in rule_keywords]
        context_kw_lower = [kw.lower() for kw in context_keywords]

        matches = len(set(rule_kw_lower) & set(context_kw_lower))

        if matches > 0:
            return 0.2  # Fixed boost for keyword match

        return 0.0

    def _sort_matches(self, matches: List[RuleMatch]) -> List[RuleMatch]:
        """Sort matches by priority then relevance."""
        priority_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}

        return sorted(
            matches,
            key=lambda m: (
                priority_order.get(m.rule.priority, 4),
                -m.relevance_score  # Negative for descending order
            )
        )

    def _get_cache_key(self, scene: Scene, keywords: Optional[List[str]]) -> str:
        """Generate cache key for scene and keywords."""
        scene_str = f"{','.join(sorted(scene.tech))}|{','.join(sorted(scene.functional))}|{','.join(sorted(scene.business))}"
        kw_str = ','.join(sorted(keywords)) if keywords else ''
        return f"{scene_str}#{kw_str}"

    def invalidate_cache(self) -> None:
        """Invalidate match cache."""
        self._match_cache.clear()

    def get_rules_by_priority(self, priority: str) -> List[RuleIndexEntry]:
        """
        Get all rules of a specific priority.

        Args:
            priority: Priority level

        Returns:
            List of rules
        """
        return self.index_manager.list_rules(priority_filter=priority)

    def get_rules_by_type(self, pattern_type: str) -> List[RuleIndexEntry]:
        """
        Get all rules of a specific type.

        Args:
            pattern_type: Pattern type

        Returns:
            List of rules
        """
        return self.index_manager.list_rules(type_filter=pattern_type)
