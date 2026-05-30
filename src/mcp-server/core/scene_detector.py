"""
Scene detection for AutoImprove.

Detects three-dimensional scenes: tech stack, functional domain, business domain.
"""

from typing import List, Dict, Set, Optional
from pathlib import Path
import re

from core.models import Scene


# Tech stack detection patterns
TECH_PATTERNS = {
    'react': ['.jsx', '.tsx', 'react', 'useState', 'useEffect', 'jsx'],
    'vue': ['.vue', 'vue', 'reactive', 'ref', 'computed'],
    'angular': ['.component.ts', 'angular', 'ngOnInit', '@Component'],
    'typescript': ['.ts', '.tsx', 'typescript', 'interface', 'type'],
    'javascript': ['.js', '.jsx', 'javascript'],
    'python': ['.py', 'python', 'def ', 'import '],
    'java': ['.java', 'java', 'public class', 'import java'],
    'go': ['.go', 'golang', 'func ', 'package '],
    'rust': ['.rs', 'rust', 'fn ', 'use '],
    'nextjs': ['next.config', 'getServerSideProps', 'getStaticProps'],
    'express': ['express', 'app.get', 'app.post', 'middleware'],
    'fastapi': ['fastapi', 'FastAPI', '@app.get', '@app.post'],
    'django': ['django', 'models.Model', 'views.py', 'urls.py'],
}

# Functional domain detection patterns
FUNCTIONAL_PATTERNS = {
    'auth': ['auth', 'login', 'logout', 'signin', 'signup', 'authentication', 'authorization', 'token', 'session'],
    'api': ['api', 'endpoint', 'route', 'controller', 'service'],
    'database': ['database', 'db', 'model', 'schema', 'migration', 'query'],
    'ui': ['component', 'ui', 'view', 'page', 'layout', 'style'],
    'test': ['test', 'spec', '__tests__', 'testing'],
    'config': ['config', 'settings', 'env', 'configuration'],
    'utils': ['util', 'helper', 'common', 'shared'],
    'middleware': ['middleware', 'interceptor', 'guard'],
}

# Business domain keywords (for inference)
BUSINESS_KEYWORDS = {
    'e-commerce': ['cart', 'checkout', 'payment', 'order', 'product', 'inventory', 'shipping'],
    'social': ['post', 'comment', 'like', 'follow', 'feed', 'profile', 'friend'],
    'finance': ['transaction', 'account', 'balance', 'invoice', 'billing', 'payment'],
    'healthcare': ['patient', 'doctor', 'appointment', 'medical', 'diagnosis', 'prescription'],
    'education': ['course', 'student', 'teacher', 'lesson', 'assignment', 'grade'],
    'crm': ['customer', 'lead', 'opportunity', 'contact', 'deal', 'pipeline'],
}


class SceneDetector:
    """Detects scenes from file paths and content."""

    def __init__(self, business_domain_config: Optional[Dict[str, str]] = None):
        """
        Initialize scene detector.

        Args:
            business_domain_config: Optional mapping of path patterns to business domains
        """
        self.business_domain_config = business_domain_config or {}

    def detect_scene(
        self,
        file_paths: List[str],
        content_samples: Optional[List[str]] = None
    ) -> Scene:
        """
        Detect scene from file paths and optional content.

        Args:
            file_paths: List of file paths
            content_samples: Optional list of content samples

        Returns:
            Scene object with detected dimensions
        """
        tech = self._detect_tech_stack(file_paths, content_samples)
        functional = self._detect_functional_domain(file_paths)
        business = self._detect_business_domain(file_paths, content_samples)

        return Scene(tech=tech, functional=functional, business=business)

    def _detect_tech_stack(
        self,
        file_paths: List[str],
        content_samples: Optional[List[str]] = None
    ) -> List[str]:
        """Detect tech stack from file extensions and content."""
        detected = set()

        # Check file extensions and paths
        for path in file_paths:
            path_lower = path.lower()
            for tech, patterns in TECH_PATTERNS.items():
                if any(pattern in path_lower for pattern in patterns):
                    detected.add(tech)

        # Check content if provided
        if content_samples:
            for content in content_samples:
                content_lower = content.lower()
                for tech, patterns in TECH_PATTERNS.items():
                    if any(pattern in content_lower for pattern in patterns):
                        detected.add(tech)

        return sorted(detected)

    def _detect_functional_domain(self, file_paths: List[str]) -> List[str]:
        """Detect functional domain from directory structure."""
        detected = set()

        for path in file_paths:
            path_lower = path.lower()
            # Split path into parts
            parts = path_lower.replace('\\', '/').split('/')

            for domain, patterns in FUNCTIONAL_PATTERNS.items():
                if any(pattern in part for part in parts for pattern in patterns):
                    detected.add(domain)

        return sorted(detected)

    def _detect_business_domain(
        self,
        file_paths: List[str],
        content_samples: Optional[List[str]] = None
    ) -> List[str]:
        """Detect business domain from paths and content."""
        detected = set()

        # Check configured mappings first
        for path in file_paths:
            for pattern, domain in self.business_domain_config.items():
                if pattern in path:
                    detected.add(domain)

        # Infer from keywords
        all_text = ' '.join(file_paths).lower()
        if content_samples:
            all_text += ' ' + ' '.join(content_samples).lower()

        for domain, keywords in BUSINESS_KEYWORDS.items():
            if any(kw in all_text for kw in keywords):
                detected.add(domain)

        return sorted(detected)

    def calculate_scene_confidence(
        self,
        scene: Scene,
        file_count: int
    ) -> Dict[str, float]:
        """
        Calculate confidence scores for each scene dimension.

        Args:
            scene: Detected scene
            file_count: Number of files analyzed

        Returns:
            Dictionary of confidence scores per dimension
        """
        confidences = {}

        # Tech stack confidence (based on consistency)
        if scene.tech:
            # Higher confidence if multiple files use same tech
            confidences['tech'] = min(len(scene.tech) / max(file_count, 1) + 0.5, 1.0)
        else:
            confidences['tech'] = 0.0

        # Functional domain confidence (based on path clarity)
        if scene.functional:
            confidences['functional'] = 0.8 if len(scene.functional) <= 2 else 0.6
        else:
            confidences['functional'] = 0.0

        # Business domain confidence (lower for inferred domains)
        if scene.business:
            # Check if from config (high confidence) or inferred (lower)
            has_config = any(
                any(pattern in path for pattern in self.business_domain_config.keys())
                for path in []  # Would need to pass file_paths
            )
            confidences['business'] = 0.8 if has_config else 0.5
        else:
            confidences['business'] = 0.0

        return confidences

    def add_business_domain_mapping(self, path_pattern: str, domain: str) -> None:
        """
        Add a business domain mapping.

        Args:
            path_pattern: Path pattern to match
            domain: Business domain name
        """
        self.business_domain_config[path_pattern] = domain

    def detect_from_session_data(
        self,
        file_paths: List[str],
        user_messages: List[str]
    ) -> Scene:
        """
        Detect scene from session data.

        Args:
            file_paths: File paths from session
            user_messages: User messages from session

        Returns:
            Detected scene
        """
        # Use user messages as content samples
        content_samples = user_messages[:10]  # Limit to first 10 messages

        return self.detect_scene(file_paths, content_samples)
