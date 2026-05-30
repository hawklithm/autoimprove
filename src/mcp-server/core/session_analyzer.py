"""
Session analyzer for AutoImprove.

Analyzes Claude Code sessions and detects patterns.
Combines all pattern detection logic (repeated correction, anti-pattern, preference, performance, security).
"""

from typing import List, Dict, Optional, Set
from pathlib import Path
from datetime import datetime

from core.jsonl_parser import JSONLParser, SessionData, Message, ToolCall
from core.models import Pattern, PatternType, PatternOccurrence
from core.confidence import ConfidenceCalculator
from core.keywords import KeywordDetector


class SessionAnalyzer:
    """Analyzes sessions and detects patterns."""

    def __init__(self):
        """Initialize session analyzer."""
        self.parser = JSONLParser()
        self.confidence_calc = ConfidenceCalculator()
        self.keyword_detector = KeywordDetector()

    def analyze_session(self, session_file: Path) -> List[Pattern]:
        """
        Analyze a session file and detect patterns.

        Args:
            session_file: Path to session JSONL file

        Returns:
            List of detected patterns
        """
        # Parse session
        session_data = self.parser.parse_file(session_file)

        # Detect all pattern types
        patterns = []

        patterns.extend(self._detect_repeated_corrections(session_data))
        patterns.extend(self._detect_anti_patterns(session_data))
        patterns.extend(self._detect_preferences(session_data))
        patterns.extend(self._detect_performance_patterns(session_data))
        patterns.extend(self._detect_security_patterns(session_data))

        # Calculate confidence for all patterns
        for pattern in patterns:
            pattern.confidence = self.confidence_calc.calculate_confidence(pattern)

        return patterns

    def _detect_repeated_corrections(self, session_data: SessionData) -> List[Pattern]:
        """Detect repeated correction patterns."""
        patterns = []
        user_messages = self.parser.get_user_messages(session_data)

        # Look for correction keywords
        correction_keywords = [
            '不对', '不是', '改成', '应该', '修正', '修改',
            'fix', 'change', 'should', 'correct', 'instead',
            '不要', "don't", 'avoid', '别'
        ]

        corrections = []
        for msg in user_messages:
            content_lower = msg.content.lower()
            if any(kw in content_lower for kw in correction_keywords):
                corrections.append(msg)

        # Group similar corrections
        if corrections:
            # Simple grouping: all corrections in this session
            # In production, would use more sophisticated similarity matching
            pattern = Pattern(
                type=PatternType.REPEATED_CORRECTION,
                description=self._extract_correction_description(corrections),
                occurrences=[
                    PatternOccurrence(
                        session_id=session_data.session_id,
                        timestamp=msg.timestamp or datetime.utcnow().isoformat() + 'Z',
                        user_action='explicit_correction',
                        context=self._extract_context(session_data, msg),
                        user_input=msg.content[:200]  # First 200 chars
                    )
                    for msg in corrections
                ],
                first_seen=corrections[0].timestamp or datetime.utcnow().isoformat() + 'Z',
                last_seen=corrections[-1].timestamp or datetime.utcnow().isoformat() + 'Z'
            )
            patterns.append(pattern)

        return patterns

    def _detect_anti_patterns(self, session_data: SessionData) -> List[Pattern]:
        """Detect anti-pattern occurrences."""
        patterns = []

        # Look for test failures followed by corrections
        # Check for Edit/Write tool calls after user corrections
        user_messages = self.parser.get_user_messages(session_data)
        edit_calls = self.parser.get_tool_calls_by_name(session_data, 'Edit')
        write_calls = self.parser.get_tool_calls_by_name(session_data, 'Write')

        # Simple heuristic: user message followed by code change
        for i, msg in enumerate(user_messages):
            content_lower = msg.content.lower()

            # Check for anti-pattern indicators
            anti_pattern_keywords = [
                'bug', 'error', 'wrong', 'incorrect', 'broken',
                '错误', '问题', 'issue', 'fail', 'crash'
            ]

            if any(kw in content_lower for kw in anti_pattern_keywords):
                # Check if followed by code changes
                subsequent_edits = [
                    tc for tc in (edit_calls + write_calls)
                    if tc.line_number > msg.line_number
                ]

                if subsequent_edits:
                    pattern = Pattern(
                        type=PatternType.ANTI_PATTERN,
                        description=self._extract_anti_pattern_description(msg),
                        occurrences=[
                            PatternOccurrence(
                                session_id=session_data.session_id,
                                timestamp=msg.timestamp or datetime.utcnow().isoformat() + 'Z',
                                user_action='explicit_correction',
                                context=self._extract_context(session_data, msg),
                                test_passed=None,  # Would need test result detection
                                user_input=msg.content[:200]
                            )
                        ],
                        first_seen=msg.timestamp or datetime.utcnow().isoformat() + 'Z',
                        last_seen=msg.timestamp or datetime.utcnow().isoformat() + 'Z'
                    )
                    patterns.append(pattern)

        return patterns

    def _detect_preferences(self, session_data: SessionData) -> List[Pattern]:
        """Detect user preference patterns."""
        patterns = []
        user_messages = self.parser.get_user_messages(session_data)

        # Look for preference indicators
        for msg in user_messages:
            keywords = self.keyword_detector.get_keywords_for_type(PatternType.PREFERENCE)
            content_lower = msg.content.lower()

            if any(kw.lower() in content_lower for kw in keywords):
                pattern = Pattern(
                    type=PatternType.PREFERENCE,
                    description=self._extract_preference_description(msg),
                    occurrences=[
                        PatternOccurrence(
                            session_id=session_data.session_id,
                            timestamp=msg.timestamp or datetime.utcnow().isoformat() + 'Z',
                            user_action='accept',
                            context=self._extract_context(session_data, msg),
                            user_input=msg.content[:200]
                        )
                    ],
                    first_seen=msg.timestamp or datetime.utcnow().isoformat() + 'Z',
                    last_seen=msg.timestamp or datetime.utcnow().isoformat() + 'Z'
                )
                patterns.append(pattern)

        return patterns

    def _detect_performance_patterns(self, session_data: SessionData) -> List[Pattern]:
        """Detect performance optimization patterns."""
        patterns = []
        user_messages = self.parser.get_user_messages(session_data)

        # Look for performance keywords
        for msg in user_messages:
            keywords = self.keyword_detector.get_keywords_for_type(PatternType.PERFORMANCE)
            content_lower = msg.content.lower()

            if any(kw.lower() in content_lower for kw in keywords):
                pattern = Pattern(
                    type=PatternType.PERFORMANCE,
                    description=self._extract_performance_description(msg),
                    occurrences=[
                        PatternOccurrence(
                            session_id=session_data.session_id,
                            timestamp=msg.timestamp or datetime.utcnow().isoformat() + 'Z',
                            user_action='explicit_correction',
                            context=self._extract_context(session_data, msg),
                            performance_improved=None,  # Would need measurement
                            user_input=msg.content[:200]
                        )
                    ],
                    first_seen=msg.timestamp or datetime.utcnow().isoformat() + 'Z',
                    last_seen=msg.timestamp or datetime.utcnow().isoformat() + 'Z'
                )
                patterns.append(pattern)

        return patterns

    def _detect_security_patterns(self, session_data: SessionData) -> List[Pattern]:
        """Detect security issue patterns."""
        patterns = []
        user_messages = self.parser.get_user_messages(session_data)

        # Look for security keywords
        for msg in user_messages:
            keywords = self.keyword_detector.get_keywords_for_type(PatternType.SECURITY)
            content_lower = msg.content.lower()

            matched_keywords = [kw for kw in keywords if kw.lower() in content_lower]

            if matched_keywords:
                # Determine security issue type
                security_issue = self._classify_security_issue(matched_keywords)

                pattern = Pattern(
                    type=PatternType.SECURITY,
                    description=self._extract_security_description(msg),
                    occurrences=[
                        PatternOccurrence(
                            session_id=session_data.session_id,
                            timestamp=msg.timestamp or datetime.utcnow().isoformat() + 'Z',
                            user_action='explicit_correction',
                            context=self._extract_context(session_data, msg),
                            security_issue=security_issue,
                            user_input=msg.content[:200]
                        )
                    ],
                    first_seen=msg.timestamp or datetime.utcnow().isoformat() + 'Z',
                    last_seen=msg.timestamp or datetime.utcnow().isoformat() + 'Z'
                )
                patterns.append(pattern)

        return patterns

    def _extract_correction_description(self, messages: List[Message]) -> str:
        """Extract description from correction messages."""
        # Use first message as base
        if not messages:
            return "Repeated correction"

        content = messages[0].content
        # Extract first sentence or first 100 chars
        sentences = content.split('.')
        if sentences:
            return sentences[0].strip()[:100]
        return content[:100]

    def _extract_anti_pattern_description(self, message: Message) -> str:
        """Extract anti-pattern description."""
        content = message.content
        sentences = content.split('.')
        if sentences:
            return sentences[0].strip()[:100]
        return content[:100]

    def _extract_preference_description(self, message: Message) -> str:
        """Extract preference description."""
        content = message.content
        sentences = content.split('.')
        if sentences:
            return sentences[0].strip()[:100]
        return content[:100]

    def _extract_performance_description(self, message: Message) -> str:
        """Extract performance description."""
        content = message.content
        sentences = content.split('.')
        if sentences:
            return sentences[0].strip()[:100]
        return content[:100]

    def _extract_security_description(self, message: Message) -> str:
        """Extract security description."""
        content = message.content
        sentences = content.split('.')
        if sentences:
            return sentences[0].strip()[:100]
        return content[:100]

    def _extract_context(self, session_data: SessionData, message: Message) -> str:
        """Extract context (file paths) around a message."""
        # Look for file paths in nearby tool calls
        file_paths = self.parser.extract_file_paths(session_data)

        if file_paths:
            return file_paths[0]  # Return first file path

        return "unknown"

    def _classify_security_issue(self, keywords: List[str]) -> str:
        """Classify security issue type from keywords."""
        keywords_lower = [kw.lower() for kw in keywords]

        if any('injection' in kw or '注入' in kw for kw in keywords_lower):
            return 'injection'
        elif any('xss' in kw for kw in keywords_lower):
            return 'xss'
        elif any('csrf' in kw for kw in keywords_lower):
            return 'csrf'
        else:
            return 'security-general'
