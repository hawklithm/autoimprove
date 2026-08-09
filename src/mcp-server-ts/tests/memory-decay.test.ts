import { describe, expect, it } from "vitest";
import { MemoryDecayService } from "../src/core/memory-decay.js";
import { MemoryMutation, MemoryRecord, MemoryRepository } from "../src/core/memory-models.js";

/** 内存版 MemoryRepository 桩，便于纯逻辑测试 */
class InMemoryRepo implements MemoryRepository {
  private store = new Map<string, MemoryRecord>();
  constructor(seed: MemoryRecord[]) {
    for (const m of seed) this.store.set(m.id, m);
  }
  list(): MemoryRecord[] {
    return [...this.store.values()];
  }
  search(): MemoryRecord[] {
    return [];
  }
  apply(mutation: MemoryMutation): MemoryRecord {
    this.store.set(mutation.memory.id, mutation.memory);
    return mutation.memory;
  }
}

function baseMemory(over: Partial<MemoryRecord> & { id: string }): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: over.id,
    kind: "procedural",
    content: "stub content",
    summary: "stub",
    scene: { tech: [], functional: [], business: [] },
    keywords: [],
    evidence: [],
    confidence: 0.8,
    importance: 0.7,
    strength: 1,
    created_at: now,
    updated_at: now,
    valid_from: now,
    status: "active",
    state: "observed",
    info_class: "experience",
    ...over
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

describe("MemoryDecayService", () => {
  it("archives a TTL-expired memory and collects dependent rules", () => {
    const mem = baseMemory({ id: "m1", expires_at: new Date(NOW - 2 * DAY).toISOString() });
    const rules = new Map<string, string[]>([["m1", ["r1", "r2"]]]);
    const repo = new InMemoryRepo([mem]);
    const svc = new MemoryDecayService(repo, id => rules.get(id) || []);
    const res = svc.runDecay({ now: NOW });
    expect(res.archived).toBe(1);
    expect(res.rules_to_demote).toEqual(["r1", "r2"]);
    expect(repo.list().find(m => m.id === "m1")!.status).toBe("archived");
  });

  it("archives a memory explicitly marked deprecated", () => {
    const mem = baseMemory({ id: "m2", state: "deprecated" });
    const repo = new InMemoryRepo([mem]);
    const res = new MemoryDecayService(repo).runDecay({ now: NOW });
    expect(res.archived).toBe(1);
    expect(repo.list().find(m => m.id === "m2")!.status).toBe("archived");
  });

  it("prioritizes eliminating a contradicted memory", () => {
    const mem = baseMemory({ id: "m3", metadata: { conflict_with: "m0" } });
    const repo = new InMemoryRepo([mem]);
    const res = new MemoryDecayService(repo).runDecay({ now: NOW });
    expect(res.archived).toBe(1);
    expect(res.details[0].reason).toContain("否定");
  });

  it("soft-deprecates a stale low-recall experience but keeps preferences", () => {
    const oldExp = baseMemory({
      id: "m4",
      info_class: "experience",
      created_at: new Date(NOW - 400 * DAY).toISOString(),
      recall_count: 0
    });
    const oldPref = baseMemory({
      id: "m5",
      info_class: "preference",
      created_at: new Date(NOW - 400 * DAY).toISOString(),
      recall_count: 0
    });
    const repo = new InMemoryRepo([oldExp, oldPref]);
    const res = new MemoryDecayService(repo).runDecay({ now: NOW });
    expect(res.deprecated).toBe(1); // only the experience
    expect(repo.list().find(m => m.id === "m4")!.state).toBe("deprecated");
    expect(repo.list().find(m => m.id === "m5")!.state).not.toBe("deprecated");
  });

  it("does not decay a recently-recalled memory", () => {
    const mem = baseMemory({
      id: "m6",
      info_class: "experience",
      created_at: new Date(NOW - 400 * DAY).toISOString(),
      recall_count: 0,
      last_recalled_at: new Date(NOW - 10 * DAY).toISOString()
    });
    const repo = new InMemoryRepo([mem]);
    const res = new MemoryDecayService(repo).runDecay({ now: NOW });
    expect(res.archived + res.deprecated).toBe(0);
  });

  it("recordUsage bumps recall_count and refreshes last_recalled_at", () => {
    const mem = baseMemory({ id: "m7", recall_count: 2 });
    const repo = new InMemoryRepo([mem]);
    const svc = new MemoryDecayService(repo);
    svc.recordUsage("m7", NOW);
    const updated = repo.list().find(m => m.id === "m7")!;
    expect(updated.recall_count).toBe(3);
    expect(updated.last_recalled_at).toBe(new Date(NOW).toISOString());
  });

  it("dryRun evaluates without mutating", () => {
    const mem = baseMemory({ id: "m8", state: "deprecated" });
    const repo = new InMemoryRepo([mem]);
    const res = new MemoryDecayService(repo).runDecay({ now: NOW, dryRun: true });
    expect(res.archived).toBe(1);
    expect(repo.list().find(m => m.id === "m8")!.status).toBe("active");
  });
});
