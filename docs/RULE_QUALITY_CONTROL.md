# Rule Quality Control

AutoImprove learned the hard way: a single low-quality rule (the infamous
`rule-001`) — business content mis-recognized as a coding pattern, with an empty
scene and no backing memory — can pollute the whole knowledge base. To stop this
class of problem, the rule pipeline now enforces **four layers of quality control**
spanning Pattern Detection → Memory Extraction → Rule Generation.

## The four layers

```
Session ──▶ [L1] Pattern Detection   ──▶ [L2] Memory Extraction
                 content filter              content filter (+ code context)
                                                    │
                                                    ▼
                                            [L3] Rule Generation
                                          empty-scene / low-quality /
                                          orphaned-memory interception
                                          + technical_relevance & scene
                                            completeness scoring
                                                    │
                                                    ▼
                                          [L4] Review Queue
                                       manual approve / reject before persist
```

### Layer 1 — Pattern Detection content filter

`SessionAnalyzer` runs every detected pattern through `PatternContentFilter`
(`src/core/pattern-content-filter.ts`) before it leaves the analyzer.

- **Pure business content** (business keywords > 0 and code keywords = 0) is dropped.
- **Business-dominant content** (business ratio > 0.6) is dropped.
- Patterns that survive are tagged with `pattern.contentCategory` (`code` /
  `business` / `mixed` / `general`).
- Gated by `config.pattern_detection.enable_content_filter`.

An optional `PatternSemanticClassifier` (`src/core/pattern-semantic-classifier.ts`)
can escalate uncertain cases to an LLM when `use_llm_classification` is enabled.

### Layer 2 — Memory Extraction content filter

`SessionMemoryExtractor` (Phase 2) re-applies the same filter:

- Non-code patterns are rejected before any memory is generated (`filterCodePatterns`).
- `heuristicCandidates()` skips business messages and patterns lacking code context.
- The LLM prompt carries a strict "ONLY extract coding-related memories" constraint
  and returns `{"rejected": true, "reason": "..."}` for off-topic content.
- `MemoryWriteGate` adds a 4th question ("编程相关？") — business content is refused
  with `reject_reason: "non-code-content"`.
- Gated by `config.memory_extraction.enable_content_filter` (and optionally
  `require_code_context`).

### Layer 3 — Rule Generation guards

`HybridRuleGenerator` (Phase 3) intercepts low-quality or malformed rules:

- **Empty scene** (`scenes.tech/functional/business` all empty) → held for review.
- **Low quality score** (unified score < `rule_generation.require_manual_review_for.low_quality_score`) → held for review.
- **Orphaned memory references** — `RuleIndexManager.addRule()` refuses any rule
  whose every `source_memory_ids` entry is missing or inactive; `HybridRuleGenerator`
  routes such rules to the review queue instead of persisting.
- **LLM rejection** — if the generation prompt returns `{"rejected": true}`, the
  rule is held for review (`LLMContentRejectedError`).

The quality score itself was extended in Phase 3 with two new dimensions:

| Dimension | Weight | Meaning |
|-----------|--------|---------|
| `evidence_confidence` | 0.25 | confidence of supporting evidence |
| `clarity` | 0.15 | how clearly the rule is written |
| `specificity` | 0.15 | how specific / grounded the rule is |
| `actionability` | 0.15 | how directly applicable |
| `scope_confidence` | 0.10 | confidence in rule scope |
| `technical_relevance` | 0.15 | how coding-specific the rule is (NEW) |
| `scene_completeness` | 0.05 | whether scenes are populated (NEW) |

Implemented in `src/core/rule-quality.ts` (`assessUnifiedScore`,
`assessTechnicalRelevance`, `assessSceneCompleteness`).

### Layer 4 — Review Queue

Rules held by Layers 1–3 are written to a JSONL review queue
(`~/.autoimprove/review_queue.jsonl`) and **never auto-persisted**. An operator
inspects them with the `list_review_queue` MCP tool (or `audit_rules` / the audit
CLI) and decides via `approve_rule` / `reject_rule`.

## Interception criteria (quick reference)

| Problem | Caught at | Action |
|---------|-----------|--------|
| Business content in a pattern | L1 | dropped from patterns |
| Business memory candidate | L2 | not extracted |
| Empty-scene rule | L3 | → review queue |
| Low unified-quality rule | L3 | → review queue |
| Rule referencing missing memories | L3 | → review queue + `addRule` refused |
| LLM deems content off-topic | L3 | → review queue |

## Cleaning up existing data

The `OrphanedRuleCleaner` and `RuleAuditor` (Phase 4) operate on the already-stored
rule set:

- `cleanup_orphaned_rules` — scan for orphaned/inactive memory references, archive
  or fix them (dry-run by default).
- `audit_rules` — full audit (empty scenes, low quality, orphaned memory, business
  ratio) and optional batch archive.
- CLI wrappers: `scripts/cleanup-orphaned-rules.sh`, `scripts/audit-rules.sh`.

See [REVIEW_QUEUE_GUIDE.md](REVIEW_QUEUE_GUIDE.md) for the operator workflow.
