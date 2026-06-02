# AutoImprove

Learn coding patterns from Claude Code sessions and generate reusable rules.

## Overview

AutoImprove analyzes your Claude Code sessions to detect patterns in corrections, preferences, and best practices. It automatically generates rules that Claude will follow in future sessions, reducing repetitive corrections and improving consistency.

## Features

- **Pattern Detection**: Identifies 5 types of patterns
  - Repeated corrections
  - Anti-patterns
  - User preferences
  - Performance optimizations
  - Security issues

- **Confidence Scoring**: Uses v2.0 formula with weighted components
  - Frequency (30%)
  - Time span (10%)
  - User behavior (40%)
  - Validation (20%)

- **Scene-Based Matching**: Three-dimensional scene model
  - Tech stack (React, Python, etc.)
  - Functional domain (auth, api, etc.)
  - Business domain (e-commerce, finance, etc.)

- **MCP Server**: MCP-based server with 5 tools and 2 resources (TypeScript)
  - `analyze_session` - Analyze session patterns
  - `generate_rules` - Generate rules from patterns
  - `search_knowledge` - Search rules
  - `update_rules` - Update existing rules
  - `list_scenes` - List known scenes
  - `knowledge://rules/{id}` - Get rule content
  - `knowledge://lessons/{scene}` - Get lessons for scene

## Installation

### Prerequisites

- **Node.js 18+** - Required for building and running the MCP server
- **Claude Code** - CLI, Desktop, or Web version

### Quick Setup (Recommended)

Run the automated setup script from the project root:

```bash
./setup.sh
```

This will automatically:
1. ✅ Install and build MCP Server (TypeScript)
2. ✅ Build Skills (TypeScript)
3. ✅ Configure Claude Code MCP Server (user-level, **available in all projects**)
4. ✅ Install Skills to `~/.claude/skills/`
5. ✅ Initialize storage directory at `~/.autoimprove/`

**Configuration Scope**: The setup script configures `autoimprove-core` as a **user-level MCP server**, making it accessible from any project directory. You only need to run setup once.

### Verify Installation

After setup completes:

```bash
# Check MCP server status (works from any directory)
claude mcp list

# Expected output:
# autoimprove-core: node .../dist/index.js - ✓ Connected

# Check system health
claude
# Then type: /autoimprove-status
```

### Manual Setup

If you prefer manual installation or need to customize the setup:

**Step 1: Build MCP Server**

```bash
cd src/mcp-server-ts
npm install
npm run build
```

**Step 2: Build Skills**

```bash
cd src/skills-ts
npm install
npm run build
```

**Step 3: Configure MCP Server**

Using Claude Code CLI (recommended - works globally):

```bash
claude mcp add autoimprove-core -s user -- node /path/to/autoimprove/src/mcp-server-ts/dist/index.js
```

**Note**: Use `-s user` to make the server available in all projects, or `-s local` for project-specific configuration.

**Step 4: Install Skills**

```bash
# Copy skills to Claude Code skills directory
mkdir -p ~/.claude/skills
cp -r src/skills-ts/src/autoimprove-* ~/.claude/skills/
```

## Quick Start

### 1. Verify Installation

Check that the MCP Server is running (works from any project directory):

```bash
# Check MCP server status
claude mcp list

# Expected output:
# codegraph: codegraph serve --mcp - ✓ Connected
# autoimprove-core: node .../dist/index.js - ✓ Connected

# Get detailed server info
claude mcp get autoimprove-core

# Expected output:
# Scope: User config (available in all your projects)
# Status: ✓ Connected
```

### 2. Use Skills

Available skills (work in any project):

```bash
# Launch Claude Code and use these commands:

/autoimprove-status      # Check system health and statistics
/autoimprove-summarize   # Analyze session patterns
/autoimprove-rules       # Manage knowledge rules
/autoimprove-lessons     # View learned lessons
```

### 3. Use MCP Tools

You can call the MCP tools directly through Claude Code's MCP integration:

**Analyze a session:**
```
Ask Claude to call the analyze_session tool with a session file path
```

**Generate rules:**
```
Ask Claude to call the generate_rules tool with detected patterns
```

**Search knowledge:**
```
Ask Claude to call the search_knowledge tool to find relevant rules
```

**List available scenes:**
```
Ask Claude to call the list_scenes tool to see all known tech/functional scenes
```

### 4. Access Resources

**Get rule content:**
```
Access knowledge://rules/rule-001
```

**Get lessons for a scene:**
```
Access knowledge://lessons/react-auth
```

See rules applicable to your current coding context.

## Architecture

