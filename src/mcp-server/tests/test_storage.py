"""
Unit tests for storage layer components.
"""

import pytest
import json
import tempfile
from pathlib import Path
from datetime import datetime

from storage.rule_index import RuleIndexManager, RuleIndexEntry, RuleIndex
from storage.rule_content import RuleContentManager, RuleContent
from storage.session_archive import SessionArchiveManager, SessionArchive
from storage.atomic_ops import atomic_write_json, atomic_write_text, atomic_update_json
from storage.migration import StorageMigrationManager


@pytest.fixture
def temp_storage():
    """Create temporary storage directory for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


class TestRuleIndexManager:
    """Tests for RuleIndexManager."""

    def test_load_empty_index(self, temp_storage):
        """Test loading non-existent index returns empty."""
        manager = RuleIndexManager(temp_storage)
        index = manager.load_index()
        assert index.version == "1.0"
        assert len(index.rules) == 0

    def test_save_and_load_index(self, temp_storage):
        """Test saving and loading index."""
        manager = RuleIndexManager(temp_storage)

        entry = RuleIndexEntry(
            id="rule-001",
            type="repeated-correction",
            priority="high",
            confidence=0.75,
            scenes={"tech": ["react"], "functional": ["auth"]},
            keywords=["token", "refresh"],
            created_at="2026-05-30T10:00:00Z",
            updated_at="2026-05-30T10:00:00Z"
        )

        manager.add_rule(entry)

        # Load and verify
        index = manager.load_index()
        assert len(index.rules) == 1
        assert index.rules[0].id == "rule-001"
        assert index.rules[0].confidence == 0.75

    def test_add_duplicate_rule_fails(self, temp_storage):
        """Test adding duplicate rule ID fails."""
        manager = RuleIndexManager(temp_storage)

        entry = RuleIndexEntry(
            id="rule-001",
            type="preference",
            priority="low",
            confidence=0.5,
            created_at="2026-05-30T10:00:00Z",
            updated_at="2026-05-30T10:00:00Z"
        )

        manager.add_rule(entry)

        with pytest.raises(ValueError, match="already exists"):
            manager.add_rule(entry)

    def test_update_rule(self, temp_storage):
        """Test updating rule in index."""
        manager = RuleIndexManager(temp_storage)

        entry = RuleIndexEntry(
            id="rule-001",
            type="preference",
            priority="low",
            confidence=0.5,
            created_at="2026-05-30T10:00:00Z",
            updated_at="2026-05-30T10:00:00Z"
        )

        manager.add_rule(entry)
        manager.update_rule("rule-001", {"confidence": 0.8, "priority": "high"})

        # Verify update
        rule = manager.get_rule("rule-001")
        assert rule.confidence == 0.8
        assert rule.priority == "high"

    def test_remove_rule(self, temp_storage):
        """Test removing rule from index."""
        manager = RuleIndexManager(temp_storage)

        entry = RuleIndexEntry(
            id="rule-001",
            type="preference",
            priority="low",
            confidence=0.5,
            created_at="2026-05-30T10:00:00Z",
            updated_at="2026-05-30T10:00:00Z"
        )

        manager.add_rule(entry)
        manager.remove_rule("rule-001")

        # Verify removal
        assert manager.get_rule("rule-001") is None

    def test_list_rules_with_filters(self, temp_storage):
        """Test listing rules with filters."""
        manager = RuleIndexManager(temp_storage)

        # Add multiple rules
        for i in range(3):
            entry = RuleIndexEntry(
                id=f"rule-{i:03d}",
                type="preference" if i == 0 else "security",
                priority="low" if i == 0 else "critical",
                confidence=0.3 + (i * 0.2),
                created_at="2026-05-30T10:00:00Z",
                updated_at="2026-05-30T10:00:00Z"
            )
            manager.add_rule(entry)

        # Filter by type
        security_rules = manager.list_rules(type_filter="security")
        assert len(security_rules) == 2

        # Filter by priority
        critical_rules = manager.list_rules(priority_filter="critical")
        assert len(critical_rules) == 2

        # Filter by confidence
        high_conf_rules = manager.list_rules(min_confidence=0.6)
        assert len(high_conf_rules) == 1

    def test_get_next_rule_id(self, temp_storage):
        """Test generating next rule ID."""
        manager = RuleIndexManager(temp_storage)

        assert manager.get_next_rule_id() == "rule-001"

        # Add a rule
        entry = RuleIndexEntry(
            id="rule-001",
            type="preference",
            priority="low",
            confidence=0.5,
            created_at="2026-05-30T10:00:00Z",
            updated_at="2026-05-30T10:00:00Z"
        )
        manager.add_rule(entry)

        assert manager.get_next_rule_id() == "rule-002"


class TestRuleContentManager:
    """Tests for RuleContentManager."""

    def test_save_and_load_content(self, temp_storage):
        """Test saving and loading rule content."""
        manager = RuleContentManager(temp_storage)

        rule = RuleContent(
            id="rule-001",
            content="Always use refreshToken() helper function for JWT token refresh",
            reason="Prevents inconsistent token handling and security issues",
            metadata={
                "type": "repeated-correction",
                "priority": "high",
                "confidence": 0.75
            }
        )

        manager.save_content(rule)

        # Load and verify
        loaded = manager.load_content("rule-001")
        assert loaded is not None
        assert loaded.id == "rule-001"
        assert "refreshToken()" in loaded.content
        assert loaded.metadata["confidence"] == 0.75

    def test_load_nonexistent_content(self, temp_storage):
        """Test loading non-existent content returns None."""
        manager = RuleContentManager(temp_storage)
        assert manager.load_content("rule-999") is None

    def test_delete_content(self, temp_storage):
        """Test deleting rule content."""
        manager = RuleContentManager(temp_storage)

        rule = RuleContent(
            id="rule-001",
            content="Test content",
            reason="Test reason",
            metadata={}
        )

        manager.save_content(rule)
        assert manager.exists("rule-001")

        manager.delete_content("rule-001")
        assert not manager.exists("rule-001")


class TestSessionArchiveManager:
    """Tests for SessionArchiveManager."""

    def test_save_and_load_session(self, temp_storage):
        """Test saving and loading session archive."""
        manager = SessionArchiveManager(temp_storage)

        archive = SessionArchive(
            session_id="session-001",
            analyzed_at="2026-05-30T10:00:00Z",
            patterns=[
                {"type": "repeated-correction", "confidence": 0.75}
            ],
            generated_rules=["rule-001", "rule-002"],
            metadata={"duration_ms": 1500}
        )

        manager.save_session(archive)

        # Load and verify
        loaded = manager.load_session("session-001")
        assert loaded is not None
        assert loaded.session_id == "session-001"
        assert len(loaded.patterns) == 1
        assert len(loaded.generated_rules) == 2

    def test_list_sessions(self, temp_storage):
        """Test listing sessions."""
        manager = SessionArchiveManager(temp_storage)

        # Add multiple sessions
        for i in range(3):
            archive = SessionArchive(
                session_id=f"session-{i:03d}",
                analyzed_at="2026-05-30T10:00:00Z",
                patterns=[],
                generated_rules=[]
            )
            manager.save_session(archive)

        sessions = manager.list_sessions()
        assert len(sessions) == 3

    def test_list_sessions_with_limit(self, temp_storage):
        """Test listing sessions with limit."""
        manager = SessionArchiveManager(temp_storage)

        for i in range(5):
            archive = SessionArchive(
                session_id=f"session-{i:03d}",
                analyzed_at="2026-05-30T10:00:00Z",
                patterns=[],
                generated_rules=[]
            )
            manager.save_session(archive)

        sessions = manager.list_sessions(limit=2)
        assert len(sessions) == 2


class TestAtomicOps:
    """Tests for atomic file operations."""

    def test_atomic_write_json(self, temp_storage):
        """Test atomic Jte."""
        path = temp_storage / "test.json"
        data = {"key": "value", "number": 42}

        atomic_write_json(path, data)

        with open(path) as f:
            loaded = json.load(f)

        assert loaded == data

    def test_atomic_write_text(self, temp_storage):
        """Test atomic text write."""
        path = temp_storage / "test.txt"
        content = "Hello, World!"

        atomic_write_text(path, content)

        with open(path) as f:
            loaded = f.read()

        assert loaded

    def test_atomic_update_json(self, temp_storage):
        """Test atomic JSON update."""
        path = temp_storage / "test.json"

        # Initial write
        atomic_write_json(path, {"count": 0})

        # Update
        def increment(data):
            data["count"] += 1
            return data

        atomic_update_json(path, increment)

        with open(path) as f:
            loaded = json.load(f)

        assert loaded["count"] == 1


class TestStorageMigrationManager:
    """Tests for StorageMigrationManager."""

    def test_get_current_version_uninitialized(self, temp_storage):
        """Test getting version from uninitialized storage."""
        manager = StorageMigrationManager(temp_storage)
        assert manager.get_current_version() is None

    def test_get_current_version(self, temp_storage):
        """Test getting version from initialized storage."""
        # Initialize storage
        config_path = temp_storage / "config.json"
        config_path.parent.mkdir(parents=True, exist_ok=True)

        with open(config_path, 'w') as f:
            json.ion": "1.0"}, f)

        manager = StorageMigrationManager(temp_storage)
        assert manager.get_current_version() == "1.0"

    def test_validate_storage(self, temp_storage):
        """Test storage validation."""
        manager = StorageMigrationManager(temp_storage)

        # Uninitialized storage should have issues
        result = manager.validate_storage()
        assert not result["valid"]
        assert len(result["issues"]) > 0
