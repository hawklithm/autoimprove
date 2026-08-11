/**
 * Memory-support scoring — the single source of truth for how strongly a
 * generated rule is backed by promoted memories.
 *
 * Previously the rule generators emitted a hard-coded 0.5 or an
 * evidence-count heuristic, and the orchestration layer re-derived a *different*
 * score via its own duplicated logic. This module centralises both the scoring
 * formula and the "find relevant promoted memories" search so every code path
 * agrees on what "memory support" means.
 *
 * Pure logic, storage-agnostic (depends only on the `MemoryRepository`
 * interface), so it is trivially unit-testable with an in-memory stub.
 */

import {
  MemoryRecord,
  MemoryRepository,
  MemorySearchResult,
  MemorySearchFilters,
} from "./memory-models.js";

/** Used when no promoted memory backs the rule. */
export const FALLBACK_MEMORY_SUPPORT = 0.5;

export interface MemorySupportResult {
  ids: string[];
  score: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return FALLBACK_MEMORY_SUPPORT;
  return Math.max(0, Math.min(1, n));
}

/**
 * Real promoted-memory-driven support score.
 *
 * Replaces the old 0.5 constant / evidence-count heuristic. A rule's "memory"
 * dimension should reflect how strongly the underlying promoted memories back
 * it. Promoted memories receive an extra boost from their explicit
 * `promotion_score`, so a rule derived from a well-corroborated, promoted
 * memory scores higher than one built from a single fresh observation.
 */
export function computeMemorySupportScore(memories: MemoryRecord[]): number {
  if (!memories.length) return FALLBACK_MEMORY_SUPPORT;

  const scores = memories.map((m) => {
    const outcome =
      m.outcome?.status === "success" ? 1 : m.outcome?.status === "failed" ? 0 : 0.5;

    const promotion =
      typeof m.metadata?.promotion_score === "number"
        ? (m.metadata.promotion_score as number)
        : 0.5;

    const validated = Math.min(1, (m.validation_count || 0) / 3);
    const sessions = Math.min(1, (m.independent_session_count || 1) / 3);
    const strength = Math.min(1, (m.strength || 1) / 5);
    const importance = m.importance ?? 0.5;

    // Promoted memories carry explicit, extra backing via their promotion score.
    const promotedBoost = m.state === "promoted" ? promotion * 0.1 : 0;

    return (
      m.confidence * 0.30 +
      validated * 0.15 +
      sessions * 0.15 +
      strength * 0.10 +
      importance * 0.10 +
      outcome * 0.10 +
      promotedBoost
    );
  });

  return clamp01(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Resolve a set of memory ids into real records and score how strongly they
 * back the rule. Returns the surviving ids (ids that no longer exist in the
 * store are dropped) and the unified support score.
 */
export function resolveMemorySupport(
  repo: MemoryRepository,
  ids: string[] | undefined
): MemorySupportResult {
  const clean = Array.from(new Set(ids || []));
  if (clean.length === 0) return { ids: [], score: FALLBACK_MEMORY_SUPPORT };

  const memories = repo.list({ activeOnly: true }).filter((m) => clean.includes(m.id));
  if (memories.length === 0) return { ids: [], score: 0.35 };

  return { ids: memories.map((m) => m.id), score: computeMemorySupportScore(memories) };
}

/**
 * Search promoted / non-episodic memories relevant to a query. This is the
 * "discovery" half of memory support — used to populate a cluster's
 * `source_memory_ids` so the link can be passed through into rule generation
 * instead of being fuzzy-searched again afterwards.
 */
export function findRelevantMemoryIds(
  repo: MemoryRepository,
  query: string,
  filters: MemorySearchFilters = {}
): string[] {
  if (!query.trim()) return [];

  const results: MemorySearchResult[] = repo.searchScored
    ? repo.searchScored(query, 8, filters)
    : repo
        .search(query, 8, filters)
        .map((memory) => ({ memory, score: 0.5, reasons: ["legacy-search"] }));

  const org = filters.organizationId?.toLowerCase();

  return results
    .filter(
      (r) =>
        r.memory.kind !== "episodic" &&
        r.score >= 0.25 &&
        (!org ||
          !r.memory.namespace?.organization_id ||
          r.memory.namespace.organization_id.toLowerCase() === org)
    )
    .slice(0, 5)
    .map((r) => r.memory.id);
}
