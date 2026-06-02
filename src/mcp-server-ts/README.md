# AutoImprove MCP Server (TypeScript)

TypeScript implementation of the AutoImprove MCP Server.

## Quick Start

**Recommended**: Use the automated setup script from the project root:

```bash
cd /path/to/autoimprove
./setup.sh
```

This will automatically build and configure the MCP server for all your projects.

## Manual Installation

```bash
cd src/mcp-server-ts
npm install
npm run build
```

## Configuration

### Using Claude Code CLI (Recommended)

**User-level (available in all projects)**:

```bash
claude mcp add autoimprove-core -s user -- node /path/to/autoimprove/src/mcp-server-ts/dist/index.js
```

**Project-level (specific project only)**:

```bash
claude mcp add autoimprove-core -s local -- node /path/to/autoimprove/src/mcp-server-ts/dist/index.js
```

### Verify Configuration

```bash
# Check server status
claude mcp list

# Get detailed info
claude mcp get autoimprove-core

# Expected output:
# Scope: User config (available in all your projects)
# Status: ✓ Connected
```

### Development Mode (No Build Required)

For development with hot reload using `tsx`:

```bash
claude mcp add autoimprove-core -s user -- npx -y tsx /path/to/autoimprove/src/mcp-server-ts/src/index.ts
```

## Development

```bash
# Run in dev mode (with hot reload)
npm run dev

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Architecture

```
src/mcp-server-ts/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── core/                 # Core business logic
│   │   ├── session-analyzer.ts   # Pattern detection
│   │   ├── rule-generator.ts     # Rule generation
│   │   ├── rule-matcher.ts       # Scene-based matching
│   │   └── models.ts             # Type definitions
│   ├── storage/              # Storage managers
│   │   ├── init.ts               # Storage initialization
│   │   ├── rule-index.ts         # Rule index manager
│   │   └── rule-content.ts       # Rule content manager
│   ├── tools/                # MCP tools implementation
│   └── resources/            # MCP resources implementation
├── dist/                     # Compiled output
├── tests/                    # Test files
├── package.json
└── tsconfig.json
```

## MCP Tools

The server provides these MCP tools:

- `health_check` - System status and diagnostics
- `analyze_session` - Analyze coding patterns from session
- `generate_rules` - Generate rules from detected patterns
- `search_knowledge` - Search rules by scene/keywords
- `update_rules` - Update existing rules
- `list_scenes` - List known tech/functional scenes

## MCP Resources

- `knowledge://rules/{id}` - Get rule content by ID
- `knowledge://lessons/{scene}` - Get lessons for a scene

## Storage

The server uses `~/.autoimprove/` for storage:

```
~/.autoimprove/
├── config.json           # Server configuration
├── rules/
│   ├── index.json       # Rule metadata (fast access)
│   └── content/         # Full rule content (.md files)
├── sessions/            # Session analysis cache
├── cache/               # Temporary cache
└── logs/                # Server logs
```

## Troubleshooting

### Server Not Starting

```bash
# Check if build succeeded
ls dist/index.js

# Rebuild if needed
rm -rf dist node_modules
npm install
npm run build
```

### Connection Issues

```bash
# Remove and re-add server
claude mcp remove autoimprove-core -s user
claude mcp add autoimprove-core -s user -- node /path/to/dist/index.js

# Verify connection
claude mcp get autoimprove-core
```

### Development Mode Issues

```bash
# Ensure tsx is available
npx -y tsx --version

# Test server directly
npx tsx src/index.ts
```
