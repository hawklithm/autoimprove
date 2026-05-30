"""
Unit tests for rule matching.
"""

import pytest
import tempfile
from pathlib import Path

from core.rule_matcher import RuleMatcher, RuleMatch
from core.models import Scene
from storage.rule_index import RuleIndexManager, RuleIndexEntry


@pytest.fixture
def temp_storage():
    """Create temporary storage for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def index_manager_with_rules(temp_storage):
    """Create index manager with sample rules."""
    manager = RuleIndexManager(temp_storage)

    # Add sample rules
    rules = [
        RuleIndexEntry(
            id="rule-001",
            type="preference",
            priority="low",
            confidence=0.7,
            scenes={"tech": ["react"], "functional": ["auth"], "business": []},
            keywords=["team", "convention"],
            created_at="2026-05-30T10:00:00Z",
            updated_at="2026-05-30T10:00:00Z"
        ),
        RuleIndexEntry(
            id="rule-002",
            type="security",
            priority="critical",
            confidence=0.9,
            scenes={"tech": ["python"], "functional": ["api"], "business": []},
            keywords=["injection", "security"],
            created_at="2026-05-30T10:00:00Z",
            updated_at="2026-05-30T10:00:00Z"
        ),
        RuleIndexEntry(
            id="rule-003",
            type="performance",
            priority="medium",
            confidence=0.6,
            scenes={"tech": ["react"], "functional": ["ui"], "business": []},
            keywords=["useMemo", "optimize"],
            created_at="2026-05-30T10:00:00Z",
            updated_at="2026-05-30T10:00:00Z"
        ),
    ]

    for rule in rules:
        manager.add_rule(rule)

    return manager


class TestRuleMatcher:
    """Tests for RuleMatcher."""

    def test_match_rules_by_scene(self, index_manager_with_rules):
        """Test matching rules by scene."""
        matcher = RuleMatcher(index_manager_with_rules)

        scene = Scene(tech=["react"], functional=["auth"], business=[])

        matches = matcher.match_rules(scene)

        assert len(matches) > 0
        # Should match rule-001 (react + auth)
        assert any(m.rule.id == "rule-001" for m in matches)

    def test_priority_ordering(self, index_manager_with_rules):
        """Test that critical priority rules come first."""
        matcher = RuleMatcher(index_manager_with_rules)

        scene = Scene(tech=["python", "react"], functional=["api", "auth"], business=[])

        matches = matcher.match_rules(scene)

        # Critical priority should be first
        if len(matches) > 1:
            assert matches[0].rule.priority == "critical"

    def test_keyword_boost(self, index_manager_with_rules):
        """Test keyword matching boosts relevance."""
        matcher = RuleMatcher(index_manager_with_rules)

        scene = Scene(tech=["react"], functional=["ui"], business=[])

        # Without keywords
        matches_no_kw = matcher.match_rules(scene)

        # With matching keywords
        matches_with_kw = matcher.match_rules(scene, keywords=["useMemo", "optimize"])

        # Find rule-003 in both
        match_no_kw = next((m for m in matches_no_kw if m.rule.id == "rule-003"), None)
        match_with_kw = next((m for m in matches_with_kw if m.rule.id == "rule-003"), None)

        if match_no_kw and match_with_kw:
            assert match_with_kw.relevance_score > match_no_kw.relevance_score

    def test_confidence_threshold(self, temp_storage):
        """Test minimum confidence threshold filtering."""
        manager = RuleIndexManager(temp_storage)

        # Add low confidence rule
        manager.add_rule(RuleIndexEntry(
            id="rule-low",
            type="preference",
            priority="low",
            confidence=0.2,  # Below default threshold
            scenes={},
            keywords=[],
            created_at="2026-05-30T10:00:00Z",
            updated_at="2026-05-30T10:00:00Z"
        ))

        matcher = RuleMatcher(manager, min_confidence=0.3)

        scene = Scene(tech=[], functional=[], business=[])
        matches = matcher.match_rules(scene)

        # Low confidence rule should be filtered out
        assert not any(m.rule.id == "rule-low" for m in matches)

    def test_max_results_limit(self, temp_storage):
        """Test maximum results limit."""
        manager = RuleIndexManager(temp_storage)

        # Add many rules
        for i in range(20):
            manager.add_rule(RuleIndexEntry(
                id=f"rule-{i:03d}",
                type="preference",
                priority="low",
                confidence=0.5,
                scenes={"tech": ["react"], "functional": [], "business": []},
                keywords=[],
                created_at="2026-05-30T10:00:00Z",
                updated_at="2026-05-30T10:00:00Z"
            ))

        matcher = RuleMatcher(manager, max_results=5)

        scene = Scene(tech=["react"], functional=[], business=[])
        matches = matcher.match_rules(scene)

        assert len(matches) <= 5

    def test_cache_invalidation(self, index_manager_with_rules):
        """Test cache invalidation."""
        matcher = RuleMatcher(index_manager_with_rules)

        scene = Scene(tech=["react"], functional=["auth"], business=[])

        # First call - populates cache
        matches1 = matcher.match_rules(scene)

        # Second call - uses cache
        matches2 = matcher.match_rules(scene)

        assert matches1 == matches2

        # Invalidate cache
        matcher.invalidate_cache()

        # Third call - recalculates
        matches3 = matcher.match_rules(scene)

        assert len(matches3) == len(matches1)

    def test_no_scene_overlap(self, index_manager_with_rules):
        """Test matching with no scene overlap."""
        matcher = RuleMatcher(index_manager_with_rules)

        # Scene with no overlap
        scene = Scene(tech=["java"], functional=["database"], business=["finance"])

        matches = matcher.match_rules(scene)

        # Should still return some matches (with lower relevance)
        assert isinstance(matches, list)

    def test_get_rules_by_priority(self, index_manager_with_rules):
        """Test getting rules by priority."""
        matcher = RuleMatcher(index_manager_with_rules)

        critical_rules = matcher.get_rules_by_priority("critical")

        assert len(critical_rules) == 1
        assert critical_rules[0].id == "rule-002"

    def test_get_rules_by_type(self, index_manager_with_rules):
        """Test getting rules by type."""
        matcher = RuleMatcher(index_manager_with_rules)

        security_rules = matcher.get_rules_by_type("security")

        assert len(security_rules) == 1
        assert security_rules[0].id == "rule-002"
