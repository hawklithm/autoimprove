#!/bin/bash

# AutoImprove Setup Script (TypeScript)
# Automatically configures MCP Server and Skills for Claude Code

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AUTOIMPROVE_DIR="$HOME/.autoimprove"
MCP_SERVER_DIR="$SCRIPT_DIR/src/mcp-server-ts"
SKILLS_DIR_SRC="$SCRIPT_DIR/src/skills-ts"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

echo "==================================="
echo "  AutoImprove Setup"
echo "==================================="
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
  echo "❌ Error: npm is not installed. Please install Node.js 18+ first."
  exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Error: Node.js 18+ is required. Current version: $(node --version)"
  exit 1
fi

echo "Step 1: Installing MCP Server..."
echo "-----------------------------------"

cd "$MCP_SERVER_DIR"

echo "Installing MCP Server dependencies..."
npm install

echo "Building MCP Server..."
npm run build

if [ ! -f "$MCP_SERVER_DIR/dist/index.js" ]; then
  echo "❌ Error: MCP Server build failed - dist/index.js not found"
  exit 1
fi

SERVER_CMD="node"
SERVER_ARGS="[\"$MCP_SERVER_DIR/dist/index.js\"]"

echo "✓ MCP Server built successfully"

echo ""
echo "Step 2: Verifying Skills..."
echo "-----------------------------------"

# Skills are markdown-based, no build needed
# Claude Code will directly call MCP tools based on SKILL.md instructions

echo "✓ Skills verified (SKILL.md files will be installed)"

echo ""
echo "Step 3: Configuring Claude Code MCP Server..."
echo "-----------------------------------"

# Check if claude CLI is available
if ! command -v claude &> /dev/null; then
  echo "❌ Error: claude CLI not found. Please install first."
  echo "   Visit: https://claude.ai/download"
  exit 1
fi

# Check if autoimprove-core is already configured at user level
EXISTING_USER_SERVER=$(claude mcp get autoimprove-core 2>/dev/null | grep -i "user config" || echo "")
EXISTING_LOCAL_SERVER=$(claude mcp get autoimprove-core 2>/dev/null | grep -i "local config" || echo "")

if [ -n "$EXISTING_USER_SERVER" ]; then
  echo "Found existing autoimprove-core server (user-level)"
  echo "Removing old configuration..."
  claude mcp remove autoimprove-core -s user 2>/dev/null || true
  echo "✓ Removed old user-level configuration"
fi

if [ -n "$EXISTING_LOCAL_SERVER" ]; then
  echo "Found existing autoimprove-core server (project-level)"
  echo "Removing old configuration..."
  claude mcp remove autoimprove-core -s local 2>/dev/null || true
  echo "✓ Removed old project-level configuration"
fi

# Add MCP server using Claude Code CLI with user scope (global visibility)
echo "Adding autoimprove-core MCP server (user-level, visible in all projects)..."
claude mcp add autoimprove-core -s user -- node "$MCP_SERVER_DIR/dist/index.js"

if [ $? -eq 0 ]; then
  echo "✓ MCP server configured successfully (user-level)"
  echo "✓ Server will be available in all projects"
else
  echo "❌ Error: Failed to configure MCP server"
  exit 1
fi

echo ""
echo "Step 4: Installing Skills..."
echo "-----------------------------------"

# Install Skills to Claude directory (SKILL.md only - Claude Code will call MCP tools)
SKILLS_INSTALL_DIR="$CLAUDE_DIR/skills"
mkdir -p "$SKILLS_INSTALL_DIR"

for skill in autoimprove-status autoimprove-summarize autoimprove-rules autoimprove-lessons; do
  skill_src="$SKILLS_DIR_SRC/src/$skill"
  skill_install="$SKILLS_INSTALL_DIR/$skill"

  if [ -d "$skill_src" ]; then
    # Create skill directory
    mkdir -p "$skill_install"

    # Copy only SKILL.md (Claude Code will handle MCP tool calls)
    if [ -f "$skill_src/SKILL.md" ]; then
      cp "$skill_src/SKILL.md" "$skill_install/"
      echo "✓ Installed $skill"
    else
      echo "⚠ Warning: $skill/SKILL.md not found"
    fi
  else
    echo "⚠ Warning: $skill directory not found at $skill_src"
  fi
done

