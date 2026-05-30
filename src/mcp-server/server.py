"""
AutoImprove MCP Server

FastMCP-based server providing tools and resources for AutoImprove.
"""

from fastmcp import FastMCP
from pathlib import Path
from typing import Optional, List, Dict, Any
import json

from storage import init_storage, get_storage_root, get_storage_info
from storage.rule_index import RuleIndexManager
from storage.rule_content import RuleContentManager
from storage.session_archive import SessionArchiveManager, SessionArchive
from core.session_analyzer import SessionAnalyzer
from core.rule_generator import RuleGenerator
from core.scene_detector import SceneDetector
from core.rule_matcher import RuleMatcher
from core.logging import setup_logging, get_logger


# Initialize MCP server
mcp = FastMCP("autoimprove-core")

# Initialize logger
logger = setup_logging(level="INFO")

# Initialize storage managers (lazy initialization)
_storage_root: Optional[Path] = None
_index_manager: Optional[RuleIndexManager] = None
_content_manager: Optional[RuleContentManager] = None
_session_manager: Optional[SessionArchiveManager] = None
_analyzer: Optional[SessionAnalyzer] = None
_generator: Optional[RuleGenerator] = None
_scene_detector: Optional[SceneDetector] = None
_matcher: Optional[RuleMatcher] = None


def _ensure_initialized():
    """Ensure storage and managers are initialized."""
    global _storage_root, _index_manager, _content_manager, _session_manager
    global _analyzer, _generator, _scene_detector, _matcher

    if _storage_root is None:
        _storage_root = get_storage_root()

        # Initialize storage if needed
        if not _storage_root.exists():
            init_storage()

        _index_manager = RuleIndexManager(_storage_root)
        _content_manager = RuleContentManager(_storage_root)
        _session_manager = SessionArchiveManager(_storage_root)
        _analyzer = SessionAnalyzer()
        _generator = RuleGenerator()
        _scene_detector = SceneDetector()
        _matcher = RuleMatcher(_index_manager)

    return (
        _storage_root,
        _index_manager,
        _content_manager,
        _session_manager,
        _analyzer,
        _generator,
        _scene_detector,
        _matcher
    )


# ============================================================================
# Tools
# ============================================================================

