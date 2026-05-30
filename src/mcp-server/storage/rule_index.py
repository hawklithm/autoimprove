"""
Rule index manager for AutoImprove.

Manages the lightweight index file (rules/index.json) for fast rule loading.
"""

import json
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field


class RuleIndexEntry(BaseModel):
    """Metadata entry in the rule index."""
    id: str
    type: str  # pattern type
    priority: str  # critical, high, medium, low
    confidence: float
    scenes: Dict[str, List[str]] = Field(default_factory=dict)  # {tech: [], functional: [], business: []}
    keywords: List[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class RuleIndex(BaseModel):
    """Rule index structure."""
    version: str = "1.0"
    rules: List[RuleIndexEntry] = Field(default_factory=list)


class RuleIndexManager:
    """Manages rule index operations."""

    def __init__(self, storage_root: Path):
        """
        Initialize rule index manager.

        Args:
            storage_root: Path to ~/.autoimprove/
        """
        self.storage_root = storage_root
        self.index_path = storage_root / "rules" / "index.json"

    def load_index(self) -> RuleIndex:
        """
        Load rule index from disk.

        Returns:
            RuleIndex instance
        """
        if not self.index_path.exists():
            return RuleIndex()

        with open(self.index_path) as f:
            data = json.load(f)

        return RuleIndex(**data)

    def save_index(self, index: RuleIndex) -> None:
        """
        Save rule index to disk atomically.

        Args:
            index: RuleIndex to save
        """
        # Ensure directory exists
        self.index_path.parent.mkdir(parents=True, exist_ok=True)

        # Write to temp file first
        temp_path = self.index_path.with_suffix('.json.tmp')
        with open(temp_path, 'w') as f:
            json.dump(index.model_dump(), f, indent=2)

        # Atomic rename
        temp_path.replace(self.index_path)

    def add_rule(self, entry: RuleIndexEntry) -> None:
        """
        Add a new rule to the index.

        Args:
            entry: Rule index entry to add
        """
        index = self.load_index()

        # Check if rule ID already exists
        if any(r.id == entry.id for r in index.rules):
            raise ValueError(f"Rule with ID {entry.id} already exists")

        index.rules.append(entry)
        self.save_index(index)

    def update_rule(self, rule_id: str, updates: Dict[str, Any]) -> None:
        """
        Update an existing rule in the index.

        Args:
            rule_id: ID of rule to update
            updates: Dictionary of fields to update
        """
        index = self.load_index()

        # Find rule
        rule = None
        for r in index.rules:
            if r.id == rule_id:
                rule = r
                break

        if rule is None:
            raise ValueError(f"Rule with ID {rule_id} not found")

        # Update fields
        for key, value in updates.items():
            if hasattr(rule, key):
                setattr(rule, key, value)

        # Update timestamp
        rule.updated_at = datetime.utcnow().isoformat() + 'Z'

        self.save_index(index)

    def remove_rule(self, rule_id: str) -> None:
        """
        Remove a rule from the index.

        Args:
            rule_id: ID of rule to remove
        """
        index = self.load_index()

        # Filter out the rule
        original_count = len(index.rules)
        index.rules = [r for r in index.rules if r.id != rule_id]

        if len(index.rules) == original_count:
            raise ValueError(f"Rule with ID {rule_id} not found")

        self.save_index(index)

    def get_rule(self, rule_id: str) -> Optional[RuleIndexEntry]:
        """
        Get a rule entry by ID.

        Args:
            rule_id: ID of rule to get

        Returns:
            RuleIndexEntry if found, None otherwise
        """
        index = self.load_index()

        for rule in index.rules:
            if rule.id == rule_id:
                return rule

        return None

    def list_rules(
        self,
        type_filter: Optional[str] = None,
        priority_filter: Optional[str] = None,
        min_confidence: Optional[float] = None
    ) -> List[RuleIndexEntry]:
        """
        List rules with optional filters.

        Args:
            type_filter: Filter by pattern type
            priority_filter: Filter by priority
            min_confidence: Filter by minimum confidence

        Returns:
            List of matching rule entries
        """
        index = self.load_index()
        rules = index.rules

        if type_filter:
            rules = [r for r in rules if r.type == type_filter]

        if priority_filter:
            rules = [r for r in rules if r.priority == priority_filter]

        if min_confidence is not None:
            rules = [r for r in rules if r.confidence >= min_confidence]

        return rules

    def get_next_rule_id(self) -> str:
        """
        Generate next sequential rule ID.

        Returns:
            Rule ID in format "rule-NNN"
        """
        index = self.load_index()

        if not index.rules:
            return "rule-001"

        # Extract numeric IDs
        max_num = 0
        for rule in index.rules:
            if rule.id.startswith("rule-"):
                try:
                    num = int(rule.id.split("-")[1])
                    max_num = max(max_num, num)
                except (IndexError, ValueError):
                    pass

        return f"rule-{max_num + 1:03d}"