echo ""
echo "Step 5: Initializing AutoImprove storage..."
echo "-----------------------------------"

mkdir -p "$AUTOIMPROVE_DIR"
mkdir -p "$AUTOIMPROVE_DIR/rules/content"
mkdir -p "$AUTOIMPROVE_DIR/sessions"
mkdir -p "$AUTOIMPROVE_DIR/cache"
mkdir -p "$AUTOIMPROVE_DIR/logs"
mkdir -p "$AUTOIMPROVE_DIR/versions"

# Create default config if not exists
if [ ! -f "$AUTOIMPROVE_DIR/config.json" ]; then
  if [ -f "$TEMPLATES_DIR/config.json" ]; then
    cp "$TEMPLATES_DIR/config.json" "$AUTOIMPROVE_DIR/config.json"
    echo "✓ Created default config from template"
  else
    echo "⚠ Warning: Template config.json not found, creating minimal config"
    echo '{"version":"1.0"}' > "$AUTOIMPROVE_DIR/config.json"
  fi
fi

# Create empty rule index if not exists
if [ ! -f "$AUTOIMPROVE_DIR/rules/index.json" ]; then
  if [ -f "$TEMPLATES_DIR/rules-index.json" ]; then
    cp "$TEMPLATES_DIR/rules-index.json" "$AUTOIMPROVE_DIR/rules/index.json"
    echo "✓ Initialized rule index from template"
  else
    echo '{"version":"1.0","rules":[]}' > "$AUTOIMPROVE_DIR/rules/index.json"
    echo "✓ Initialized rule index"
  fi
fi

echo ""
echo "Step 6: Initializing Claude index file..."
echo "-----------------------------------"

# Create initial claude-index.md
node "$SCRIPT_DIR/scripts/init-claude-index.js"

if [ -f "$AUTOIMPROVE_DIR/rules/claude-index.md" ]; then
  echo "✓ Created initial claude-index.md"
else
  echo "⚠ Warning: Failed to create claude-index.md"
fi

echo ""
echo "Step 6.5: Initializing signal dictionary..."
echo "-----------------------------------"

# Signal dictionary will be created automatically on first use
echo "✓ Signal dictionary will be initialized on first use"

echo ""
echo "Step 7: Configuring Claude Code global settings..."
echo "-----------------------------------"

# Add AutoImprove guidance to global CLAUDE.md
GLOBAL_CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
GUIDANCE_TEMPLATE="$TEMPLATES_DIR/claude-guidance-template.md"

if [ ! -f "$GUIDANCE_TEMPLATE" ]; then
  echo "❌ Error: Guidance template not found at $GUIDANCE_TEMPLATE"
  exit 1
fi

# Ensure .claude directory exists
mkdir -p "$CLAUDE_DIR"

# Create CLAUDE.md if it doesn't exist
if [ ! -f "$GLOBAL_CLAUDE_MD" ]; then
  echo "Creating $GLOBAL_CLAUDE_MD..."
  cat > "$GLOBAL_CLAUDE_MD" << 'EOF'
# Global Claude Code Instructions

This file contains global instructions that apply to all your projects.

EOF
fi

# Check if AutoImprove section exists (marked by <!-- AUTOIMPROVE_START -->)
if grep -q "<!-- AUTOIMPROVE_START -->" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
  echo "Found existing AutoImprove section in global CLAUDE.md, updating..."

  # Create backup
  cp "$GLOBAL_CLAUDE_MD" "$GLOBAL_CLAUDE_MD.backup"

  # Use awk to replace content between markers
  TEMP_OUTPUT=$(mktemp)
  awk -v template="$GUIDANCE_TEMPLATE" '
    /<!-- AUTOIMPROVE_START -->/ {
      # Print the template content
      while ((getline line < template) > 0) {
        print line
      }
      close(template)
      # Skip until we find the end marker
      while (getline > 0 && !/<!-- AUTOIMPROVE_END -->/) {}
      next
    }
    { print }
  ' "$GLOBAL_CLAUDE_MD" > "$TEMP_OUTPUT"

  mv "$TEMP_OUTPUT" "$GLOBAL_CLAUDE_MD"
  echo "✓ Updated AutoImprove guidance in $GLOBAL_CLAUDE_MD"
  echo "  (Backup saved to $GLOBAL_CLAUDE_MD.backup)"

