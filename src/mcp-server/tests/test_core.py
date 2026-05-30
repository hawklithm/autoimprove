"""
Unit tests for core algorithm components.
"""

import pytest
from datetime import datetime, timedelta

from core.models import Pattern, PatternType, PatternOccurrence, Scene
from core.confidence import ConfidenceCalculator
from core.classifier import RuleClassifier
from core.keywords import KeywordDetector
from core.framework import FrameworkRuleDetector
from core.rule_generator import RuleGenerator


class TestConfidenceCalculator:
    """Tests for ConfidenceCalculator."""

    def test_calculate_frequency_score(self):
        """Test frequency score calculation."""
        calc = ConfidenceCalculator()

        # Single occurrence
        pattern = Pattern(
            type=PatternType.PREFERENCE,
            description="Test",
            occurrences=[
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-30T10:00:00Z",
                    user_action="explicit_correction",
                    context="test.py"
                )
            ],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z"
        )

        score = calc._calculate_frequency_score(pattern)
        assert 0.0 <= score <= 1.0
        assert score == 0.1  # 1/10

    def test_same_session_bonus(self):
        """Test same-session bonus for 3+ occurrences."""
        calc = ConfidenceCalculator()

        # 3 occurrences in same session
        pattern = Pattern(
            type=PatternType.REPEATED_CORRECTION,
            description="Test",
            occurrences=[
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-30T10:00:00Z",
                    user_action="explicit_correction",
                    context="test1.py"
                ),
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-30T10:30:00Z",
                    user_action="explicit_correction",
                    context="test2.py"
                ),
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-30T11:00:00Z",
                    user_action="explicit_correction",
                    context="test3.py"
                )
            ],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T11:00:00Z"
        )

        score = calc._calculate_frequency_score(pattern)
        assert score == 0.4  # 0.3 (3/10) + 0.1 (bonus)

    def test_behavior_score_preference(self):
        """Test behavior score for preference patterns."""
        calc = ConfidenceCalculator()

        pattern = Pattern(
            type=PatternType.PREFERENCE,
            description="Test",
            occurrences=[
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-30T10:00:00Z",
                    user_action="accept",  # Valid for preferences
                    context="test.py"
                )
            ],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z"
        )

        score = calc._calculate_behavior_score(pattern)
        assert score == 1.0  # 1/1 valid actions

    def test_validation_score(self):
        """Test validation score calculation."""
        calc = ConfidenceCalculator()

        pattern = Pattern(
            type=PatternType.ANTI_PATTERN,
            description="Test",
            occurrences=[
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-30T10:00:00Z",
                    user_action="explicit_correction",
                    context="test.py",
                    test_passed=True
                )
            ],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z"
        )

        score = calc._calculate_validation_score(pattern)
        assert score == 1.0

    def test_full_confidence_calculation(self):
        """Test full confidence calculation."""
        calc = ConfidenceCalculator()

        pattern = Pattern(
            type=PatternType.REPEATED_CORRECTION,
            description="Use refreshToken() helper",
            occurrences=[
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-01T10:00:00Z",
                    user_action="explicit_correction",
                    context="auth.py",
                    test_passed=True
                ),
                PatternOccurrence(
                    session_id="s2",
                    timestamp="2026-05-15T10:00:00Z",
                    user_action="explicit_correction",
                    context="login.py",
                    test_passed=True
                )
            ],
            first_seen="2026-05-01T10:00:00Z",
            last_seen="2026-05-15T10:00:00Z"
        )

        confidence = calc.calculate_confidence(pattern)
        assert 0.0 <= confidence <= 1.0
        assert confidence > 0.5  # Should be reasonably high


class TestRuleClassifier:
    """Tests for RuleClassifier."""

    def test_should_generate_repeated_correction(self):
        """Test rule generation for repeated correction."""
        classifier = RuleClassifier()

        # Valid pattern (2+ occurrences, cross-session)
        pattern = Pattern(
            type=PatternType.REPEATED_CORRECTION,
            description="Test",
            occurrences=[
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-01T10:00:00Z",
                    user_action="explicit_correction",
                    context="test1.py"
                ),
                PatternOccurrence(
                    session_id="s2",
                    timestamp="2026-05-15T10:00:00Z",
                    user_action="explicit_correction",
                    context="test2.py"
                )
            ],
            first_seen="2026-05-01T10:00:00Z",
            last_seen="2026-05-15T10:00:00Z",
            confidence=0.6
        )

        should_generate, reason = classifier.should_generate_rule(pattern)
        assert should_generate
        assert "满足" in reason

    def test_should_not_generate_low_confidence(self):
        """Test rejection for low confidence."""
        classifier = RuleClassifier()

        pattern = Pattern(
            type=PatternType.REPEATED_CORRECTION,
            description="Test",
            occurrences=[
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-30T10:00:00Z",
                    user_action="explicit_correction",
                    context="test.py"
                )
            ],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z",
            confidence=0.2  # Too low
        )

        should_generate, reason = classifier.should_generate_rule(pattern)
        assert not should_generate
        assert "置信度不足" in reason

    def test_determine_priority_security(self):
        """Test priority determination for security patterns."""
        classifier = RuleClassifier()

        pattern = Pattern(
            type=PatternType.SECURITY,
            description="Prevent SQL injection",
            occurrences=[],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z",
            confidence=0.5
        )

        priority = classifier.determine_priority(pattern)
        assert priority == 'critical'

    def test_determine_priority_high_confidence_boost(self):
        """Test priority boost for high confidence."""
        classifier = RuleClassifier()

        pattern = Pattern(
            type=PatternType.PREFERENCE,
            description="Use const",
            occurrences=[],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z",
            confidence=0.95  # Very high
        )

        priority = classifier.determine_priority(pattern)
        assert priority == 'medium'  # Boosted from 'low'