@mcp.tool()
def analyze_session(session_file_path: str) -> Dict[str, Any]:
    """
    Analyze a Claude Code session file and detect patterns.

    Args:
        session_file_path: Path to session JSONL file

    Returns:
        Dictionary with detected patterns and statistics
    """
    try:
        logger.info(f"Analyzing session: {session_file_path}")

        _, _, _, _, analyzer, _, _, _ = _ensure_initialized()

        session_path = Path(session_file_path)
        if not session_path.exists():
            return {         "success": False,
                "error": f"Session file not found: {session_file_path}"
            }

        # Analyze session
        patterns = analyzer.analyze_session(session_path)

        # Convert patterns to dict
        patterns_data = [p.to_dict() for p in patterns]

        logger.info(f"Found {len(patterns)} patterns")

        return {
            "success": True,
            "session_id": session_path.stem,
            "patterns_count": len(patterns),
            "patterns": patterns_data
        }

    except Exception as e:
        logger.error(f"Error analyzing session: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@mcp.tool()
def generate_rules(patterns_json: str, scene_json: Optional[str] = None) -> Dict[str, Any]:
    """
    Generate rules from detected patterns.

    Args:
        patterns_json: JSON string of patterns array
        scene_json: Optional JSON string of scene context

    Returns:
        Dictionary with generated rules
    """
    try:
        logger.info("Generating rules from patterns")

        storage_root, index_manager, content_manager, _, _, generator, _, _ = _ensure_initialized()

        # Parse patterns
        patterns_data = json.loads(patterns_json)
        from core.models import Pattern
        patterns = [Pattern.from_dict(p) for p in patterns_data]

        # Parse scene if provided
        scene = None
        if scene_json:
            from core.models import Scene
            scene = Scene.from_dict(json.loads(scene_json))

        # Get next rule ID
        next_id_num = int(index_manager.get_next_rule_id().split('-')[1])

        # Generate rules
        rules = generator.batch_generate_rules(patterns, start_id=next_id_num, scene=scene)

        # Save rules
        generated_ids = []
        for index_entry, content in rules:
            index_manager.add_rule(index_entry)
            content_manager.save_content(content)
            generated_ids.append(index_entry.id)

        logger.info(f"Generated {len(generated_ids)} rules")

        return {
            "success": True,
            "rules_count": len(generated_ids),
            "rule_ids": generated_ids
        }

    except Exception as e:
        logger.error(f"Error generating rules: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@mcp.tool()
def search_knowledge(
    scene_json: Optional[str] = None,
    keywords: Optional[str] = None,
    rule_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Search rules by scene, keywords, or ID.

    Args:
        scene_json: Optional JSON string of scene to match
        keywords: Optional comma-separated keywords
        rule_id: Optional specific rule ID

    Returns:
        Dictionary with matched rules
    """
    try:
        logger.info("Searching knowledge base")

        _, index_manager, content_manager, _, _, _, _, matcher = _ensure_initialized()

        # Search by ID
        if rule_id:
            rule = index_manager.get_rule(rule_id)
            if rule:
                content = content_manager.load_content(rule_id)
                return {
                    "success": True,
                    "matches_count": 1,
                    "matches": [{
                        "rule": rule.model_dump(),
                        "content": content.to_markdown() if content else None
                    }]
                }
            else:
                return {
                    "success": False,
                    "error": f"Rule not found: {rule_id}"
                }

        # Search by scene
        if scene_json:
            from core.models import Sce      scene = Scene.from_dict(json.loads(scene_json))

            kw_list = keywords.split(',') if keywords else None
            matches = matcher.match_rules(scene, kw_list)

            return {
                "success": True,
                "matches_count": len(matches),
                "matches": [
                    {
                        "rule": m.rule.model_dump(),
                        "relevance": m.relevance_score,
                        "reason": m.match_reason
                    }
                    for m in matches
                ]
            }

        # List all rules
        rules = index_manager.list_rules()
        return {
            "success": True,
            "matches_count": len(rules),
            "matches": [{"rule": r.model_dump()} for r in rules]
        }

    except Exception as e:
        logger.error(f"Error searching knowledge: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@mcp.tool()
def update_rules(rule_id: str, updates_json: str) -> Dict[str, Any]:
    """
    Update an existing rule.

    Args:
        rule_id: ID of rule to update
        updates_json: JSON string of fields to update

    Returns:
        Dictionary with update status
    """
    try:
        logger.info(f"Updating rule: {rule_id}")

        _, index_manager, content_manager, _, _, _, _, matcher = _ensure_initialized()

        updates = json.loads(updates_json)

        # Update index
        if any(k in updates for k in ['priority', 'confidence', 'scenes', 'keywords']):
            index_updates = {
                k: v for k, v in updates.items()
                if k in ['priority', 'confidence', 'scenes', 'keywords']
            }
            index_manager.update_rule(rule_id, index_updates)

        # Update content
        if 'content' in updates or 'reason' in updates:
            content = content_manager.load_content(rule_id)
            if content:
                if 'content' in updates:
                    content.content = updates['content']
                if 'reason' in updates:
                    content.reason = updates['reason']
                content_manager.save_content(content)

        # Invalidate matcher cache
        matcher.invalidate_cache()

        logger.info(f"Updated rule: {rule_id}")

        return {
            "success": True,
            "rule_id": rule_id
        }

    except Exception as e:
        logger.error(f"Error updating rule: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@mcp.tool()
def list_scenes() -> Dict[str, Any]:
    """
    List all known scenes from rules and sessions.

    Returns:
        Dictionary with unique scenes and usage counts
    """
    try:
        logger.info("Listing scenes")

        _, index_manager, _, _, _, _, _, _ = _ensure_initialized()

        rules = index_manager.list_rules()

        # Collect all scenes
        tech_counts: Dict[str, int] = {}
        functional_counts: Dict[str, int] = {}
        business_counts: Dict[str, int] = {}

        for rule in rules:
            if rule.scenes:
                from core.models import Scene
                scene = Scene.from_dict(rule.scenes)

                for tech in scene.tech:
                    tech_counts[tech] = tech_counts.get(tech, 0) + 1
                for func in scene.functional:
                    functional_counts[func] = functional_counts.get(func, 0) + 1
                for biz in scene.business:
                    business_counts[biz] = business_counts.get(biz, 0) + 1

        return {
            "success": True,
            "tech": tech_counts,
            "functional": functional_counts,
            "business": business_counts
        }

    except Exception as e:
        logger.error(f"Error listing scenes: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


# ============================================================================
# Resources
# ============================================================================

@mcp.resource("knowledge://rules/{rule_id}")
def get_rule_resource(rule_id: str) -> str:
    """
    Get full rule content as markdown.

    Args:
        rule_id: Rule ID

    Returns:
        Rule content in markdown format
    """
    try:
        _, _, content_manager, _, _, _, _, _ = _ensure_initialized()

        content = content_manager.load_content(rule_id)
        if content:
            return content.to_markdown()
        else:
            return f"# Rule not found: {rule_id}"

    except Exception as e:
        logger.error(f"Error loading rule resource: {e}", exc_info=True)
        return f"# Error loading rule: {str(e)}"


@mcp.resource("knowledge://lessons/{scene}")
def get_lessons_resource(scene: str) -> str:
    """
    Get all rules applicable to a scene.

    Args:
        scene: Scene identifier (e.g., "react-auth")

    Returns:
        Markdown with applicable rules
    """
    try:
        _, index_manager, content_manager, _, _, _, _, matcher = _ensure_initialized()

        # Parse scene identifier
        parts = scene.split('-')
        from core.models import Scene
        scene_obj = Scene(tech=[parts[0]] if len(parts) > 0 else [],
                         functional=[parts[1]] if len(parts) > 1 else [],
                         business=[])

        # Match rules
        matches = matcher.match_rules(scene_obj)

        if not matches:
            return f"# No lessons found for scene: {scene}"

        # Build markdown
        lines = [f"# Lessons for {scene}\n"]

        for match in matches:
            rule = match.rule
            content = content_manager.load_content(rule.id)

            lines.append(f"## {rule.id} ({rule.priority})")
            lines.append(f"**Confidence**: {rule.confidence:.2f}")
            lines.append(f"**Relevance**: {match.relevance_score:.2f} ({match.match_reason})")

            if content:
                lines.append(f"\n{content.content}\n")
                lines.append(f"**Reason**: {content.reason}\n")

        return '\n'.join(lines)

    except Exception as e:
        logger.error(f"Error loading lessons resource: {e}", exc_info=True)
        return f"# Error loading lessons: {str(e)}"


# ============================================================================
# Health Check
# ============================================================================

@mcp.tool()
def health_check() -> Dict[str, Any]:
    """
    Check server health and storage status.

    Returns:
        Dictionary with health status
    """
    try:
        storage_info = get_storage_info()

        return {
            "success": True,
            "status": "healthy",
            "storage": storage_info
        }

    except Exception as e:
        logger.error(f"Health check failed: {e}", exc_info=True)
        return {
            "success": False,
            "status": "unhealthy",
            "error": str(e)
        }


# ============================================================================
# Server Entry Point
# ============================================================================

if __name__ == "__main__":
    logger.info("Starting AutoImprove MCP Server")
    mcp.run()
