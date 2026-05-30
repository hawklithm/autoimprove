# AutoImprove MCP Tools API

## Overview

AutoImprove MCP Server provides 5 tools and 2 resources for session analysis and rule management.

## Tools

### analyze_session

Analyze a Claude Code session file and detect patterns.

**Parameters:**
- `session_file_path` (string, required): Path to session JSONL file

**Returns:**
```json
{
  "success": true,
  "session_id": "session-001",
  "patterns_count": 3,
  "patterns": [
    {
      "type": "repeated-correction",
      "description": "Use refreshToken() helper",
      "confidence": 0.75,
      "occurrences": [...],
      "keywords": ["token", "refresh"]
    }
  ]
}
```

**Example:**
```python
result = mcp.call_tool("analyze_session", {
    "session_file_path": "/path/to/session.jsonl"
})
```

### generate_rules

Generate rules from detected patterns.

**Parameters:**
- `patterns_json` (string, required): JSON string of patterns array
- `scene_json` (string, optional): JSON string of scene context

**Returns:**
```json
{
  "success": true,
  "rules_count": 2,
  "rule_ids": ["rule-001", "rule-002"]
}
```

**Example:**
```python
result = mcp.call_tool("generate_rules", {
    "patterns_json": json.dumps(patterns),
    "scene_json": json.dumps({"tech": ["react"], "functional": ["auth"]})
})
```

### search_knowledge

Search rules by scene, keywords, or ID.

**Parameters:**
- `scene_json` (string, optional): JSON string of scene to match
- `keywords` (string, optional): Comma-separated keywords
- `rule_id` (string, optional): Specific rule ID

**Returns:**
```json
{
  "success": true,
  "matches_count": 5,
  "matches": [
    {
      "rule": {
        "id": "rule-001",
        "type": "preference",
        "priority": "low",
        "confidence": 0.7
      },
      "relevance": 0.85,
      "reason": "scene overlap (tech:1, functional:1)"
    }
  ]
}
```

**Example:**
```python
# Search by scene
result = mcp.call_tool("search_knowledge", {
    "scene_json": json.dumps({"tech": ["react"], "functional": ["auth"]})
})

# Search by ID
result = mcp.call_tool("search_knowledge", {
    "rule_id": "rule-001"
})
```

### update_rules

Update an existing rule.

**Parameters:**
- `rule_id` (string, required): ID of rule to update
- `updates_json` (string, required): JSON string of fields to update

**Returns:**
```json
{
  "success": true,
  "rule_id": "rule-001"
}
```

**Example:**
```python
result = mcp.call_tool("update_rules", {
    "rule_id": "rule-001",
    "updates_json": json.dumps({
        "priority": "high",
        "confidence": 0.9
    })
})
```

### list_scenes

List all known scenes from rules and sessions.

**Parameters:** None

**Returns:**
```json
{
  "success": true,
  "tech": {
    "react": 15,
    "python": 8,
    "typescript": 12
  },
  "functional": {
    "auth": 10,
    "api": 7
  },
  "business": {
    "e-commerce": 5
  }
}
```

**Example:**
```python
result = mcp.call_tool("list_scenes", {})
```

## Resources

### knowledge://rules/{rule_id}

Get full rule content as markdown.

**Parameters:**
- `rule_id` (string): Rule ID

**Returns:** Markdown string with rule content

**Example:**
```python
content = mcp.read_resource("knowledge://rules/rule-001")
```

### knowledge://lessons/{scene}

Get all rules applicable to a scene.

**Parameters:**
- `scene` (string): Scene identifier (e.g., "react-auth")

**Returns:** Markdown string with applicable rules

**Example:**
```python
lessons = mcp.read_resource("knowledge://lessons/react-auth")
```

## Error Handling

All tools return a response with `success` field:

```json
{
  "success": false,
  "error": "Error message"
}
```

Common errors:
- `Session file not found` - Invalid session file path
- `Rule not found` - Invalid rule ID
- `Invalid JSON` - Malformed JSON parameters
- `Storage not initialized` - Run `/autoimprove-status` first

## Health Check

Use `health_check` tool to verify server status:

```python
result = mcp.call_tool("health_check", {})
# Returns: {"success": true, "status": "healthy", "storage": {...}}
```
