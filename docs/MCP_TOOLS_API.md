# AutoImprove MCP Tools API

## Overview

AutoImprove MCP Server provides 8 tools and 2 resources for session analysis, rule management, and usage statistics.

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

Search rules by scene, keywords, or ID. Automatically records "used" feedback for matched rules.

**Parameters:**
- `scene_json` (string, optional): JSON string of scene to match
- `keywords` (string, optional): Comma-separated keywords
- `rule_id` (string, optional): Specific rule ID
- `skip_feedback` (boolean, optional): Set to true to skip automatic feedback recording (default: false)

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

**Automatic Feedback Recording:**
When `skip_feedback` is false (default), this tool automatically records:
- "used" feedback when querying a rule by ID
- "used" feedback for all matched rules when searching by scene

**Example:**
```python
# Search by scene (records feedback for matches)
result = mcp.call_tool("search_knowledge", {
    "scene_json": json.dumps({"tech": ["react"], "functional": ["auth"]})
})

# Search by ID (records feedback)
result = mcp.call_tool("search_knowledge", {
    "rule_id": "rule-001"
})

# Search without recording feedback
result = mcp.call_tool("search_knowledge", {
    "scene_json": json.dumps({"tech": ["react"]}),
    "skip_feedback": True
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

### record_feedback

Record feedback for a rule (used, ignored, corrected, disabled).

**Parameters:**
- `rule_id` (string, required): ID of the rule
- `feedback_type` (string, required): Type of feedback ("used", "ignored", "corrected", "disabled")
- `context` (string, optional): Context information about the feedback
- `user_rating` (number, optional): User rating 1-5

**Returns:**
```json
{
  "success": true,
  "message": "Feedback recorded successfully"
}
```

**Example:**
```python
# Record that a rule was used with rating
result = mcp.call_tool("record_feedback", {
    "rule_id": "rule-001",
    "feedback_type": "used",
    "context": "Applied to React authentication flow",
    "user_rating": 5
})

# Record that a rule was ignored
result = mcp.call_tool("record_feedback", {
    "rule_id": "rule-002",
    "feedback_type": "ignored",
    "context": "Not applicable to this use case"
})
```

### get_feedback_stats

Get feedback statistics for a rule or all rules.

**Parameters:**
- `rule_id` (string, optional): Rule ID to get stats for (omit for all rules)

**Returns:**
```json
{
  "success": true,
  "stats": {
    "rule-001": {
      "rule_id": "rule-001",
      "total_feedbacks": 45,
      "by_type": {
        "used": 30,
        "ignored": 10,
        "corrected": 3,
        "disabled": 2
      },
      "average_rating": 4.2,
      "ratings_count": 15,
      "last_feedback": "2026-06-05T10:30:00Z"
    }
  }
}
```

**Example:**
```python
# Get stats for specific rule
result = mcp.call_tool("get_feedback_stats", {
    "rule_id": "rule-001"
})

# Get stats for all rules
result = mcp.call_tool("get_feedback_stats", {})
```

### get_rule_usage_stats

Get multi-dimensional usage statistics for rules.

**Parameters:**
- `output_format` (string, optional): Output format ("json", "markdown", "summary"; default: "json")
- `start_date` (string, optional): Start date filter (ISO format)
- `end_date` (string, optional): End date filter (ISO format)
- `categories` (array, optional): Filter by rule categories
- `min_feedbacks` (number, optional): Minimum feedback count to include
- `top_n` (number, optional): Limit to top N rules (default: 10)

**Returns:**
```json
{
  "success": true,
  "format": "json",
  "stats": {
    "overview": {
      "total_rules": 50,
      "rules_with_usage": 35,
      "total_feedbacks": 450,
      "date_range": {
        "start": "2026-01-01T00:00:00Z",
        "end": "2026-06-06T00:00:00Z"
      }
    },
    "by_category": {
      "Security": {
        "rules_count": 12,
        "total_usage": 150,
        "avg_usage_per_rule": 12.5
      }
    },
    "by_scene": {
      "react-auth": {
        "rules_count": 8,
        "total_usage": 95
      }
    },
    "by_priority": {
      "critical": 180,
      "high": 120,
      "medium": 100,
      "low": 50
    },
    "top_used_rules": [
      {
        "rule_id": "rule-001",
        "usage_count": 45,
        "category": "Security",
        "priority": "critical"
      }
    ],
    "problematic_rules": [
      {
        "rule_id": "rule-010",
        "ignored_count": 15,
        "corrected_count": 8,
        "disabled_count": 3
      }
    ]
  }
}
```

**Example:**
```python
# Get JSON stats
result = mcp.call_tool("get_rule_usage_stats", {
    "output_format": "json",
    "top_n": 20
})

# Get markdown report for last 30 days
result = mcp.call_tool("get_rule_usage_stats", {
    "output_format": "markdown",
    "start_date": "2026-05-07",
    "end_date": "2026-06-06"
})

# Get quick summary filtered by category
result = mcp.call_tool("get_rule_usage_stats", {
    "output_format": "summary",
    "categories": ["Security", "Performance"]
})
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

## Feedback Recording

AutoImprove uses a dual-track feedback recording system:

1. **Automatic Recording**: `search_knowledge` tool automatically records "used" feedback when:
   - A rule is queried by ID
   - Rules are matched by scene context
   - Can be disabled with `skip_feedback: true` parameter

2. **Manual Recording**: Claude actively records feedback via `record_feedback` tool when:
   - User explicitly approves/rejects a rule
   - A rule needs correction
   - A rule is disabled
   - User provides a quality rating

Feedback is stored in `~/.autoimprove/feedback_history.jsonl` and used to:
- Generate usage statistics via `get_rule_usage_stats`
- Calculate per-rule stats via `get_feedback_stats`
- Improve rule quality and relevance over time

See [feedback-mechanism.md](./feedback-mechanism.md) for implementation details.
