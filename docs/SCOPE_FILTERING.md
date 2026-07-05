# Scope-Based Rule Filtering

## Overview

AutoImprove now supports **scope-based rule filtering** to organize rules by their applicability:

- **GLOBAL** - Universal programming patterns applicable across all projects
- **ORGANIZATION** - Company-specific frameworks, conventions, and tooling
- **PROJECT** - Project-specific implementations and patterns

## Architecture

### Components

1. **Scope Detection** (`src/core/scope-detector.ts`)
   - Automatically detects rule scope during generation
   - Extracts project path from session files (`cwd` field)
   - Uses heuristics to classify patterns as GLOBAL vs PROJECT

2. **Rule Metadata** (`src/core/models.ts`)
   - `RuleIndexEntry.scope` - Rule applicability scope
   - `RuleIndexEntry.scope_context` - Additional context (project_path, organization_id, project_id)

3. **Scope Filtering** (`src/core/rule-matcher.ts`, `src/core/indexed-rule-matcher.ts`)
   - Filter rules by scope during search
   - Match project paths (exact, substring, or parent directory)
   - Match organization IDs

## Usage

### Searching with Scope Filters

```typescript
// Search for global + current project rules
search_knowledge({
  scene_json: '{"tech":["react"],"functional":["auth"]}',
  current_project: "/Users/name/workspace/myproject",
  scopes: "global,project"
})

// Search for organization-specific rules
search_knowledge({
  keywords: "validation,api",
  organization_id: "mycompany",
  scopes: "organization"
})

// Default: search all scopes (global + organization + project)
search_knowledge({
  scene_json: '{"tech":["python"],"functional":["database"]}'
})
```

### Scope Detection Heuristics

**Global patterns** are identified by:
- Universal programming principles (DRY, SOLID, design patterns)
- Common security issues (SQL injection, XSS, CSRF)
- Performance anti-patterns (memory leaks, race conditions)
- High occurrence count (5+) with generic context

**Project-specific patterns** are identified by:
- References to "this project", "this codebase", "custom implementation"
- Project name mentioned in corrections
- Low occurrence count (1-2) with specific context
- Project-specific module/file references

**Organization patterns** can be manually set via:
- `scope` field in rule metadata
- `organization_id` in scope_context

## Implementation Details

### Session File Structure

Session JSONL files contain `cwd` field with project path:

```jsonl
{"type":"user","message":{...},"cwd":"/Users/name/workspace/myproject",...}
```

This is extracted by `JSONLParser` and stored in `SessionData.project_path`.

### Rule Generation Flow

1. **Session Analysis** - Extract patterns from session file
2. **Scope Detection** - Determine if pattern is GLOBAL or PROJECT
3. **Rule Generation** - Create rule with scope metadata
4. **Storage** - Save rule with scope in `rules/index.json`

Example rule with PROJECT scope:

```json
{
  "id": "rule-042",
  "type": "repeated-correction",
  "priority": "medium",
  "confidence": 0.75,
  "scope": "project",
  "scope_context": {
    "project_id": "myproject",
    "project_path": "/Users/name/workspace/myproject"
  },
  "scenes": {"tech": ["react"], "functional": ["validation"]},
  "keywords": ["custom", "validator"]
}
```

### Scope Matching Logic

**PROJECT scope matching:**
- Exact match: `rule.scope_context.project_path === current_project`
- Substring match: One path contains the other
- Example: `/path/to/project` matches `/path/to/project/src`

**ORGANIZATION scope matching:**
- Exact match: `rule.scope_context.organization_id === organization_id`
- No constraint: Rules without `organization_id` match all organizations

**GLOBAL scope:**
- Always matches (no filtering)

## Configuration

### Default Behavior

By default, `search_knowledge` includes **all scopes** (global, organization, project).

To customize:

```typescript
// Only global rules
scopes: "global"

// Global + project rules (no organization)
scopes: "global,project"

// Only current project rules
scopes: "project"
current_project: "/path/to/project"
```

### Auto-Detection

If `current_project` is not provided:
- MCP server uses `process.cwd()` as fallback
- Claude Code passes actual CWD from session context

### Manual Scope Assignment

Rules can be manually assigned scopes:

```bash
# Via update_rules MCP tool
update_rules({
  rule_id: "rule-042",
  updates_json: JSON.stringify({
    scope: "organization",
    scope_context: {
      organization_id: "mycompany"
    }
  })
})
```

## Testing

Run scope filtering tests:

