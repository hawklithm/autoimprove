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

### batch_rebuild

Batch rebuild all rules from session files with incremental caching and optional auto-cleanup.

**Parameters:**
- `force` (boolean, optional): Force full rebuild (ignore cache). Default: false
- `use_llm_enhancement` (boolean, optional): Enable LLM enhancement for rules (recommended). Default: false
- `extract_code_examples` (boolean, optional): Extract code examples from sessions (recommended). Default: false
- `auto_cleanup` (boolean, optional): Automatically cleanup duplicates and optimize rules after generation (recommended). Default: false
- `min_confidence` (number, optional): Minimum confidence threshold. Default: 0.6
- `session_limit` (number, optional): Limit number of sessions to analyze (for testing)
- `dry_run` (boolean, optional): Dry run mode (don't save results). Default: false
- `session_dir` (string, optional): Custom session directory path. Default: `~/.claude/projects`

**Returns:**
```json
{
  "success": true,
  "result": {
    "sessions_analyzed": 150,
    "sessions_cached": 100,
    "patterns_total": 450,
    "patterns_qualified": 300,
    "rules_generated": 45,
    "rules_exported": 10,
    "cache_hit_rate": 0.667,
    "execution_time_ms": 12500,
    "cleanup_performed": true,
    "rules_merged": 5,
    "rules_optimized": 8,
    "rules_deleted": 0,
    "auto_exported_to_claude_md": true,
    "exported_rules_count": 10
  }
}
```

**Example:**
```python
# Full rebuild with all enhancements
result = mcp.call_tool("batch_rebuild", {
    "force": True,
    "use_llm_enhancement": True,
    "extract_code_examples": True,
    "auto_cleanup": True,
    "min_confidence": 0.6
})

# Incremental rebuild (use cache)
result = mcp.call_tool("batch_rebuild", {
    "force": False,
    "use_llm_enhancement": True,
    "auto_cleanup":)

# Dry run preview
result = mcp.call_tool("batch_rebuild", {
    "dry_run": True,
    "min_confidence": 0.7
})
```

**Notes:**
- **Auto-export**: After successful rebuild (non-dry-run), automatically exports top 10 rules (confidence ≥ 0.7) to `~/.autoimprove/rules/claude-index.md`
- **Cleanup defaults**: When `auto_cleanup: true`, uses sensible defaults:
  - Merge duplicates: ✅
  - Optimize low-quality rules: ✅
  - Delete very low-quality rules: ❌
  - Quality threshold: 0.3
- **Incremental mode**: Automatically enabled when `force: false` (uses session cache)
- **Advanced features**: `useBatchLLM`, `batchLLMOptions`, `forceCleanup` are available in the Engine but not exposed through MCP. Use direct Engine calls for advanced control (see `run_batch_rebuild.ts`).

### decay_memories

Run long-term memory decay/elimination (gate 4 of the memory-quality pipeline). Archives TTL-expired or explicitly-deprecated memories, soft-demotes stale low-recall **experience** memories, and demotes linked rules whose supporting memories were removed.

This is the maintenance entry point for the "衰减淘汰" gate: keep the memory store high-signal so stale or contradicted memories stop polluting recall and rule generation.

**Parameters:**
- `ttl_fallback_days` (number, optional): Informational fallback TTL in days when a memory has no explicit `ttl_days`/`expires_at`. Default: 365. Note: auto-expiry still requires an explicit TTL (opt-in) — preferences/facts are never auto-expired by the fallback.
- `stale_days` (number, optional): Experience memories with `recall_count` below threshold and not recalled for this many days get soft-demoted. Default: 180
- `low_recall_threshold` (number, optional): `recall_count` below this is considered low-frequency. Default: 1
- `dry_run` (boolean, optional): Preview what would change without writing to storage. Default: false

**Returns:**
```json
{
  "success": true,
  "dry_run": false,
  "scanned": 128,
  "archived": 3,
  "deprecated": 5,
  "rules_affected": 7,
  "rules_demoted": 2,
  "details": [
    { "memory_id": "mem-...", "info_class": "experience", "action": "deprecated", "reason": "经验类记忆低频（recall=0）且超过 180 天未召回，软淘汰" }
  ]
}
```

**Example:**
```python
# Preview first, then apply
result = mcp.call_tool("decay_memories", { "dry_run": True })
result = mcp.call_tool("decay_memories", { "stale_days": 120 })
```

**Notes:**
- **TTL is opt-in**: Only memories with an explicit `ttl_days`/`expires_at` are auto-archived by TTL. Without it, a memory is only retired by explicit `deprecated` state, contradiction (`conflict_with`/`deprecated_by`), or frequency decay (experience only).
- **Stable knowledge is protected**: `preference`/`fact` memories are never auto-demoted by frequency decay; they are removed only via explicit TTL, explicit deprecated state, or contradiction.
- **Rule linkage**: When a memory is archived/demoted, derived rules are re-scored from remaining supporting memories; those dropping below `UNIFIED_RULE_MIN_SCORE` are demoted to `candidate`.

### list_memories

List and inspect learned memories (user memory control). Filters: `query`, `kind`, `info_class`, `active_only`, `limit`, `include_sensitive`. Because this is an explicit self-management query, sensitive memories are **included by default** (`include_sensitive` defaults to true).

**Parameters:**
- `query` (string, optional): Natural-language search across memories
- `kind` (enum, optional): `semantic` | `episodic` | `procedural`
- `info_class` (enum, optional): `preference` | `fact` | `experience`
- `active_only` (boolean, optional): Only active memories. Default: true
- `limit` (number, optional): Max records. Default: 50
- `include_sensitive` (boolean, optional): Include sensitive memories. Default: true

**Example:**
```python
result = mcp.call_tool("list_memories", { "info_class": "experience", "limit": 20 })
```

### delete_memory

Delete a learned memory by id. The memory is archived (removed from active recall) and any rules that depend **solely** on it are demoted to `candidate`.

**Parameters:**
- `memory_id` (string, required): ID of the memory to delete

**Example:**
```python
result = mcp.call_tool("delete_memory", { "memory_id": "mem-abc123" })
```

### update_memory

Update fields of a learned memory. When `content` changes, the sensitivity label is recomputed automatically (gate 5).

**Parameters:**
- `memory_id` (string, required)
- `content` / `summary` (string, optional)
- `info_class` (enum, optional): `preference` | `fact` | `experience`
- `sensitivity` (enum, optional): `public` | `sensitive` (override)
- `ttl_days` (number, optional): Set TTL; `expires_at` is derived from `created_at + ttl_days`
- `status` (enum, optional): `active` | `archived`

**Example:**
```python
result = mcp.call_tool("update_memory", { "memory_id": "mem-abc123", "ttl_days": 90, "info_class": "preference" })
```

### get_memory_metrics

Memory quality metrics dashboard (outcomes of the five gates): write volume, recall/hit rate, conflict rate, deletion rate, per-class breakdown, and a recent audit log (from `memory_versions`).

**Parameters:**
- `audit_limit` (number, optional): Number of recent audit entries. Default: 50

**Returns:**
```json
{
  "success": true,
  "total": 128,
  "active": 120,
  "archived": 5,
  "deprecated": 2,
  "sensitive": 1,
  "by_class": { "preference": 12, "fact": 30, "experience": 80, "unclassified": 6 },
  "metrics": {
    "write_volume": 128,
    "conflict_rate": 0.04,
    "deletion_rate": 0.039,
    "hit_rate": 0.55,
    "note": "hit_rate approximates recall coverage..."
  },
  "audit_log": [ { "memory_id": "mem-...", "at": "...", "decision": "UPDATE" } ]
}
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
