# AutoImprove MCP Server (TypeScript)

TypeScript implementation of the AutoImprove MCP Server.

## Installation

```bash
cd src/mcp-server-ts
npm install
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
```

## Configuration

Add to `~/.claude/config.json`:

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "node",
      "args": ["/path/to/autoimprove/src/mcp-server-ts/dist/index.js"]
    }
  }
}
```

Or use `tsx` for development (no build needed):

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "npx",
      "args": ["-y", "tsx", "/path/to/autoimprove/src/mcp-server-ts/src/index.ts"]
    }
  }
}
```

## Architecture

- `src/index.ts` - MCP server entry point
- `src/core/` - Core business logic
- `src/storage/` - Storage managers
- `src/tools/` - MCP tools implementation
- `src/resources/` - MCP resources implementation
