# Changelog

## [Unreleased]

### Changed
- Made `search_knowledge` the proactive primary lookup for implementation, debugging, and refactoring; empty and unmatched searches now provide success-shaped guidance.
- Added storage-aware MCP instructions for an empty knowledge base and concise Claude guidance for Task/sub-agents.
- Added the proactive `/autoimprove-check` skill.

## [0.1.0] - 2026-06-03

### Added
- TypeScript implementation of MCP Server
- TypeScript implementation of Skills
- Automated setup script (`setup.sh`)
- User-level MCP server configuration (available in all projects)
- Comprehensive documentation updates

### Changed
- **MCP Server Configuration**: Changed from project-level to user-level scope
  - Old: Only available in `/Users/adazhao/workspace/autoimprove`
  - New: Available in all projects globally
  - Configuration method: `claude mcp add autoimprove-core -s user`

- **Setup Script Improvements**:
  - Automatically detects and removes old configurations
  - Uses official `claude mcp add` CLI command
  - Builds both MCP server and skills
  - Provides clear status messages and verification steps

- **Installation Process**:
  - One-command setup: `./setup.sh`
  - No need to manually edit configuration files
  - No need to restart Claude Code (changes take effect immediately)

### Documentation Updates

#### README.md
- ✅ Updated installation instructions with user-level scope
- ✅ Added comprehensive "Quick Setup" section
- ✅ Added "Verify Installation" section with example commands
- ✅ Expanded "Manual Setup" with CLI-based configuration
- ✅ Enhanced "Quick Start" with step-by-step verification
- ✅ Completely rewrote "Troubleshooting" section with solutions for:
  - MCP server not found
  - Server disconnection issues
  - Skills not working
  - Configuration scope issues
  - Build errors

#### src/mcp-server-ts/README.md
- ✅ Added "Quick Start" section recommending setup script
- ✅ Updated configuration to use `claude mcp add` CLI
- ✅ Added user-level vs project-level configuration examples
- ✅ Added "Verify Configuration" section
- ✅ Expanded "Architecture" section with detailed directory structure
- ✅ Added "MCP Tools" and "MCP Resources" documentation
- ✅ Added "Storage" structure documentation
- ✅ Enhanced "Troubleshooting" with specific solutions

### Technical Details

**MCP Server Scope**:
```bash
# Before (project-level)
Scope: Local config (private to you in this project)

# After (user-level)
Scope: User config (available in all your projects)
```

**Configuration Location**:
- User-level config: `~/.claude.json` → `mcpServers` (global section)
- Project-level config: `~/.claude.json` → `projects["/path/to/project"].mcpServers`

**Setup Script Key Features**:
1. Node.js version check (requires 18+)
2. Builds MCP server with verification
3. Builds skills
4. Removes conflicting old configurations (both user and local level)
5. Adds server with `-s user` flag for global visibility
6. Installs skills to `~/.claude/skills/`
7. Initializes storage at `~/.autoimprove/`

### Migration Guide

If you installed AutoImprove before this update:

```bash
# Remove old project-level configuration
claude mcp remove autoimprove-core -s local

# Re-run setup script to install as user-level
./setup.sh

# Verify new configuration
claude mcp get autoimprove-core
# Should show: "Scope: User config (available in all your projects)"
```

### Verified Installation

Current status:
```
autoimprove-core:
  Scope: User config (available in all your projects) ✓
  Status: ✓ Connected
  Type: stdio
  Command: node
  Args: /Users/adazhao/workspace/autoimprove/src/mcp-server-ts/dist/index.js
```

### Available Features

**Skills** (work from any project):
- `/autoimprove-status` - System health check
- `/autoimprove-summarize` - Session pattern analysis
- `/autoimprove-rules` - Knowledge rule management
- `/autoimprove-lessons` - Learned lessons viewer

**MCP Tools**:
- `health_check` - System diagnostics
- `analyze_session` - Pattern detection
- `generate_rules` - Rule generation
- `search_knowledge` - Rule search
- `update_rules` - Rule updates
- `list_scenes` - Scene listing

**MCP Resources**:
- `knowledge://rules/{id}` - Rule content
- `knowledge://lessons/{scene}` - Scene-specific lessons

### Breaking Changes
- Manual configuration file editing is no longer recommended
- Use `claude mcp add` CLI command instead
- Project-level configurations need migration to user-level for global access

### Next Steps
- Add more MCP tools for advanced pattern detection
- Implement rule validation and testing
- Add support for custom pattern types
- Improve scene detection algorithms
