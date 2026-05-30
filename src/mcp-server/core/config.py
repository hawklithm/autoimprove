"""
Configuration schema and management for AutoImprove.
"""

from pydantic import BaseModel, Field
from typing import Dict, Optional
from pathlib import Path
import json


class ConfidenceThresholds(BaseModel):
    """Confidence thresholds for different pattern types."""
    repeated_correction: float = Field(default=0.45, ge=0.0, le=1.0)
    anti_pattern: float = Field(default=0.45, ge=0.0, le=1.0)
    preference: float = Field(default=0.3, ge=0.0, le=1.0)
    performance: float = Field(default=0.4, ge=0.0, le=1.0)
    security: float = Field(default=0.3, ge=0.0, le=1.0)


class ConfidenceWeights(BaseModel):
    """Weights for confidence calculation components."""
    frequency: float = Field(default=0.3, ge=0.0, le=1.0)
    time_span: float = Field(default=0.1, ge=0.0, le=1.0)
    behavior: float = Field(default=0.4, ge=0.0, le=1.0)
    validation: float = Field(default=0.2, ge=0.0, le=1.0)


class RuleMatchingConfig(BaseModel):
    """Configuration for rule matching."""
    max_results: int = Field(default=10, ge=1, le=100)
    min_confidence: float = Field(default=0.3, ge=0.0, le=1.0)


class AutoImproveConfig(BaseModel):
    """Main configuration for AutoImprove system."""
    version: str = "1.0"
    confidence_thresholds: ConfidenceThresholds = Field(default_factory=ConfidenceThresholds)
    confidence_weights: ConfidenceWeights = Field(default_factory=ConfidenceWeights)
    rule_matching: RuleMatchingConfig = Field(default_factory=RuleMatchingConfig)
    business_domain_mappings: Dict[str, str] = Field(default_factory=dict)


def load_config(config_path: Optional[Path] = None) -> AutoImproveConfig:
    """
    Load configuration from file.

    Args:
        config_path: Path to config file. If None, uses ~/.autoimprove/config.json

    Returns:
        AutoImproveConfig instance
    """
    if config_path is None:
        from storage import get_storage_root
        config_path = get_storage_root() / "config.json"

    if not config_path.exists():
        # Return default config
        return AutoImproveConfig()

    with open(config_path) as f:
        data = json.load(f)

    return AutoImproveConfig(**data)


def save_config(config: AutoImproveConfig, config_path: Optional[Path] = None) -> None:
    """
    Save configuration to file.

    Args:
        config: Configuration to save
        config_path: Path to config file. If None, uses ~/.autoimprove/config.json
    """
    if config_path is None:
        from storage import get_storage_root
        config_path = get_storage_root() / "config.json"

    # Ensure parent directory exists
    config_path.parent.mkdir(parents=True, exist_ok=True)

    # Write atomically (write to temp file, then rename)
    temp_path = config_path.with_suffix('.json.tmp')
    with open(temp_path, 'w') as f:
        json.dump(config.model_dump(), f, indent=2)

    temp_path.replace(config_path)