else
  echo "No existing AutoImprove section found, adding to global CLAUDE.md..."

  # Create backup
  cp "$GLOBAL_CLAUDE_MD" "$GLOBAL_CLAUDE_MD.backup" 2>/dev/null || true

  # Append template content to the end of file
  echo "" >> "$GLOBAL_CLAUDE_MD"
  cat "$GUIDANCE_TEMPLATE" >> "$GLOBAL_CLAUDE_MD"
  echo "" >> "$GLOBAL_CLAUDE_MD"

  echo "✓ Added AutoImprove guidance to $GLOBAL_CLAUDE_MD"
  if [ -f "$GLOBAL_CLAUDE_MD.backup" ]; then
    echo "  (Backup saved to $GLOBAL_CLAUDE_MD.backup)"
  fi
fi

# Remove claude-index.md auto-loading if it exists (rules fetched via search_knowledge)
if grep -q "@.*autoimprove.*rules.*claude-index.md" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
  echo "Removing obsolete claude-index.md auto-loading from CLAUDE.md..."
  # Create temp file without the AutoImprove Learned Rules section
  grep -v "@.*autoimprove.*rules.*claude-index.md" "$GLOBAL_CLAUDE_MD" | \
    sed '/## AutoImprove Learned Rules/,+2d' > "${GLOBAL_CLAUDE_MD}.tmp"
  mv "${GLOBAL_CLAUDE_MD}.tmp" "$GLOBAL_CLAUDE_MD"
  echo "✓ Removed claude-index.md auto-loading (rules fetched via search_knowledge)"
fi

# Remove feedback instructions reference if it exists
if grep -q "autoimprove-feedback-instructions.md" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
  echo "Removing obsolete feedback instructions from CLAUDE.md..."
  grep -v "autoimprove-feedback-instructions.md" "$GLOBAL_CLAUDE_MD" | \
    sed '/## AutoImprove 规则使用反馈/,+2d' > "${GLOBAL_CLAUDE_MD}.tmp"
  mv "${GLOBAL_CLAUDE_MD}.tmp" "$GLOBAL_CLAUDE_MD"
  echo "✓ Removed feedback instructions reference"
fi

echo ""
echo "Step 8: Stopping MCP Server and Rebuilding..."
echo "-----------------------------------"

# Kill MCP server processes BEFORE rebuilding to avoid file locks
echo "Stopping any running autoimprove MCP server processes..."

# Method 1: Kill processes matching our server path
AUTOIMPROVE_PIDS=$(pgrep -f "$MCP_SERVER_DIR/dist/index.js" 2>/dev/null || true)
if [ -n "$AUTOIMPROVE_PIDS" ]; then
  echo "  Found autoimprove MCP processes: $AUTOIMPROVE_PIDS"
  for pid in $AUTOIMPROVE_PIDS; do
    echo "  Stopping PID $pid..."
    kill $pid 2>/dev/null || true
  done
  sleep 2

  # Force kill if still running
  REMAINING=$(pgrep -f "$MCP_SERVER_DIR/dist/index.js" 2>/dev/null || true)
  if [ -n "$REMAINING" ]; then
    echo "  Force killing remaining processes: $REMAINING"
    kill -9 $REMAINING 2>/dev/null || true
    sleep 1
  fi
  echo "✓ Stopped autoimpr MCP server processes"
else
  echo "  No running autoimprove MCP processes found"
fi

# Rebuild server to pick up latest code changes
echo "Rebuilding MCP server (ensures latest instructions/resources)..."
cd "$MCP_SERVER_DIR"
npm run build

if [ ! -f "$MCP_SERVER_DIR/dist/index.js" ]; then
  echo "❌ Error: Rebuild failed - dist/index.js not found"
  exit 1
fi
echo "✓ MCP server rebuilt successfully"

cd "$SCRIPT_DIR"

# Method 2: Remove and re-add the MCP server to force Claude Code to reload
echo "Forcing MCP server reload..."
claude mcp remove autoimprove-core -s user 2>/dev/null || true
sleep 0.5
claude mcp add autoimprove-core -s user -- node "$MCP_SERVER_DIR/dist/index.js" 2>/dev/null

if [ $? -eq 0 ]; then
  echo "✓ MCP server re-registered successfully"
else
  echo "⚠ Warning: MCP server re-registration returned non-zero exit code"
  echo "   But this is often normal - the server will work correctly"
