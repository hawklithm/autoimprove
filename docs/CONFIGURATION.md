# Configuration Reference

AutoImprove is configured via `~/.autoimprove/config.json`. The file is created
on first run (seeded from `templates/config.json`). Any field you omit falls back
to the built-in `DEFAULT_CONFIG` in `src/storage/init.ts`.

> Note: docs written before v2.2 sometimes refer to `~/.autonfig.json`. The real
> path is `~/.autoimprove/config.json`.

## Quick start

```json
{
  "pattern_detection": {
    "enable_content_filter": true,
    "use_llm_classification": false
  },
  "memory_extraction": {
    "enable_content_filter": true,
    "require_code_context": false
  },
  "rule_generation": {
    "require_manual_review_for": {
      "empty_scene": true,
      "low_quality_score": 0.5
    },
    "review_queue": {
      "path": "~/.autoimprove/review_queue.jsonl"
    }
  }
}
```

## `pattern_detection`

Controls how raw session patterns are pre-filtered.

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `enable_content_filter` | boolean | `true` | Reject business-dominant patterns (recruiting, marketing, sales…) before they can become memories or rules. Uses the keyword heuristic `PatternContentFilter`. |
| `use_llm_classification` | boolean | `false` | When the heuristic is below its confidence threshold, optionally ask an LLM to classify the content as `code` / `business` / `general`. Off by default to avoid cost/latency. |

## `memory_extraction`

Controls how candidate memories are filtered during `SessionMemoryExtractor.extract()`.

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `enable_content_filter` | boolean | `true` | Reject non-coding patterns before they become memories. Mirrors `pattern_detection.enable_content_filter` but applies at the memory layer. |
| `require_code_context` | boolean | `false` | When `true`, a pattern must also contain code context (a file path, tool call, or code block) before a memory is extracted. Provides a second line of defense against borderline content. |

## `rule_generation`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `require_manual_review_for.empty_scene` | boolean | `true` | Hold rules whose `scenes` (tech / functional / business) are all empty in the review queue instead of persisting them. |
| `require_manual_review_for.low_quality_score` | number | `0.5` | Hold rules whose unified quality score is below this threshold in the review queue. |
| `review_queue.path` | string | `~/.autoimprove/review_queue.jsonl` | File path for the manual review queue (JSONL). |

> Orphaned-memory references are always blocked: a rule whose every
> `source_memory_ids` entry is missing or inactive is refused at `addRule()` time
> (see `RuleIndexManager.assertValidMemoryReferences`) and routed to the review
> queue.

## `local_ml`

Local embedding / clustering pipeline. Master switch `enabled` (default `false`
in the template). Not related to quality filtering; documented here for
completeness.

## `confidence_thresholds` / `confidence_weights` / `rule_matching`

Legacy tuning knobs for pattern confidence and rule matching. Unchanged by the
quality-control work; see `src/storage/init.ts` for the full schema.
