import { describe, it, expect } from "vitest";
import {
  MemoryRecord,
  MemoryRepository,
  MemorySearchResult,
} from "../src/core/memory-models.js";
import {
  computeMemorySupportScore,
  resolveMemorySupport,
  findRelevantMemoryIds,
  FALLBACK_MEMORY_SUPPORT,
} from "../src/core/memory-support.js";

function mkRecord(over: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: over.id ?? "mem-x",
    kind: over.kind ?? "procedural",
    content: over.content ?? "default content",
    summary: over.summary ?? over.content ?? "default content",
    scene: over.scene ?? { tech: [], functional: [], business: [] },
    keywords: over.keywords ?? [],
    evidence: over.evidence ?? [],
    confidence: over.confidence ?? 0.9,
    importance: over.importance ?? 0.85,
    strength: over.strength ?? 5,
    created_at: over.created_at ?? new Date().toISOString(),
    updated_at: over.updated_at ?? new Date().toISOString(),
    valid_from: over.valid_from ?? new Date().toISOString(),
    status: over.status ?? "active",
    state: over.state ?? "observed",
    validation_count: over.validation_count ?? 3,
    independent_session_count: over.independent_session_count ?? 3,
    outcome: over.outcome ?? { status: "unknown" },
    metadata: over.metadata ?? {},
    ...over,
  } as MemoryRecord;
}

function makeRepo(records: MemoryRecord[]): MemoryRepository {
  const match = (q: string) => records.filter(r => r.content.includes(q) || r.summary.includes(q));
  return {
    list: (opts) => (opts?.activeOnly ? records.filter(r => r.status === "active") : records),
    search: (q) => match(q),
    searchScored: (q): MemorySearchResult[] =>
      match(q).map(r => ({ memory: r, score: 0.9, reasons: [] })),
    apply: (m) => m.memory,
  };
}

describe("computeMemorySupportScore", () => {
  it("returns the fallback when given no memories", () => {
    expect(computeMemorySupportScore([])).toBe(FALLBACK_MEMORY_SUPPORT);
  });

  it("scores a promoted memory higher than a fresh observation with identical signals", () => {
    const base = {
      confidence: 0.9,
      importance: 0.85,
      strength: 5,
      validation_count: 3,
      independent_session_count: 3,
      outcome: { status: "success" as const },
    };
    const promoted = mkRecord({
      ...base,
      id: "prom-1",
      state: "promoted",
      metadata: { promotion_score: 0.9 },
    });
    const fresh = mkRecord({
      ...base,
      id: "fresh-1",
      state: "observed",
    });

    const promotedScore = computeMemorySupportScore([promoted]);
    const freshScore = computeMemorySupportScore([fresh]);

    expect(promotedScore).toBeGreaterThan(freshScore);
    expect(promotedScore).toBeGreaterThan(0.9);
  });
});

describe("resolveMemorySupport", () => {
  const promoted = mkRecord({
    id: "prom-1",
    state: "promoted",
    metadata: { promotion_score: 0.9 },
    content: "use parameterized queries to avoid sql injection",
    outcome: { status: "success" },
  });
  const repo = makeRepo([promoted]);

  it("falls back to 0.5 with no ids", () => {
    expect(resolveMemorySupport(repo, [])).toEqual({ ids: [], score: FALLBACK_MEMORY_SUPPORT });
  });

  it("falls back to 0.35 when ids are not found", () => {
    expect(resolveMemorySupport(repo, ["does-not-exist"])).toEqual({ ids: [], score: 0.35 });
  });

  it("resolves real promoted memories to a strong score", () => {
    const result = resolveMemorySupport(repo, ["prom-1"]);
    expect(result.ids).toEqual(["prom-1"]);
    expect(result.score).toBeGreaterThan(0.9);
  });
});

describe("findRelevantMemoryIds", () => {
  const procedural = mkRecord({
    id: "proc-1",
    kind: "procedural",
    content: "avoid sql injection by parameterizing queries",
  });
  const episodic = mkRecord({
    id: "epi-1",
    kind: "episodic",
    content: "user mentioned sql injection today",
  });
  const repo = makeRepo([procedural, episodic]);

  it("returns empty for an empty query", () => {
    expect(findRelevantMemoryIds(repo, "   ")).toEqual([]);
  });

  it("finds non-episodic memories and excludes episodic ones", () => {
    const ids = findRelevantMemoryIds(repo, "sql injection");
    expect(ids).toContain("proc-1");
    expect(ids).not.toContain("epi-1");
  });

  it("returns empty when nothing matches", () => {
    expect(findRelevantMemoryIds(repo, "unrelated topic xyz")).toEqual([]);
  });
});