```bash
cd src/mcp-server-ts
npm test -- tests/scope-filtering.test.ts
```

Tests cover:
- Scope detection for global vs project patterns
- Filtering by GLOBAL, ORGANIZATION, PROJECT scopes
- Project path substring matching
- Multiple scope combinations
- Organization ID matching

## Migration

### Existing Rules

Rules without `scope` field default to **GLOBAL** scope in:
- `RuleMatcher.matchesScope()` (line 83)
- `IndexedRuleMatcher.matchesScope()` (line 198)

No migration script needed - existing rules continue working with backward compatibility.

### Rebuild to Add Scopes

To add scope metadata to existing rules:

```bash
/autoimprove-summarize --rebuild --enhance --min-confidence 0.6
```

This will:
1. Re-analyze all sessions
2. Detect project paths from session files
3. Assign scopes using heuristics
4. Regenerate rules with scope metadata

## Future Enhancements

1. **Manual scope override** - User-specified scope during `/autoimprove-summarize`
2. **Organization ID auto-detection** - From git remote URLs (e.g., `github.com/myorg/repo`)
3. **Scope migration tool** - Bulk update existing rules with detected scopes
4. **Scope-specific confidence** - Different thresholds per scope level
5. **Multi-project rules** - Rules applicable to multiple projects (e.g., monorepos)

## API Reference

### ScopeDetector

```typescript
class ScopeDetector {
  detectScope(pattern: Pattern, sessionData?: SessionData): ScopeContext
  isSameProject(path1: string, path2: string): boolean
  detectOrganizationId(projectPath: string): string | undefined
}
```

### RuleMatcher

```typescript
interface ScopeFilter {
  scopes?: RuleScope[];           // Allowed scopes
  current_project?: string;       // Current project path
  organization_id?: string;       // Organization identifier
}

matcher.matchRules(
  scene: Scene,
  keywords?: string[],
  maxResults?: number,
  minConfidence?: number,
  scopeFilter?: ScopeFilter
): RuleMatch[]
```

### MCP Tool: search_knowledge

```typescript
search_knowledge({
  scene_json?: string,           // Scene context
  keywords?: string,             // Keywords to match
  rule_id?: string,              // Specific rule ID
  current_project?: string,      // Current project path
  organization_id?: string,      // Organization ID
  scopes?: string,               // Comma-separated: "global,organization,project"
  skip_feedback?: boolean        // Skip auto-feedback recording
})
```

## Example Use Cases

### 1. Personal Project Development

User works on personal project `/Users/john/projects/my-app`:

```typescript
// Gets global rules + my-app specific rules
search_knowledge({
  scene_json: '{"tech":["react"],"functional":["auth"]}',
  current_project: "/Users/john/projects/my-app"
})
```

### 2. Company Framework Usage

Company "Acme Corp" has internal React framework:

```typescript
// Gets global + Acme Corp framework rules
search_knowledge({
  scene_json: '{"tech":["react"],"functional":["components"]}',
  organization_id: "acmecorp",
  scopes: "global,organization"
})
```

### 3. Multi-Project Developer

Developer switches between projects:

```typescript
// Project A
search_knowledge({
  scene_json: '{"tech":["python"],"functional":["api"]}',
  current_project: "/work/projectA"
})

// Project B (different rules may apply)
search_knowledge({
  scene_json: '{"tech":["python"],"functional":["api"]}',
  current_project: "/work/projectB"
})
```

### 4. Generic Learning

User wants only universal patterns (no project-specific noise):

```typescript
search_knowledge({
  keywords: "async,performance",
  scopes: "global"
})
```

## Benefits

1. **Reduced Noise** - Project-specific rules don't appear in other projects
2. **Better Organization** - Clear separation of universal vs contextual rules
3. **Scalability** - Support multiple projects/organizations in one knowledge base
4. **Precision** - More relevant rule matches for current context
5. **Portability** - Global rules can be shared across teams/projects

## Troubleshooting

### Rules Not Showing Up

1. Check scope filter: Ensure `scopes` parameter includes the rule's scope
2. Verify project path: Use absolute path, check for typos
3. Check confidence: Rule might be filtered by `minConfidence` threshold

### Wrong Scope Assigned

1. Review pattern context in session file
2. Manually update rule scope via `update_rules` tool
3. Adjust heuristics in `ScopeDetector` if needed

### Performance Issues

- Scope filtering is O(1) for in-memory index lookup
- No performance degradation compared to non-scoped search
- Cache invalidation works same as before
