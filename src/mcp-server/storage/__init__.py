"""
Storage initialization utilities for AutoImprove.

Creates and manages the ~/.autoimprove/ directory structure.
"""

import os
from pathlib import Path
import json
from typing import Optional


def get_storage_root() -> Path:
    """Get the root storage directory (~/.autoimprove/)."""
    return Path.home() / ".autoimprove"


def init_storage(force: bool = False) -> dict:
    """
    Initialize the storage directory structure.

    Creates:
    - ~/.autoimprove/
    - ~/.autoimprove/rules/
    - ~/.autoimprove/rules/content/
    - ~/.autoimprove/sessions/
    - ~/.autoimprove/cache/
    - ~/.autoimprove/config.json (if not exists)

    Args:
        force: If True, recreate directories even if they exist

    Returns:
        dict with status and created paths
    """
    root = get_storage_root()

    # Define directory structure
    dirs = [
        root,
        root / "rules",
        root / "rules" / "content",
        root / "sessions",
        root / "cache",
    ]

    created = []
    existing = []

    for dir_path in dirs:
        if dir_path.exists() and not force:
            existing.append(str(dir_path))
        else:
            dir_path.mkdir(parents=True, exist_ok=True)
            created.append(str(dir_path))

    # Initialize config.json if not exists
    config_path = root / "config.json"
    if not config_path.exists() or force:
        default_config = {
            "version": "1.0",
            "confidence_thresholds": {
                "repeated_correction": 0.45,
                "anti_pattern": 0.45,
                "preference": 0.3,
                "performance": 0.4,
                "security": 0.3
            },
            "confidence_weights": {
                "frequency": 0.3,
                "time_span": 0.1,
                "behavior": 0.4,
                "validation": 0.2
            },
            "rule_matching": {
                "max_results": 10,
                "min_confidence": 0.3
            },
            "business_domain_mappings": {}
        }

        with open(config_path, 'w') as f:
            json.dump(default_config, f, indent=2)
        created.append(str(config_path))
    else:
        existing.append(str(config_path))

    # Initialize rules index if not exists
    index_path = root / "rules" / "index.json"
    if not index_path.exists() or force:
        with open(index_path, 'w') as f:
            json.dump({"version": "1.0", "rules": []}, f, indent=2)
        created.append(str(index_path))
    else:
        existing.append(str(index_path))

    return {
        "status": "initialized",
        "root": str(root),
        "created": created,
        "existing": existing
    }


def check_storage_exists() -> bool:
    """Check if storage directory is initialized."""
    root = get_storage_root()
    return (
        root.exists() and
        (root / "rules").exists() and
        (root / "config.json").exists()
    )


def get_storage_info() -> dict:
    """Get information about storage state."""
    root = get_storage_root()

    if not check_storage_exists():
        return {
            "initialized": False,
            "root": str(root)
        }

    # Count rules
    index_path = root / "rules" / "index.json"
    rule_count = 0
    if index_path.exists():
        with open(index_path) as f:
            data = json.load(f)
            rule_count = len(data.get("rules", []))

    # Count sessions
    sessions_dir = root / "sessions"
    session_count = len(list(sessions_dir.glob("*.json"))) if sessions_dir.exists() else 0

    # Get storage size
    total_size = sum(
        f.stat().st_size
        for f in root.rglob("*")
        if f.is_file()
    )

    return {
        "initialized": True,
        "root": str(root),
        "rule_count": rule_count,
        "session_count": session_count,
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / 1024 / 1024, 2)
    }
