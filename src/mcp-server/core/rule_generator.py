"""
Rule generation from patterns.

Converts validated patterns into structured rules.
"""

from datetime import datetime
from typing import Optional
from core.models import Pattern, Scene
from core.classifier import RuleClassifier
from storage.rule_index import RuleIndexEntry
from storage.rule_content import RuleContent


class RuleGenerator:
    """Generates rules from patterns."""

    def __init__(self):
        """Initialize rule generator."""
        self.classifier = RuleClassifier()

    def generate_rule(
        self,
        pattern: Pattern,
        rule_id: str,
        scene: Optional[Scene] = None
    ) -> tuple[RuleIndexEntry, RuleContent]:
        """
        Generate a rule from a pattern.

        Args:
            pattern: Pattern to convert
            rule_id: ID for the new rule
            scene: Optional scene context

        Returns:
            Tuple of (RuleIndexEntry, RuleContent)
        """
        # Determine priority
        priority = self.classifier.determine_priority(pattern)

        # Generate rule content
        content = self._generate_content(pattern)
        reason = self._generate_reason(pattern)

        # Create timestamp
        now = datetime.utcnow().isoformat() + 'Z'

        # Create index entry
        index_entry = RuleIndexEntry(
            id=rule_id,
            type=pattern.type.value,
            priority=priority,
            confidence=pattern.confidence,
            scenes=scene.to_dict() if scene else {},
            keywords=pattern.keywords,
            created_at=now,
            updated_at=now
        )

        # Create content
        rule_content = RuleContent(
            id=rule_id,
            content=content,
            reason=reason,
            metadata={
                "type": pattern.type.value,
                "priority": priority,
                "confidence": pattern.confidence,
                "source": "learned",
                "pattern_occurrencn(pattern.occurrences),
                "first_seen": pattern.first_seen,
                "last_seen": pattern.last_seen,
                "keywords": pattern.keywords
            }
        )

        return index_entry, rule_content

    def _generate_content(self, pattern: Pattern) -> str:
        """
        Generate rule content from pattern description.

        Converts pattern description into actionable rule content.

        Args:
            pattern: Pattern to generate content from

        Returns:
            Rule content string
        """
        # Pattern description already in rule format
        # Just ensure it's actionable (starts with verb or imperative)
        content = pattern.description

        # Add context if available from occurrences
        contexts = set()
        for occurrence in pattern.occurrences:
            if occurrence.context:
                # Extract file or module name
                if '/' in occurrence.context:
                    parts = occurrence.context.split('/')
                    if len(parts) > 1:
                        contexts.add(parts[-1])

        if contexts:
            context_str = ", ".join(sorted(contexts)[:3])
            content += f"\n\n**Applies to**: {context_str}"

        return content

    def _generate_reason(self, pattern: Pattern) -> str:
        """
        Generate reason explaining why this rule exists.

        Args:
            pattern: Pattern to generate reason from

        Returns:
            Reason string
        """
        reasons = []

        # Count occurrences
        occurrence_count = len(pattern.occurrences)
        unique_sessions = len(set(o.session_id for o in pattern.occurrences))

        if unique_sessions > 1:
            reasons.append(f"Corrected {occurrence_count} times across {unique_sessions} sessions")
        else:
            reasons.append(f"Corrected {occurrence_count} times in one session")

        # Add validation evidence
        test_passed = sum(1 for o in pattern.occurrences if o.test_passed is True)
        if test_passed > 0:
            reasons.append(f"validated by {test_passed} test(s)")

        perf_improved = sum(1 for o in pattern.occurrences if o.performance_improved is True)
        if perf_improved > 0:
            reasons.append("improved performance")

        security_issues = sum(1 for o in pattern.occurrences if o.security_issue)
        if security_issues > 0:
            reasons.append(f"fixed {security_issues} security issue(s)")

        # Add user preference indication
        if pattern.keywords:
            keyword_str = ", ".join(pattern.keywords[:3])
            reasons.append(f"keywords: {keyword_str}")

        return ". ".join(reasons).capitalize() + "."

    def can_generate_rule(self, pattern: Pattern) -> tuple[bool, str]:
        """
        Check if pattern can generate a rule.

        Args:
            pattern: Pattern to check

        Returns:
            Tuple of (can_generate, reason)
        """
        return self.classifier.should_generate_rule(pattern)

    def batch_generate_rules(
        self,
        patterns: list[Pattern],
        start_id: int = 1,
        scene: Optional[Scene] = None
    ) -> list[tuple[RuleIndexEntry, RuleContent]]:
        """
        Generate rules from multiple patterns.

        Args:
            patterns: List of patterns to convert
            start_id: Starting rule ID number
            scene: Optional scene context

        Returns:
            List of (RuleIndexEntry, RuleContent) tuples
        """
        rules = []
        current_id = start_id

        for pattern in patterns:
            can_generate, reason = self.can_generate_rule(pattern)

            if can_generate:
                rule_id = f"rule-{current_id:03d}"
                index_entry, content = self.generate_rule(pattern, rule_id, scene)
                rules.append((index_entry, content))
                current_id += 1

        return rules
