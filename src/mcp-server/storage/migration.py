"""
Storage migration and version management for AutoImprove.

Handles schema version detection and automatic migration.
"""

import json
from pathlib import Path
from typing import Dict, Any, Optional, List, Callable
from datetime import datetime
import shutil
from storage.atomic_ops import atomic_write_json


CURRENT_VERSION = "1.0"


class StorageVersion:
    """Represents a storage schema version."""

    def __init__(self, version: str, description: str):
        self.version = version
        self.description = description


class Migration:
    """Represents a migration from one version to another."""

    def __init__(
        self,
        from_version: str,
        to_version: str,
        migrate_fn: Callable[[Path], None],
        description: str
    ):
        self.from_version = from_version
        self.to_version = to_version
        self.migrate_fn = migrate_fn
        self.description = description

    def apply(self, storage_root: Path) -> None:
        """Apply this migration."""
        self.migrate_fn(storage_root)


class StorageMigrationManager:
    """Manages storage schema migrations."""

    def __init__(self, storage_root: Path):
        self.storage_root = storage_root
        self.migrations: List[Migration] = []
        self._register_migrations()

    def _register_migrations(self) -> None:
        """Register all available migrations."""
        # Currently only v1.0, no migrations needed yet
        # Future migrations will be registered here
        pass

    def get_current_version(self) -> Optional[str]:
        """
        Get current storage version.

        Returns:
            Version string if storage is initialized, None otherwise
        """
        config_path = self.storage_root / "config.json"

        if not config_path.exists():
            return None

        try:
            with open(config_path) as f:
                data = json.load(f)
            return data.get("version")
        except (json.JSONDecodeError, KeyError):
            return None

    def needs_migration(self) -> bool:
        """
        Check if storage needs migration.

        Returns:
            True if migration is needed, False otherwise
        """
        current = self.get_current_version()

        if current is None:
            return False  # Not initialized yet

        return current != CURRENT_VERSION

    def get_migration_path(self, from_version: str, to_version: str) -> List[Migration]:
        """
        Get sequence of migrations needed to go from one version to another.

        Args:
            from_version: Starting version
            to_version: Target version

        Returns:
            List of migrations to apply in order
        """
        # For now, simple direct migration
        # In future, may need to chain multiple migrations
        path = []

        for migration in self.migrations:
            if migration.from_version == from_version and migration.to_version == to_version:
                path.append(migration)
                break

        return path

    def create_backup(self, backup_name: Optional[str] = None) -> Path:
        """
        Create backup of storage directory.

        Args:
            backup_name: Optional backup name. If None, uses timestamp.

        Returns:
            Path to backup directory
        """
        if backup_name is None:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            backup_name = f"backup_{timestamp}"

        backup_root = self.storage_root.parent / f".autoimprove_backups"
        backup_root.mkdir(exist_ok=True)

        backup_path = backup_root / backup_name

        # Copy entire storage directory
        shutil.copytree(self.storage_root, backup_path, dirs_exist_ok=True)
        return backup_path

    def migrate(self, create_backup: bool = True) -> Dict[str, Any]:
        """
        Migrate storage to current version.

        Args:
            create_backup: If True, creates backup before migration

        Returns:
            Migration result dictionary
        """
        current_version = self.get_current_version()

        if current_version is None:
            return {
                "status": "error",
                "message": "Storage not initialized"
            }

        if current_version == CURRENT_VERSION:
            return {
                "status": "success",
                "message": "Already at current version",
                "version": CURRENT_VERSION
            }

        # Create backup if requested
        backup_path = None
        if create_backup:
            backup_path = self.create_backup()

        try:
            # Get migration path
            migrations = self.get_migration_path(current_version, CURRENT_VERSION)

            if not migrations:
                return {
                    "status": "error",
                    "message": f"No migration path from {current_version} to {CURRENT_VERSION}"
                }

            # Apply migrations
            for migration in migrations:
                migration.apply(self.storage_root)

            # Update version in config
            config_path = self.storage_root / "config.json"
            with open(config_path) as f:
                config = json.load(f)

            config["version"] = CURRENT_VERSION
            atomic_write_json(config_path, config)

            return {
                "status": "success",
                "message": f"Migrated from {current_version} to {CURRENT_VERSION}",
                "from_version": current_version,
                "to_version": CURRENT_VERSION,
                "backup_path": str(backup_path) if backup_path else None,
                "migrations_applied": len(migrations)
            }

        except Exception as e:
            return {
                "status": "error",
                "message": f"Migration failed: {str(e)}",
                "backup_path": str(backup_path) if backup_path else None
            }

    def validate_storage(self) -> Dict[str, Any]:
        """
        Validate storage structure and integrity.

        Returns:
            Validation result dictionary
        """
        issues = []

        # Check required directories
        required_dirs = [
            self.storage_root / "rules",
            self.storage_root / "rules" / "content",
            self.storage_root / "sessions",
            self.storage_root / "cache"
        ]

        for dir_path in required_dirs:
            if not dir_path.exists():
                issues.append(f"Missing directory: {dir_path}")

        # Check required files
        config_path = self.storage_root / "config.json"
        if not config_path.exists():
            issues.append("Missing config.json")
        else:
            # Validate config structure
            try:
                with open(config_path) as f:
                    config = json.load(f)

                if "version" not in config:
                    issues.append("config.json missing 'version' field")

            except json.JSONDecodeError:
                issues.append("config.json is not valid JSON")

        # Check index file
        index_path = self.storage_root / "rules" / "index.json"
        if not index_path.exists():
            issues.append("Missing rules/index.json")
        else:
            try:
                with open(index_path) as f:
                    index = json.load(f)

                if "version" not in index:
                    issues.append("index.json missing 'version' field")
                if "rules" not in index:
                    issues.append("index.json missing 'rules' field")

            except json.JSONDecodeError:
                issues.append("index.json is not valid JSON")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "version": self.get_current_version()
        }
