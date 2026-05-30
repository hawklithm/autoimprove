#!/bin/bash
# AutoImprove Uninstallation Script

set -e

echo "🗑️  Uninstalling AutoImprove..."
echo ""

# Remove Skills
echo "Removing Skills..."
skills_dir="$HOME/.claude/skills"

for skill in autoimprove-status autoimprove-summarize autoimprove-rules autoimprove-lessons; do
    if [ -d "$skills_dir/$skill" ]; then
        rm -rf "$skills_dir/$skill"
        echo "  ✅ Removed $skill"
    fi
done
echo ""

# Ask about storage
echo "⚠️  Storage directory: ~/.autoimprove/"
read -p "Remove storage (all rules and sessions will be deleted)? [y/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$HOME/.autoimprove"
    echo "✅ Storage removed"
else
    echo "ℹ️  Storage preserved at ~/.autoimprove/"
fi
echo ""

# Uninstall MCP Server
echo "Uninstalling MCP Server..."
cd src/mcp-server
pip uninstall -y autoimprove-mcp-server 2>/dev/null || true
echo "✅ MCP Server uninstalled"
echo ""

echo "✨ Uninstallation complete!"
echo ""
echo "Don't forget to remove AutoImprove from your Claude Code MCP configuration."
echo ""
