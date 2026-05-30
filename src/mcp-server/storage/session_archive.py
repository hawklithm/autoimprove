"""
Session archive manager for AutoImprove.

Manages session data storage (sessions/{session_id}.json).
"""

import json
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime


class SessionArchive:
    """Represents archived session data."""

    def __init__(
        self,
        session_id: str,
        analyzed_at: str,
        patterns: List[Dict[str, Any]],
        generated_rules: List[str],
        metadata: Optional[Dict[str, Any]] = None
    ):
        """
        Initialize session archive.

        Args:
            session_id: Session ID
            analyzed_at: ISO timestamp when analyzed
            patterns: List of detected patterns
            generated_rules: List of rule IDs generated from this session
            metadata: Additional metadata
        """
        self.session_id = session_id
        self.analyzed_at = analyzed_at
        self.patterns = patterns
        self.generated_rules = generated_rules
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "session_id": self.session_id,
            "analyzed_at": self.analyzed_at,
            "patterns": self.patterns,
            "generated_rules": self.generated_rules,
            "metadata": self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SessionArchive":
        """Create from dictionary."""
        return cls(
            session_id=data["session_id"],
            analyzed_at=data["analyzed_at"],
            patterns=data.get("patterns", []),
            generated_rules=data.get("generated_rules", []),
            metadata=data.get("metadata", {})
        )


class SessionArchiveManager:
    """Manages session archive operations."""

    def __init__(self, storage_root: Path):
        """
        Initialize session archive manager.

        Args:
            storage_root: Path to ~/.autoimprove/
        """
        self.storage_root = storage_root
        self.sessions_dir = storage_root / "sessions"

    def _get_session_path(self, session_id: str) -> Path:
        """Get path to session archive file."""
        return self.sessions_dir / f"{session_id}.json"

    def save_session(self, archive: SessionArchive) -> None:
        """
        Save session archive to disk atomically.

        Args:
            archive: SessionArchive to save
        """
        # Ensure directory exists
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

        path = self._get_session_path(archive.session_id)

        # Write to temp file first
        temp_path = path.with_suffix('.json.tmp')
        with open(temp_path, 'w') as f:
            json.dump(archive.to_dict(), f, indent=2)

        # Atomic rename
        temp_path.replace(path)

    def load_session(self, session_id: str) -> Optional[SessionArchive]:
        """
        Load session archive from disk.

        Args:
            session_id: ID of session to load

        Returns:
            SessionArchive if found, None otherwise
        """
        path = self._get_session_path(session_id)

        if not path.exists():
            return None

        with open(path) as f:
            data = json.load(f)

        return SessionArchive.from_dict(data)

    def delete_session(self, session_id: str) -> bool:
        """
        Delete session archive.

        Args:
            session_id: ID of session to delete

        Returns:
            True if deleted, False if not found
        """
        path = self._get_session_path(session_id)

        if not path.exists():
            return False

        path.unlink()
        return True

    def list_sessions(self, limit: Optional[int] = None) -> List[str]:
        """
        List all archived session IDs.

        Args:
            limit: Optional limit on number of sessions to return

        Returns:
            List of session IDs, sorted by modification time (newest first)
        """
        if not self.sessions_dir.exists():
            return []

        # Get all session files
        session_files = list(self.sessions_dir.glob("*.json"))

        # Sort by modification time (newest first)
        session_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

        # Extract session IDs
        session_ids = [f.stem for f in session_files]

        if limit:
            session_ids = session_ids[:limit]

        return session_ids

    def get_recent_sessions(self, days: int = 7) -> List[SessionArchive]:
        """
        Get sessions from the last N days.

        Args:
            days: Number of days to look back

        Returns:
            List of SessionArchive objects
        """
        if not self.sessions_dir.exists():
            return []

        cutoff_time = datetime.utcnow().timestamp() - (days * 24 * 60 * 60)
        recent_sessions = []

        for session_file in self.sessions_dir.glob("*.json"):
            if session_file.stat().st_mtime >= cutoff_time:
                session_id = session_file.stem
                archive = self.load_session(session_id)
                if archive:
                    recent_sessions.append(archive)

        # Sort by analyzed_at (newest first)
        recent_sessions.sort(
            key=lambda s: s.analyzed_at,
            reverse=True
        )

        return recent_sessions

    def exists(self, session_id: str) -> bool:
        """
        Check if session archive exists.

        Args:
            session_id: ID of session to check

        Returns:
            True if exists, False otherwise
        """
        return self._get_session_path(session_id).exists()
