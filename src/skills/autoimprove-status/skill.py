"""
AutoImprove Status Skill

Shows system status and statistics.
"""

import json
from pathlib import Path


def run():
    """Execute the status skill."""
    try:
        # Call MCP server health check
        result = call_mcp_tool("health_check", {})

        if not result.get("success"):
            print("❌ AutoImprove system is not healthy")
            print(f"Error: {result.get('error', 'Unknown error')}")
            return

        storage = result.get("storage", {})

        if not storage.get("initialized"):
            print("👋 Welcome to AutoImprove!")
            print("\nAutoImprove learns from your coding patterns and generates reusable rules.")
            print("\nInitializing storage...")

            # Initialize storage
            from storage import init_storage
            init_result = init_storage()

            print(f"✅ Storage initialized at: {init_result['root']}")
            print("\nNext steps:")
            print("1. Complete a coding session with Claude Code")
            print("2. Run `/autoimprove-summarize` to analyze the session")
            print("3. Review and activate generated rules with `/autoimprove-rules`")
            return

        # Show status
        print("📊 AutoImprove Status\n")
        print(f"Storage: {storage['root']}")
        print(f"Rules: {storage['rule_count']}")
        print(f"Sessions analyzed: {storage['session_count']}")
        print(f"Storage size: {storage['total_size_mb']} MB")

        if storage['rule_count'] == 0:
            print("\n💡 No rules yet. Run `/autoimprove-summarize` after a session to start learning.")
        else:
            # Show recent activity
            print("\n📈 Recent Activity:")

            # Get scenes
            scenes_result = call_mcp_tool("list_scenes", {})
            if scenes_result.get("success"):
                tech = scenes_result.get("tech", {})
                if tech:
                    print(f"  Tech stacks: {', '.join(list(tech.keys())[:5])}")

                functional = scenes_result.get("functional", {})
                if functional:
                    print(f"  Domains: {', '.join(list(functional.keys())[:5])}")

        print("\n✨ System is healthy and ready")

    except Exception as e:
        print(f"❌ Error: {e}")


def call_mcp_tool(tool_name: str, params: dict):
    """Call MCP tool (placeholder - would use actual MCP client)."""
    # In production, this would use the MCP client to call the server
    # For now, return mock data
    if tool_name == "health_check":
        from storage import get_storage_info
        retur     "success": True,
            "status": "healthy",
            "storage": get_storage_info()
        }
    elif tool_name == "list_scenes":
        # Would call actual MCP tool
        return {"success": True, "tech": {}, "functional": {}, "business": {}}

    return {"success": False, "error": "Tool not implemented"}


if __name__ == "__main__":
    run()
