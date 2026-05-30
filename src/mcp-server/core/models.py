"""
Core data structures for AutoImprove pattern detection.

Ported from prototype/session_analyzer.py with improvements.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict
from datetime import datetime
from enum import Enum


class PatternType(Enum):
    """Types of patterns that can be detected."""
    REPEATED_CORRECTION = "repeated-correction"
    ANTI_PATTERN = "anti-pattern"
    PREFERENCE = "preference"
    PERFORMANCE = "performance"
    SECURITY = "security"


@dataclass
class Scene:
    """Three-dimensional scene model."""
    tech: List[str] = field(default_factory=list)
    functional: List[str] = field(default_factory=list)
    business: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, List[str]]:
        """Convert to dictionary."""
        return {
            "tech": self.tech,
            "functional": self.functional,
            "business": self.business
        }

    @classmethod
    def from_dict(cls, data: Dict[str, List[str]]) -> "Scene":
        """Create from dictionary."""
        return cls(
            tech=data.get("tech", []),
            functional=data.get("functional", []),
            business=data.get("business", [])
        )


@dataclass
class PatternOccurrence:
    """Single occurrence of a pattern."""
    session_id: str
    timestamp: str
    user_action: str  # 'explicit_correction', 'amend', 'undo', 'accept'
    context: str
    test_passed: Optional[bool] = None
    performance_improved: Optional[bool] = None
    security_issue: Optional[str] = None
    user_input: Optional[str] = None

    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            "session_id": self.session_id,
            "timestamp": self.timestamp,
            "user_action": self.user_action,
            "context": self.context,
            "test_passed": self.test_passed,
            "performance_improved": self.performance_improved,
            "security_issue": self.security_issue,
            "user_input": self.user_input
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "PatternOccurrence":
        """Create from dictionary."""
        return cls(
            session_id=data["session_id"],
            timestamp=data["timestamp"],
            user_action=data["user_action"],
            context=data["context"],
            test_passed=data.get("test_passed"),
            performance_improved=data.get("performance_improved"),
            security_issue=data.get("security_issue"),
            user_input=data.get("user_input")
        )


@dataclass
class Pattern:
    """Detected pattern from session analysis."""
    type: PatternType
    description: str
    occurrences: List[PatternOccurrence]
    first_seen: str
    last_seen: str
    confidence: float = 0.0
    category: Optional[str] = None
    priority: Optional[str] = None
    keywords: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            "type": self.type.value,
            "description": self.description,
            "occurrences": [o.to_dict() for o in self.occurrences],
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "confidence": self.confidence,
            "category": self.category,
            "priority": self.priority,
            "keywords": self.keywords
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "Pattern":
        """Create from dictionary."""
        return cls(
            type=PatternType(data["type"]),
            description=data["description"],
            occurrences=[PatternOccurrence.from_dict(o) for o in data["occurrences"]],
            first_seen=data["first_seen"],
            last_seen=data["last_seen"],
            confidence=data.get("confidence", 0.0),
            category=data.get("category"),
            priority=data.get("priority"),
            keywords=data.get("keywords", [])
        )


# Framework-specific rules detection
FRAMEWORK_RULES = {
    'react': [
        'hooks', 'useEffect', 'useState', 'useCallback', 'useMemo',
        'Rules of Hooks', '循环里调用', '条件里调用'
    ],
    'vue': ['reactive', 'ref', 'computed', 'watch'],
    'angular': ['ngOnInit', 'ngOnDestroy', 'ChangeDetection'],
}


def is_framework_rule(pattern: Pattern) -> bool:
    """
    Check if pattern is a framework-specific rule.

    Args:
        pattern: Pattern to check

    Returns:
        True if framework rule, False otherwise
    """
    description_lower = pattern.description.lower()

    for framework, keywords in FRAMEWORK_RULES.items():
        if any(kw.lower() in description_lower for kw in keywords):
            return True

    # Also check user input
    for occurrence in pattern.occurrences:
        if occurrence.user_input:
            input_lower = occurrence.user_input.lower()
            for framework, keywords in FRAMEWORK_RULES.items():
                if any(kw.lower() in input_lower for kw in keywords):
                    return True

    return False
