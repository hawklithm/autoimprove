"""
Integration tests for session analysis.
"""

import pytest
import json
import tempfile
from pathlib import Path

from core.session_analyzer import SessionAnalyzer
from core.models import PatternType


@pytest.fixture
def sample_session_file():
    """Create a sample session JSONL file for testing."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
        # User message with correction
        f.write(json.dumps({
            "role": "user",
            "content": "不对，应该使用 refreshToken() 函数",
            "timestamp": "2026-05-30T10:00:00Z"
        }) + '\n')

        # Assistant response
        f.write(json.dumps({
            "role": "assistant",
            "content": "好的，我来修改代码使用 refreshToken() 函数"
        }) + '\n')

        # Edit tool call
        f.write(json.dumps({
            "type": "tool_use",
            "name": "Edit",
            "input": {
                "file_path": "src/auth/login.ts",
                "old_string": "const token = jwt.decode()",
                "new_string": "const token = refreshToken()"
            },
            "timestamp": "2026-05-30T10:01:00Z"
        }) + '\n')

        # User message with preference
        f.write(json.dumps({
            "role": "user",
            "content": "我们团队约定使用 const 而不是 let",
            "timestamp": "2026-05-30T10:05:00Z"
        }) + '\n')

        # User message with security concern
        f.write(json.dumps({
            "role": "user",
            "content": "这里有 SQL injection 风险，需要使用参数化查询",
            "timestamp": "2026-05-30T10:10:00Z"
        }) + '\n')

        temp_path = Path(f.name)

    yield temp_path

    # Cleanup
    temp_path.unlink()


class TestSessionAnalyzer:
    """Tests for SessionAnalyzer."""

    def test_analyze_session(self, sample_session_file):
        """Test full session analysis."""
        analyzer = SessionAnalyzer()
        patterns = analyzer.analyze_session(sample_session_file)

        # Should detect multiple patterns
        assert len(patterns) > 0

        # Check pattern types
        pattern_types = [p.type for p in patterns]
        assert PatternType.REPEATED_CORRECTION in pattern_types or \
               PatternType.PREFERENCE in pattern_types or \
               PatternType.SECURITY in pattern_types

    def test_detect_repeated_corrections(self, sample_session_file):
        """Test repeated correction detection."""
        analyzer = SessionAnalyzer()
        patterns = analyzer.analyze_session(sample_session_file)

        correction_patterns = [p for p in patterns if p.type == PatternType.REPEATED_CORRECTION]

        if correction_patterns:
            pattern = correction_patterns[0]
            assert len(pattern.occurrences) > 0
            assert pattern.occurrences[0].user_action == 'explicit_correction'
            assert 'refreshToken' in pattern.occurrences[0].user_input

    def test_detect_preferences(self, sample_session_file):
        """Test preference detection."""
        analyzer = SessionAnalyzer()
        patterns = analyzer.analyze_session(sample_session_file)

        preference_patterns = [p for p in patterns if p.type == PatternType.PREFERENCE]

        if preference_patterns:
            pattern = preference_patterns[0]
            assert len(pattern.occurrences) > 0
            assert '团队' in pattern.occurrences[0].user_input or 'const' in pattern.occurrences[0].user_input

    def test_detect_security_patterns(self, sample_session_file):
        """Test security pattern detection."""
        analyzer = SessionAnalyzer()
        patterns = analyzer.analyze_session(sample_session_file)

        security_patterns = [p for p in patterns if p.type == PatternType.SECURITY]

        if security_patterns:
            pattern = security_patterns[0]
            assert len(pattern.occurrences) > 0
            assert pattern.occurrences[0].security_issue is not None
            assert 'injection' in pattern.occurrences[0].security_issue.lower()

    def test_confidence_calculation(self, sample_session_file):
        """Test that confidence is calculated for patterns."""
        analyzer = SessionAnalyzer()
        patterns = analyzer.analyze_session(sample_session_file)

        for pattern in patterns:
            assert 0.0 <= pattern.confidence <= 1.0

    def test_empty_session_file(self):
        """Test handling of empty session file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            temp_path = Path(f.name)

        try:
            analyzer = SessionAnalyzer()
            with pytest.raises(ValueError, match="No valid data"):
                analyzer.analyze_session(temp_path)
        finally:
            temp_path.unlink()

    def test_malformed_jsonl(self):
        """Test handling of malformed JSONL."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write("not valid json\n")
            f.write(json.dumps({"role": "user", "content": "test"}) + '\n')
            temp_path = Path(f.name)

        try:
            analyzer = SessionAnalyzer()
            patterns = analyzer.analyze_session(temp_path)
            # Should skip malformed line and continue
            assert isinstance(patterns, list)
        finally:
            temp_path.unlink()
