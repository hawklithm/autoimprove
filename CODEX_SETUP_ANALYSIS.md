# AutoImprove Codex Setup Analysis & Improvements

## Executive Summary

This document analyzes the current `setup_codex.sh` against Codex best practices and proposes comprehensive improvements based on the Codex skill system, MCP integration patterns, and CodeGraph project learnings.

## Current Setup Issues

### 1. Skill File Format Problems

**Issue**: Non-compliant YAML frontmatter
```yaml
# Current (Wrong)
---
name: autoimprove
description: AutoImprove knowledge management - search rules, learn lessons, improve code quality
trigger: ["/autoimprove", "search_knowledge", "add_rule", "add_lesson"]
---
```

**Problems**:
- `trigger` field is not standard (Codex doesn't use slash commands)
- Description too brief, doesn't explain when to use the skill
- Missing `metadata` section with `short-description`

**Fixed**:
```yaml
---
name: autoimprove
description: Intelligent code improvement system with automated pattern detection and rule generation. Use when analyzing code changes, learning from past patterns, preventing recurring issues, searching for best practices, or improving code quality through knowledge accumulation. Works with Git repositories and Claude Code sessions to automatically capture, organize, and apply coding patterns.
metadata:
  short-description: Learn from patterns, prevent recurring issues
---
```

### 2. Missing UI Metadata

**Issue**: No `agents/openai.yaml` file

Codex uses this file for:
- Skill lists in the UI
- Default prompts for skill chips
- Display names in skill selection

**Fixed**: Added `agents/openai.yaml`:
```yaml
display_name: AutoImprove
short_description: Learn from patterns, prevent recurring issues
default_prompt: Search for coding patterns and best practices relevant to my current task
```

### 3. Incomplete MCP Configuration

**Issue**: Missing critical environment variables

Current:
```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "node",
      "args": ["path/to/index.js"],
      "env": {}
    }
  }
}
```

**Problems**:
- No `AUTOIMPROVE_HOME` path
- No `AUTOIMPROVE_STORAGE_BACKEND` specification
- No `GIT_REPO_ROOT` for context
- No logging configuration

**Fixed**:
```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "node",
      "args": ["path/to/index.js"],
      "env": {
        "AUTOIMPROVE_HOME": "~/.autoimprove",
        "AUTOIMPROVE_STORAGE_BACKEND": "sqlite",
        "AUTOIM_LOG_LEVEL": "info",
        "AUTOIMPROVE_LOG_PATH": "~/.autoimprove/logs/mcp-server.log",
        "GIT_REPO_ROOT": "/current/project/path"
      }
    }
  }
}
```

### 4. Token Efficiency Violations

**Issue**: Verbose skill documentation that wastes context window

Codex principle from skill-creator:
> "The context window is a public good. Skills share the context window with everything else."

Current skill file has:
- Redundant command explanations
- Verbose examples that could be concise
- Unnecessary formatting

**Fixed**:
- Removed slash command references (not used by Codex)
- Condensed examples
- Focused on "when to use" rather than "how to use" (tools provide their own schemas)
- Added explicit integration guidance with CodeGraph

### 5. Installation Safety Issues

**Missing checks**:
- Node.js version validation
- npm availability
- MCP server startup test
- File permission verification
- Error recovery mechanisms

**Fixed**: Added comprehensive checks:
```bash
# Version validation
version_compare() { ... }
MIN_NODE_VERSION="18.0.0"

# Startup test
timeout 5 node "$MCP_SERVER_DIR/dist/index.js" <<< '{"jsonrpc":"2.0",...}' 

# Permission checks
[ -w "$AUTOIMPROVE_DIR" ] || error "Not writable"
```

## Key Improvements in setup_codex_v2.sh

### 1. Proper Skill Structure

```
~/.codex/skills/autoimprove/
├── SKILL.md              # Main skill file (required)
│   ├── YAML frontmatter  # Codex-compliant metadata
│   └── Markdown body     # Concise, token-efficient docs
└── agents/
    └── openai.yaml       # UI metadata (recommended)
```

### 2. Enhanced Installation Flow
n# Phase 1: Prerequisites
- Check Codex CLI installed
- Validate Node.js ≥ 18.0.0
- Verify npm available

# Phase 2: Directory Setup
- Create ~/.codex/skills/autoimprove/
- Create ~/.autoimprove/ with subdirectories
- Initialize storage backend

# Phase 3: MCP Server Build
- Install dependencies (including better-sqlite3)
- Build TypeScript → JavaScript
- Verify dist/index.js exists

# Phase 4: Configuration
- Generate MCP settings with environment variables
- Create SKILL.md with proper frontmatter
- Create agents/openai.yaml for UI

# Phaication
- Test MCP server startup
- Check file permissions
- Validate storage directory writable
```

### 3. Improved Documentation

**Skill File Principles**:
- **When to Use**: Clear triggering conditions in description
- **Core Capabilities**: High-level feature overview
- **Key Tools**: Only essential MCP tools with concise examples
- **Recommended Workflow**: Typical usage patterns
- **Integration Guidance**: How AutoImprove complements CodeGraph
- **Token Efficiency**: No redundant explanations

**Example Comparison**:

❌ **Old Style** (verbose):
```markdown
## Available Commands

- `/autoimprove-search <keywordsrch knowledge rules
- `/autoimprove-add-rule <title> <content> <tags>` - Add new rule
...

## Usage

Always call `search_knowledge` before:
1. Writing/editing code
2. Debugging issues
...

Example:
```
User: "Fix the memory leak in cache"
→ First: search_knowledge({keywords:"memory,leak,cache"})
→ Review matched rules
→ Apply fixes with citations
```
```

✅ **New Style** (concise):
```markdown
## Key MCP Tools

### Essential Workflow

**Search Before Acting**
```
search_knowledge({keywords:"memory,leak,cache",scene:"bugfix"})
```
Always searce changes. Returns ranked rules.

**Analyze Sessions**
```
analyze_session({session_file_path:"~/.claude/sessions/recent.jsonl"})
```
Process incrementally to detect patterns.
```

### 4. CodeGraph Integration Awareness

Added explicit guidance on using both systems:

```markdown
### Integration with CodeGraph
When CodeGraph is available (`.codegraph/` exists), AutoImprove complements it:
- CodeGraph: Understand code structure and call paths
- AutoImprove: Learn patterns and apply best practices

Use CodeGraph for "what/how is the code", AutoImprove for "what patte I follow".
```

### 5. Better Error Handling

```bash
# Colored output for clarity
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }

# Backup before overwriting
backup_file() {
    local backup="${1}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$1" "$backup"
}

# Graceful degradation
if ! check_command codex; then
    print_warning "Codex CLI not found. Install from: ..."
    echo "Setup will continue, but you'll need Codex to use AutoIrove."
fi
```

## Comparison Matrix

| Aspect | Old setup_codex.sh | New setup_codex_v2.sh |
|--------|-------------------|----------------------|
| **Skill Format** | Non-compliant YAML | Codex-standard frontmatter |
| **UI Metadata** | ❌ Missing | ✅ agents/openai.yaml |
| **MCP Config** | Minimal env vars | Full environment setup |
| **Token Efficiency** | Verbose docs | Concise, focused |
| **Prerequisites** | Basic checks | Version validation |
| **Error Handling** | Basic set -e | Comprehensive checks |
| **Verification** | ❌ None | MCP startup test |
| **Backup** | ❌ None | Auto-backup configs |
| **CodeGraph Integration** | ❌ None | Explicit guidance |
| **Storage Backend** | Hardcoded | Auto-detect with migration |
| **Logging** | ❌ Not configured | Full log path setup |
| **Documentation** | Command-focused | Workflow-focused |

## Migration Guide

### For Existing Installations

1. **Backup Current Setup**
   ```bash
   cp ~/.codex/mcp_settings.json ~/.codex/mcp_settings.json.backup
   cp ~/.codex/skills/autoimprove/SKILL.md ~/.codex/skills/autoimprove/SKILL.md.backup
   ```

2. **Run New Setup**
   ```bash
   ./setup_codex_v2.sh
   ```
   The script automatically backs up existing files.

3. **Restart Codex**
   ```bash
   # Close all Codex sessions, then:
   codex
   ```

4. **Verify Installation**
   ```bash
   codex --list-skills  # Should show autoimprove with new description
   ```

### For New Installations

Simply run:
```bash
./setup_codex_v2.sh
```

## Testing Checklist

- [ ] Prerequisites check correctly identifies missing tools
- [ ] Node.js version validation works (test with old version)
- [ ] MCP server builds successfully
- [ ] Configuration files created with correct content
- [ ] MCP server can start (timeout test)
- [ ] Storage directories are writable
- [ ] Skill appears in Codex UI with correct metadata
- [ ] Search tool works: "Search for error handling patterns"
- [ ] Logs appear in `~/.autoimprove/logs/mcp-server.log`

## Codex Design Principles Applied

### 1. Concise is Key
- Removed redundant explanations
- Focused on triggering conditions
- Deferred details to MCP tool schemas

### 2. Appropriate Freedom
- High freedom: General usage patterns
- Medium freedom: Recommended workflows
- Low freetorage paths and config structure

### 3. Token Budget Awareness
- Skill frontmatter: ~80 tokens (was ~40, but more informative)
- Skill body: ~1200 tokens (was ~800, but better organized)
- Trade-off justified by improved triggering and workflow clarity

### 4. Integration Over Isolation
- Explicit CodeGraph integration guidance
- References to Codex context window management
- Workflow recommendations that fit Codex usage patterns

## Recommendations

### Immediate Actions
1. Replace `setup_codex.sh` with `setup_codex_v2.sh`
2. Update installation documentation to reference new script
3. Add troubleshooting guide based on verification checks

### Future Enhancements
1. **Interactive Setup**: Ask user for organization ID, preferred scopes
2. **Health Check Command**: `./setup_codex_v2.sh --verify`
3. **Uninstall Script**: Clean removal with backup preservation
4. **Update Script**: Preserve user config while updating skill
5. **Template Customization**: Allow users to customize skill description

### Documentation Updates Needed
1. Update README.md installation section
2. Add Codex-specific usage examples
3. Document CodeGraph integration patterns
4. Create troubleshooting guide

## References

- Codex Skill System: `~/.codex/skills/.system/skill-creator/SKILL.md`
- MCP Protocol: `@modelcontextprotocol/sdk` documentation
- CodeGraph Integration: System prompt `AGENTS.md` instructions
- Token Efficiency: Codex "Concise is Key" principle

## Conclusion

The new `setup_codex_v2.sh` addresses all identified issues:
- ✅ Codex-compliant skill format
- ✅ Complete MCP configuration
- ✅ Token-efficient documentation
- ✅ Robust installation process
- ✅ CodeGraph integration awareness
- ✅ Proper error handling and verification

The improved setup follows Codex best practices and creates a professional, maintainable installation experience.

## Update: Template-Based Configuration

### Template Management Improvement

**Change**: The updated `setup_codex_v2.sh` now uses a centralized template file instead of hardcoding prompt content in the installation script.

#### Implementation

```bash
# Paths
TEMPLATES_DIR="$SCRIPT_DIR/templates"
GUIDANCE_TEMPLATE="$TEMPLATES_DIR/claude-guidance-template.md"

# Verify template exists
if [ ! -f "$GUIDANCE_TEMPLATE" ]; then
    print_error "Guidance template not found: $GUIDANCE_TEMPLATE"
    echo "Please ensure templates/claude-guidance-template.md exists"
    exit 1
fi

# Copy template (not hardcode content)
cp "$GUIDANCE_TEMPLATE" "$AUTOIMPROVE_GUIDANCE"
```

#### Benefits

1. **Single Source of Truth**: All guidance prompts maintained in `templates/claude-guidance-template.md`
2. **Easier Updates**: Modify template once, affects all installations
3. **Consistency**: Both Claude and Codex setups can use the same template
4. **Maintainability**: No need to sync prompt changes across multiple scripts
5. **Version Control**: Template changes tracked independently from installation logic

#### Template Location

```
autoimprove/
├── templates/
│   └── claude-guidance-template.md  # Unified prompt template
├── setup_codex_v2.sh                # References template
└── setup_claude.sh                  # Can also use same template
```

#### Codex-Specific Consideration

While Codex primarily uses skill-based prompting (SKILL.md), the guidance template is still copied to `~/.autoimprove/guidance.md` for:
- Reference documentation
- Claude Code compatibility (same codebase, dual platform support)
- Future integration possibilities

The setup script includes a clear note:
```
print_warning "Note: Codex uses skill-based prompting, not guidance.md"
echo "  The guidance is stored for reference and Claude Code compatibility"
```

#### Verification

Tested with `test_setup_v2.sh`:
- ✓ Template file exists and contains expected markers
- ✓ Setup script references template (not hardcodes)
- ✓ Template content properly copied during installation
- ✓ No hardcoded guidance content in setup script

This ensures the installation process remains clean, maintainable, and follows the principle of separation of concerns.