class TestKeywordDetector:
    """Tests for KeywordDetector."""

    def test_detect_preference_keywords(self):
        """Test preference keyword detection."""
        detector = KeywordDetector()

        pattern = Pattern(
            type=PatternType.PREFERENCE,
            description="我们团队使用 const",
            occurrences=[],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z"
        )

        keywords = detector.detect_keywords(pattern)
        assert len(keywords) > 0
        assert any('团队' in kw for kw in keywords)

    def test_detect_performance_keywords(self):
        """Test performance keyword detection."""
        detector = KeywordDetector()

        pattern = Pattern(
            type=PatternType.PERFORMANCE,
            description="Use useMemo to optimize",
            occurrences=[],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z"
        )

        keywords = detector.detect_keywords(pattern)
        assert 'useMemo' in keywords

    def test_detect_keywords_in_user_input(self):
        """Test keyword detection in user input."""
        detector = KeywordDetector()

        pattern = Pattern(
            type=PatternType.SECURITY,
            description="Validate input",
            occurrences=[
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-30T10:00:00Z",
                    user_action="explicit_correction",
                    context="test.py",
                    user_input="防止 SQL injection"
                )
            ],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z"
        )

        keywords = detector.detect_keywords(pattern)
        assert any('injection' in kw.lower() for kw in keywords)


class TestFrameworkRuleDetector:
    """Tests for FrameworkRuleDetector."""

    def test_detect_react_rule(self):
        """Test React framework rule detection."""
        detector = FrameworkRuleDetector()

        pattern = Pattern(
            type=PatternType.ANTI_PATTERN,
            description="Don't call hooks in loops",
            occurrences=[],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z"
        )

        assert detector.is_framework_rule(pattern)

    def test_detect_vue_rule(self):
        """Test Vue framework rule detection."""
        detector = FrameworkRuleDetector()

        pattern = Pattern(
            type=PatternType.ANTI_PATTERN,
            description="Use reactive() for objects",
            occurrences=[],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z"
        )

        assert detector.is_framework_rule(pattern)

    def test_detect_framework(self):
        """Test framework detection."""
        detector = FrameworkRuleDetector()

        pattern = Pattern(
            type=PatternType.ANTI_PATTERN,
            description="useEffect cleanup required",
            occurrences=[],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z"
        )

        frameworks = detector.detect_framework(pattern)
        assert 'react' in frameworks


class TestRuleGenerator:
    """Tests for RuleGenerator."""

    def test_generate_rule(self):
        """Test rule generation from pattern."""
        generator = RuleGenerator()

        pattern = Pattern(
            type=PatternType.PREFERENCE,
            description="Use const instead of let",
            occurrences=[
                PatternOccurrence(
                    session_id="s1",
                    timestamp="2026-05-30T10:00:00Z",
                    user_action="accept",
                    context="src/utils.ts"
                )
            ],
            first_seen="2026-05-30T10:00:00Z",
            last_seen="2026-05-30T10:00:00Z",
            confidence=0.5,
            keywords=["convention"]
        )

        scene = Scene(tech=["typescript"], functional=["utils"])

        index_entry, content = generator.generate_rule(pattern, "rule-001", scene)

        assert index_entry.id == "rule-001"
        assert index_entry.type == "preference"
        assert index_entry.confidence == 0.5
        assert content.id == "rule-001"
        assert "const" in content.content

    def test_batch_generate_rules(self):
        """Test batch rule generation."""
        generator = RuleGenerator()

        patterns = [
            Pattern(
                type=PatternType.PREFERENCE,
                description="Use const",
                occurrences=[
                    PatternOccurrence(
                        session_id="s1",
                        timestamp="2026-05-30T10:00:00Z",
                        user_action="accept",
                        context="test.ts"
                    )
                ],
                first_seen="2026-05-30T10:00:00Z",
                last_seen="2026-05-30T10:00:00Z",
                confidence=0.5
            ),
            Pattern(
                type=PatternType.SECURITY,
                description="Validate input",
                occurrences=[
                    PatternOccurrence(
                        session_id="s1",
                        timestamp="2026-05-30T10:00:00Z",
                        user_action="explicit_correction",
                        context="api.ts",
                        security_issue="input-validation"
                    )
                ],
                first_seen="2026-05-30T10:00:00Z",
                last_seen="2026-05-30T10:00:00Z",
                confidence=0.8
            )
        ]

        rules = generator.batch_generate_rules(patterns)
        assert len(rules) == 2
        assert rules[0][0].id == "rule-001"
        assert rules[1][0].id == "rule-002"
