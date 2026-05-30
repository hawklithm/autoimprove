"""
Rule content manager for AutoImprove.

Manages individual rule content files (rules/content/rule-{id}.md).
"""

from pathlib import Path
from typing import Optional, Dict, Any
import frontmatter


class RuleContent:
    """Represents a rule's full content."""

    def __init__(
        self,
        id: str,
        content: str,
        reason: str,
        metadata: Dict[str, Any]
    ):
        """
        Initialize rule content.

        Args:
            id: Rule ID
            content: Rule content (what to do)
            reason: Why this rule exists
            metadata: Additional metadata (type, priority, scenes, etc.)
        """
        self.id = id
        self.content = content
        self.reason = reason
        self.metadata = metadata

    def to_markdown(self) -> str:
        """
        Convert to markdown format with frontmatter.

        Returns:
            Markdown string with YAML frontmatter
        """
        post = frontmatter.Post(
            f"## Content\n\n{self.content}\n\n## Reason\n\n{self.reason}",
            **self.metadata
        )
        return frontmatter.dumps(post)

    @classmethod
    def from_markdown(cls, rule_id: str, markdown: str) -> "RuleContent":
        """
        Parse from markdown format.

        Args:
            rule_id: Rule ID
            markdown: Markdown string with frontmatter

        Returns:
            RuleContent instance
        """
        post = frontmatter.loads(markdown)

        # Extract content and reason from body
        body = post.content
        content = ""
        reason = ""

        if "## Content" in body and "## Reason" in body:
            parts = body.split("## Reason")
            content = parts[0].replace("## Content", "").strip()
            reason = parts[1].strip()
        else:
            content = body

        return cls(
            id=rule_id,
            content=content,
            reason=reason,
            metadata=post.metadata
        )


class RuleContentManager:
    """Manages rule content file operations."""

    def __init__(self, storage_root: Path):
        """
        Initialize rule content manager.

        Args:
            storage_root: Path to ~/.autoimprove/
        """
        self.storage_root = storage_root
        self.content_dir = storage_root / "rules" / "content"

    def _get_content_path(self, rule_id: str) -> Path:
        """Get path to rule content file."""
        return self.content_dir / f"{rule_id}.md"

    def load_content(self, rule_id: str) -> Optional[RuleContent]:
        """
        Load rule content from disk.

        Args:
            rule_id: ID of rule to load

        Returns:
            RuleContent if found, None otherwise
        """
        path = self._get_content_path(rule_id)

        if not path.exists():
            return None

        with open(path) as f:
            markdown = f.read()

        return RuleContent.from_markdown(rule_id, markdown)

    def save_content(self, rule: RuleContent) -> None:
        """
        Save rule content to disk atomically.

        Args:
            rule: RuleContent to save
        """
        # Ensure directory exists
        self.content_dir.mkdir(parents=True, exist_ok=True)

        path = self._get_content_path(rule.id)

        # Write to temp file first
        temp_path = path.with_suffix('.md.tmp')
        with open(temp_path, 'w') as f:
            f.write(rule.to_markdown())

        # Atomic rename
        temp_path.replace(path)

    def delete_content(self, rule_id: str) -> bool:
        """
        Delete rule content file.

        Args:
            rule_id: ID of rule to delete

        Returns:
            True if deleted, False if not found
        """
        path = self._get_content_path(rule_id)

        if not path.exists():
            return False

        path.unlink()
        return True

    def exists(self, rule_id: str) -> bool:
        """
        Check if rule content file exists.

        Args:
            rule_id: ID of rule to check

        Returns:
            True if exists, False otherwise
        """
        return self._get_content_path(rule_id).exists()