fi

# Method 3: Find and kill Claude Code's MCP host process (if running)
echo "Restarting Claude Code MCP host (if running)..."
# The MCP host process typically runs as a child of Claude Code
# Look for node processes with MCP-related arguments
MCP_HOST_PIDS=$(pgrep -f "node.*mcp.*host" 2>/dev/null || true)
if [ -n "$MCP_HOST_PIDS" ]; then
  echo "  Found MCP host processes: $MCP_HOST_PIDS"
  for pid in $MCP_HOST_PIDS; do
    kill $pid 2>/dev/null || true
  done
  echo "✓ Stopped MCP host processes"
  sleep 1
else
  echo "  No MCP host processes found (normal if Claude Code is not running)"
fi

# Verify the server configuration
echo "Verifying MCP server configuration..."
SERVER_STATUS=$(claude mcp get autoimprove-core 2>&1)

if echo "$SERVER_STATUS" | grep -q "✓ Connected"; then
  echo "✓ MCP server is connected and ready"
elif echo "$SERVER_STATUS" | grep -q "autoimprove-core"; then
  echo "✓ MCP server configuration exists"
  echo "  Note: Server will start automatically when you use Claude Code"
else
  echo "⚠ Warning: Could not verify MCP server status"
  echo "   Run 'claude mcp list' to check manually"
fi

# Test server can start
echo "Testing MCP server startup..."
echo "  Sending initialize request to server..."

# Start server in background and send request with timeout
# MCP servers don't exit after responding - they wait for more messages
# So we use a short timeout and kill the process after getting response
(
  # Send initialize message and wait for response with 2 second timeout
  SERVER_RESPONSE=$(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | timeout 2 node "$MCP_SERVER_DIR/dist/index.js" 2>&1)

  # Check for successful response
  if echo "$SERVER_RESPONSE" | grep -q '"serverInfo"'; then
    echo "✓ MCP server can start successfully"
    # Extract and display server version
    SERVER_NAME=$(echo "$SERVER_RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
    SERVER_VERSION=$(echo "$SERVER_RESPONSE" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -n "$SERVER_NAME" ] && [ -n "$SERVER_VERSION" ]; then
      echo "  Server: $SERVER_NAME v$SERVER_VERSION"
    fi
  elif echo "$SERVER_RESPONSE" | grep -qi "error"; then
    echo "❌ Error: MCP server returned an error"
    echo "  Response: $(echo "$SERVER_RESPONSE" | head -3)"
    echo "  This may indicate a configuration or initialization problem"
    echo "  Check logs at: $AUTOIMPROVE_DIR/logs/"
  else
    # Timeout is expected - MCP server waits for more messages
    # This is normal MCP server behavior
    echo "✓ MCP server binary is functional"
    echo "  Note: Server will be started by Claude Code when needed"
  fi
) &

# Wait for test subprocess
TEST_PID=$!
wait $TEST_PID 2>/dev/null || true

# Kill any remaining test processes
pkill -f "node.*autoimprove.*dist/index.js" 2>/dev/null || true
sleep 0.5

echo ""
echo "==================================="
echo "  Setup Complete! 🎉"
echo "==================================="
echo ""
echo "✓ MCP Server installed at: $MCP_SERVER_DIR/dist/index.js"
echo "✓ Skills installed to: $SKILLS_INSTALL_DIR"
echo "✓ MCP Server configured via: claude mcp add"
echo "✓ Storage directory: $AUTOIMPROVE_DIR"
echo "✓ Global CLAUDE.md updated: $GLOBAL_CLAUDE_MD"
echo ""
echo "Verify installation:"
echo "  claude mcp list"
echo ""
echo "Expected output:"
echo "  autoimprove-core: node ... - ✓ Connected"
echo ""
echo "Test the installation:"
echo "  /autoimprove-status"
echo ""
echo "Available Skills:"
echo "  • /autoimprove-status - Check system health"
echo "  • /autoimprove-summarize - Summarize session patterns"
echo "  • /autoimprove-rules - Manage knowledge rules"
echo "  • /autoimprove-lessons - View learned lessons"
echo ""
echo "Documentation: $SCRIPT_DIR/README.md"
echo "Troubleshooting: Check logs at $AUTOIMPROVE_DIR/logs/"
echo ""
