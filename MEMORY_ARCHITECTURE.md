# AutoImprove Memory Architecture

## Storage

Runtime uses `~/.autoimprove/memories/memory.sqlite` by default. The database contains:

- `memories`: active and historical memory records
- `memory_versions`: every ADD, UPDATE, and SUPERSEDE snapshot
- `memory_entities`: normalized entity links
- `memory_relations`: subject/predicate/object facts with validity windows
- `memory_usage`: recall, application, validation, and rejection events

If the platform-specific SQLite native module is unavailable, the runtime falls back to `~/.autoimprove/memories/memories.jsonl`.

Migrate an existing JSONL store with:

```bash
npm run memory:migrate
```

## Memory lifecycle

```text
session → signal/pattern analysis → structured reflection
        → candidate memory → namespace/entity-aware consolidation
        → ADD / UPDATE / SUPERSEDE / NOOP
        → hybrid retrieval + usage feedback
```

Memory types are semantic, episodic, and procedural. Procedural memories can later become reusable rules, while episodic memories preserve the original wording and evidence.

## Retrieval

`search_memory` returns active memories with score, match reasons, confidence, scope, and provenance. `search_knowledge` also includes related learned memories alongside matching rules.

Run the deterministic smoke benchmark with:

```bash
npm run memory:benchmark
```

The benchmark reports:

- `recall_at_1` and `recall_at_5`
- `mrr` (mean reciprocal rank)
- `mean_precision_at_5`
- project namespace accuracy
- temporal contradiction accuracy
- irrelevant-memory suppression

It includes English, Chinese, namespace, temporal supersede, and unrelated-query cases. Add representative sessions and more difficult paraphrases before changing retrieval weights.
