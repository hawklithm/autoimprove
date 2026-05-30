"""
Framework-specific rule recognition for AutoImprove.

Identifies patterns that are framework-specific rules (React, Vue, Angular, etc.).
"""

from typing import Dict, List
from core.models import Pattern, PatternType


# Framework-specific keywords
FRAMEWORK_RULES = {
    'react': [
        'hooks', 'useEffect', 'useState', 'useCallback', 'useMemo',
        'Rules of Hooks', '循环里调用', '条件里调用',
        'useRef', 'useContext', 'useReducer', 'useLayoutEffect',
        'hook', 'component lifecycle'
    ],
    'vue': [
        'reactive', 'ref', 'computed', 'watch',
        'watchEffect', 'composition api', 'setup',
        'v-model', 'v-if', 'v-for'
    ],
    'angular': [
        'ngOnInit', 'ngOnDestroy', 'ChangeDetection',
        'ngOnChanges', 'ngAfterViewInit', 'lifecycle hook',
        'dependency injection', 'service', 'directive'
    ],
    'svelte': [
        'reactive declaration', '$:', 'store',
        'onMount', 'onDestroy', 'beforeUpdate', 'afterUpdate'
    ],
    'nextjs': [
        'getServerSideProps', 'getStaticProps', 'getStaticPaths',
        'app router', 'pages router', 'middleware'
    ]
}


class FrameworkRuleDetector:
    """Detects framework-specific rules in patterns."""

    def __init__(self, custom_rules: Dict[str, List[str]] = None):
        """
        Initialize framework rule detector.

        Args:
            custom_rules: Optional custom framework rules to add
        """
        self.framework_rules = FRAMEWORK_RULES.copy()

        if custom_rules:
            for framework, keywords in custom_rules.items():
                if framework in self.framework_rules:
                    self.framework_rules[framework].extend(keywords)
                else:
                    self.framework_rules[framework] = keywords

    def is_framework_rule(self, pattern: Pattern) -> bool:
        """
        Check if pattern is a framework-specific rule.

        Args:
            pattern: Pattern to check

        Returns:
            True if framework rule, False otherwise
        """
        description_lower = pattern.description.lower()

        # Check description
        for framework, keywords in self.framework_rules.items():
            if any(kw.lower() in description_lower for kw in keywords):
                return True

        # Check user input in occurrences
        for occurrence in pattern.occurrences:
            if occurrence.user_input:
                input_lower = occurrence.user_input.lower()
                for framework, keywords in self.framework_rules.items():
                    if any(kw.lower() in input_lower for kw in keywords):
                        return True

        return False

    def detect_framework(self, pattern: Pattern) -> List[str]:
        """
        Detect which frameworks are mentioned in the pattern.

        Args:
            pattern: Pattern to analyze

        Returns:
            List of detected framework names
        """
        detected_frameworks = []
        description_lower = pattern.description.lower()

        for framwords in self.framework_rules.items():
            # Check description
            if any(kw.lower() in description_lower for kw in keywords):
                if framework not in detected_frameworks:
                    detected_frameworks.append(framework)
                continue

            # Check user input
            for occurrence in pattern.occurrences:
                if occurrence.user_input:
                    input_lower = occurrence.user_input.lower()
                    if any(kw.lower() in input_lower for kw in keywords):
                        if framework not in detected_frameworks:
                            detected_frameworks.append(framework)
                        break

        return detected_frameworks

    def add_framework(self, framework: str, keywords: List[str]) -> None:
        """
        Add a new framework or extend existing one.

        Args:
            framework: Framework name
            keywords: List of keywords for this framework
        """
        if framework in self.framework_rules:
            self.framework_rules[framework].extend(keywords)
        else:
            self.framework_rules[framework] = keywords

    def get_frameworks(self) -> List[str]:
        """
        Get list of all registered frameworks.

        Returns:
            List of framework names
        """
        return list(self.framework_rules.keys())

    def get_keywords(self, framework: str) -> List[str]:
        """
        Get keywords for a specific framework.

        Args:
            framework: Framework name

        Returns:
            List of keywords, or empty list if framework not found
        """
        return self.framework_rules.get(framework, [])