```
┌─────────────────────────────────────────────┐
│              AutoImprove System              │
├─────────────────────────────────────────────┤
│                                             │
│  Skills (User Interface)                    │
│  ├─ /autoimprove-status                     │
│  ├─ /autoimprove-summarize                  │
│  ├─ /autoimprove-rules                      │
│  └─ /autoimprove-lessons                    │
│         ↓                                   │
│  MCP Server (Core Logic)                    │
│  ├─ Tools                                   │
│  │  ├─ analyze_session                      │
│  │  ├─ generate_rules                       │
│  │  ├─ search_knowledge                     │
│  │  ├─ update_rules                         │
│  │  └─ list_scenes                          │
│  ├─ Resources                               │
│  │  ├─ knowledge://rules/{id}               │
│  │  └─ knowledge://lessons/{scene}          │
│  └─ Storage (~/.autoimprove/)               │
│      ├─ rules/index.json                    │
│      ├─ rules/content/*.md                  │
│      └─ sessions/*.json                     │
│                                             │
└─────────────────────────────────────────────┘
```

## Storage Structure

```
~/.autoimprove/
├── config.json              # Configuration
├── rules/
│   ├── index.json          # Rule metadata (fast loading)
│   └── content/            # Full rule content
│       ├── rule-001.md
│       ├── rule-002.md
│       └── ...
├── sessions/               # Session archives
│   └── {session_id}.json
└── cache/                  # Temporary cache
```

## Configuration

Edit `~/.autoimprove/config.json`:

```json
{
  "version": "1.0",
  "confidence_thresholds": {
    "repeated_correction": 0.45,
    "anti_pattern": 0.45,
    "preference": 0.3,
    "performance": 0.4,
    "security": 0.3
  },
  "confidence_weights": {
    "frequency": 0.3,
    "time_span": 0.1,
    "behavior": 0.4,
    "validation": 0.2
  },
  "rule_matching": {
    "max_results": 10,
    "min_confidence": 0.3
  },
  "business_domain_mappings": {
    "src/shop": "e-commerce",
    "src/crm": "crm"
  }
}
```

## Development

### Run Tests

```bash
cd src/mcp-server
pytest tests/ -v
```

### Run MCP Server Locally

```bash
cd src/mcp-server
python server.py
```

### Run Skills Locally

```bash
cd src/skills/autoimprove-status
python skill.py
```

## Troubleshooting

### MCP Server Not Found

If `claude mcp list` doesn't show `autoimprove-core`:

```bash
# Re-run the setup script
./setup.sh

# Or manually add the server
claude mcp add autoimprove-core -s user -- node /path/to/autoimprove/src/mcp-server-ts/dist/index.js
```

### Server Status Shows Disconnected

```bash
# Check server details
claude mcp get autoimprove-core

# Remove and re-add the server
claude mcp remove autoimprove-core -s user
claude mcp add autoimprove-core -s user -- node /path/to/autoimprove/src/mcp-server-ts/dist/index.js
```

### Skills Not Working

Skills require the MCP server to be running. Check:

1. MCP server is connected: `claude mcp list`
2. Skills are installed: `ls ~/.claude/skills/autoimprove-*`
3. Storage is initialized: `ls ~/.autoimprove/`

If skills are missing, reinstall:

```bash
./setup.sh  # Reinstalls everything including skills
```

### Storage Not Initialized

Run `/autoimprove-status` to initialize storage automatically, or manually:

```bash
mkdir -p ~/.autoimprove/{rules/content,sessions,cache,logs}
echo '{"version":"1.0","rules":[]}' > ~/.autoimprove/rules/index.json
```

### No Patterns Detected

- Ensure you made corrections during the session
- Check that session file exists in `~/.claude/sessions/`
- Try with more explicit corrections
- Verify patterns meet confidence thresholds in `~/.autoimprove/config.json`

### Rules Not Matching

- Check scene detection with `/autoimprove-status`
- Verify rule scenes match your current work (tech stack, functional domain)
- Adjust confidence thresholds in `~/.autoimprove/config.json`
- Use `search_knowledge` tool to test rule matching

### Build Errors

```bash
# Clean and rebuild MCP server
cd src/mcp-server-ts
rm -rf dist node_modules
npm install
npm run build

# Clean and rebuild skills
cd src/skills-ts
rm -rf dist node_modules
npm install
npm run build
```

### Check Logs

```bash
# View MCP server logs (if available)
ls ~/.autoimprove/logs/

# Check Claude Code logs
ls ~/.claude/logs/
```

### Configuration Scope Issues

If the server works in one project but not others:

```bash
# Check current scope
claude mcp get autoimprove-core

# Should show: "Scope: User config (available in all your projects)"
# If it shows "Local config", remove and re-add with -s user:

claude mcp remove autoimprove-core -s local
claude mcp add autoimprove-core -s user -- node /path/to/dist/index.js
```

## License

MIT License

## Version

Current version: 0.1.0