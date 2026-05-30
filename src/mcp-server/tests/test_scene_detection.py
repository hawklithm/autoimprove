"""
Unit tests for scene detection.
"""

import pytest
from core.scene_detector import SceneDetector
from core.models import Scene


class TestSceneDetector:
    """Tests for SceneDetector."""

    def test_detect_react_tech_stack(self):
        """Test React tech stack detection."""
        detector = SceneDetector()

        file_paths = [
            'src/components/Button.tsx',
            'src/hooks/useAuth.ts'
        ]

        scene = detector.detect_scene(file_paths)

        assert 'react' in scene.tech
        assert 'typescript' in scene.tech

    def test_detect_functional_domain_auth(self):
        """Test auth functional domain detection."""
        detector = SceneDetector()

        file_paths = [
            'src/auth/login.ts',
            'src/auth/token.ts'
        ]

        scene = detector.detect_scene(file_paths)

        assert 'auth' in scene.functional

    def test_detect_business_domain_ecommerce(self):
        """Test e-commerce business domain detection."""
        detector = SceneDetector()

        file_paths = ['src/cart/checkout.ts']
        content_samples = ['Add item to cart', 'Process payment']

        scene = detector.detect_scene(file_paths, content_samples)

        assert 'e-commerce' in scene.business

    def test_business_domain_config(self):
        """Test business domain configuration."""
        detector = SceneDetector(business_domain_config={
            'src/shop': 'e-commerce',
            'src/crm': 'crm'
        })

        file_paths = ['src/shop/products.ts']

        scene = detector.detect_scene(file_paths)

        assert 'e-commerce' in scene.business

    def test_multiple_tech_stacks(self):
        """Test detection of multiple tech stacks."""
        detector = SceneDetector()

        file_paths = [
            'src/components/App.tsx',
            'backend/api.py'
        ]

        scene = detector.detect_scene(file_paths)

        assert 'react' in scene.tech or 'typescript' in scene.tech
        assert 'python' in scene.tech

    def test_calculate_scene_confidence(self):
        """Test scene confidence calculation."""
        detector = SceneDetector()

        scene = Scene(
            tech=['react', 'typescript'],
            functional=['auth'],
            business=['e-commerce']
        )

        confidences = detector.calculate_scene_confidence(scene, file_count=5)

        assert 'tech' in confidences
        assert 'functional' in confidences
        assert 'business' in confidences
        assert all(0.0 <= v <= 1.0 for v in confidences.values())

    def test_empty_file_paths(self):
        """Test with empty file paths."""
        detector = SceneDetector()

        scene = detector.detect_scene([])

        assert scene.tech == []
        assert scene.functional == []
        assert scene.business == []
