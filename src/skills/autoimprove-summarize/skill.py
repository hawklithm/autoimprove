"""
AutoImprove Summarize Skill

Analyzes completed session and generates summary with learned patterns.
"""

import json
from pathlib import Path
import os


def run():
    """Execute the summarize skill."""
    try:
        print("🔍 Analyzing session...\n")

        # Detect current session file
        session_file = detect_session_file()

        if not session_file:
            print("❌ Could not find session file")
            print("\n💡 Tip: Run this command after completing a coding session")
            return

        print(f"📄 Session: {session_file.name}\n")

        # Analyze session
        result = call_mcp_tool("analyze_session", {
            "session_file_path": str(session_file)
        })

        if not result.get("success"):
            print(f"❌ Analysis failed: {result.get('error')}")
            return

        patterns = result.get("patterns", [])
        patterns_count = result.get("patterns_count", 0)

        if patterns_count == 0:
            print("✨ No new patterns detected in this session")
            print("\nThis could mean:")
            print("  • The session was exploratory (no corrections needed)")
            print("  • Patterns were too weak to generate rules")
            print("  • You're already following best practices!")
            return

        # Show summary
        print(f"✅ Found {patterns_count} pattern(s)\n")

        # Group by type
        by_type = {}
        for pattern in patterns:
            ptype = pattern.get("type", "unknown")
            if ptype not in by_type:
                by_type[ptype] = []
            by_type[ptype].append(pattern)

        # Show patterns
        for ptype, plist in by_type.items():
            print(f"📌 {ptype.replace('-', ' ').title()} ({len(plist)})")
            for p in plist[:3]:  # Show first 3
                desc = p.get("description", "")[:80]
                conf = p.get("confidence", 0)
                print(f"   • {desc}... (confidence: {conf:.2f})")
            if len(plist) > 3:
                print(f"   ... and {len(plist) - 3} more")
            print()

        # Generate rules
        print("🎯 Generating rules...\n")

        # Detect scene
        scene = detect_scene(session_file)

        rules_result = call_mcp_tool("generate_rules", {
            "patterns_json": json.dumps(patterns),
            "scene_json": json.dumps(scene) if scene else None
        })

        if not rules_result.get("success"):
            print(f"❌ Rule generation failed: {rules_result.get('error')}")
            return

        rule_ids = rules_result.get("rule_ids", [])
        print(f"✅ Generated {len(rule_ids)} rule(s)")

        if rule_ids:
            print("\n📋 Rules created:")
            for rid in rule_ids:
                print(f"   • {rid}")

            print("\n💡 Next step: Run `/autoimprove-rules` to review and activate these rules")

    except Exception as e:
        print(f"❌ Error: {e}")


def detect_session_file() -> Path:
    """Detect current session file."""
    # Look for session files in Claude Code directory
    # This is a simplified version - production would use actual Claude Code API
    claude_dir = Path.home() / ".claude" / "projects"

    if not claude_dir.exists():
        return None

    # Find most recent session file
    session_files = list(claude_dir.rglob("*.jsonl"))
    if not session_files:
        return None

    # Return most recently modified
    return max(session_files, key=lambda p: p.stat().st_mtime)


def detect_scene(session_file: Path) -> dict:
    """Detect scene from session file."""
    # Simplified scene detection
    # Production would analyze file paths from session
    return {
        "tech": [],
        "functional": [],
        "business": []
    }


def call_mcp_tool(tool_name: str, params: dict):
    """Call MCP tool."""
    # Placeholder - would use actual MCP client
    if tool_name == "analyze_session":
        # Mock response
        return {
            "success": True,
            "patterns_count": 0,
            "patterns": []
        }
    elif tool_name == "generate_rules":
        return {
            "success": True,
            "rules_count": 0,
            "rule_ids": []
        }

    return {"success": False, "error": "Not implemented"}


if __name__ == "__main__":
    run()
