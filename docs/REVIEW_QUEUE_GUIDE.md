# Review Queue Guide

The review queue is the final safety net of AutoImprove's rule quality control.
Any rule that the generation pipeline refuses to auto-persist — because it has an
empty scene, a low quality score, orphaned memory references, or was rejected by
the LLM — is written to a JSONL file and held for human review.

## Where it lives

```
~/.autoimprove/review_queue.jsonl
```

One JSON object per line:

```json
{
  "ruleId": "rule-candidate-xyz",
  "reason": "empty_scene",          // empty_scene | low_quality | orphaned_memory | llm_rejected
  "content": "Proposed rule markdown…",
  "status": "pending",              // pending | approved | rejected
  "createdAt": "2026-08-12T09:00:00.000Z",
  "reviewedAt": null,
  "reviewNote": null
}
```

## Tools

### `list_review_queue`

List held rules. Optional `status` filter: `pending` | `approved` | `rejected`.

```json
{ "status": "pending" }
```

Returns the items plus a `pending` count.

### `approve_rule`

Approve a held rule. Approval does **not** by itself re-run generation — it marks
the item approved so downstream automation (or a manual `addRule`) can persist it.

```json
{ "rule_id": "rule-candidate-xyz", "note": "confirmed valid coding rule" }
```

### `reject_rule`

Reject a held rule. It will not be persisted.

```json
{ "rule_id": "rule-candidate-xyz", "note": "business content, not a coding rule" }
```

## CLI (cleanup & audit)

For bulk data hygiene, use the shell wrappers (they drive the TypeScript runners
directly — no `npx` network resolution):

```bash
# Report only (dry-run): classify every rule by memory-reference health
./scripts/cleanup-orphaned-rules.sh

# Show what would be archived (fully-orphaned rules)
./scripts/cleanup-orphaned-rules.sh --action archive

# Actually archive fully-orphaned rules (whitelist protects rule-002, rule-003)
./scripts/cleanup-orphaned-rules.sh --action archive --apply --whitelist rule-002,rule-003

# Trim partially-orphaned rules to their valid memory ids
./scripts/cleanup-orphaned-rules.sh --action fix --apply

# Full rule-set audit → writes ~/.autoimprove/audit_report.json
./scripts/audit-rules.sh

# Audit and preview which high-severity rules would be archived
./scripts/audit-rules.sh --batch-archive

# Actually archive them (whitelist protected)
./scripts/audit-rules.sh --batch-archive --apply --whitelist rule-002
```

> Both wrappers default to **dry-run**. Pass `--apply` to mutate storage, and
> `--whitelist id,id2` to exclude user-confirmed rules from archive/fix.

## Operator best practices

1. **Run `audit_rules` regularly** (e.g. in CI or a cron) and review the report.
2. **Treat `pending` items as suspect** — they were refused for a reason. Open the
   rule content, confirm whether it is genuinely a coding rule.
3. **Approve deliberately.** Approved rules bypass the quality gate, so only
   approve rules you've verified are correct and coding-related.
4. **Use the whitelist** when batch-archiving so you never delete rules you've
   explicitly decided to keep.
5. **Empty-scene / orphaned-memory rules are usually safe to archive** — they carry
   no usable signal. Low-quality rules deserve a quick manual glance first.
