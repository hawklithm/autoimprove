#!/bin/bash
# AutoImprove Installation Script

set -e

echo "🚀 Installing AutoImprove..."
echo ""

# Check Python version
echo "Checking Python version..."
python_version=$(python3 --version 2>&1 | awk '{print $2}')
required_version="3.10"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" != "$required_version" ]; then
    echo "❌ Error: Python 3.10+ required (found $python_version)"
    exit 1
fi

echo "✅ Python $python_version"
echo ""

# Install MCP Server
echo "📦 Installing MCP Server..."
cd src/mcp-server
pip install -e . --quiet
echo "✅ MCP Server installed"
echo ""

# Install Skills
echo "📦 Installing Skills..."
skills_dir="$HOME/.claude/skills"
mkdir -p "$skills_dir"

for skill in autoimprove-status autoimprove-summarize autoimprove-rules autoimprove-lessons; do
    if [ -d "../skills/$skill" ]; then
        cp -r "../skills/$skill" "$skills_dir/"
        echo "  ✅ $skill"
    fi
done
echo ""

# Initialize storage
echo "💾 Initializing storage..."
python3 -c "from storage import init_storage; init_storage()"
echo "✅ Storage initialized at ~/.autoimprove/"
echo ""

# Show next steps
echo "✨ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Configure MCP Server in Claude Code settings"
echo "2. Add to mcpServers:"
echo ""
echo "   {\"autoimprove-core\": {"
echo "     \"command\": \"python3\","
echo "     \"args\": [\"$(pwd)/server.py\"]"
echo "   }}"
echo ""
echo "3. Run /autoimprove-status in Claude Code to verify"
echo ""
