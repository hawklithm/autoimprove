import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryPromotionService } from "../src/core/memory-promotion.js";
import { MemoryConflictResolver } from "../src/core/memory-conflict-resolver.js";
import { MemoryRecord, MemoryMutation, MemoryRepository } from "../src/core/memory-models.js";
import { SQLiteMemoryStore } from "../src/storage/memory-sqlite-store.js";
import { RuleStorageSQLite } from "../src/storage/rule-storage-sqlite.js";
import { PatternType, Priority, createRuleContent, createRuleIndexEntry } from "../src/core/models.js";

function memory(partial: Partial<MemoryRecord>): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: partial.id || "memory-1",
    kind: "procedural",
    content: partial.content || "Always validate API responses before storing them",
    summary: partial.summary || partial.content || "Always validate API responses before storing them",
    scene: { tech: [], functional: ["api"], business: [] },
    keywords: ["api", "validation"],
    evidence: [{ session_id: "s1", message_lines: [1] }, { session_id: "s2", message_lines: [2] }],
    confidence: 0.85,
    importance: 0.8,
    strength: 3,
    created_at: now,
    updated_at: now,
    valid_from: now,
    status: "active",
    state: "supported",
    support_count: 2,
    independent_session_count: 2,
    independent_project_count: 3,
    validation_count: 1,
    contradiction_count: 0,
    metadata: { project_paths: ["/p/a", "/p/b", "/p/c"] },
    ...partial
  };
}

class FakeMemoryStore implements MemoryRepository {
  records: MemoryRecord[];
  constructor(records: MemoryRecord[]) { this.records = records; }
  list(): MemoryRecord[] { return this.records; }
  search(): MemoryRecord[] { return []; }
  apply(mutation: MemoryMutation): MemoryRecord {
    const index = this.records.findIndex(record => record.id === mutation.memory.id);
    if (index >= 0) this.records[index] = mutation.memory;
    else this.records.push(mutation.memory);
    return mutation.memory;
  }
}

describe("long-term memory lifecycle", () => {
  it("promotes a stable procedural memory and records cross-project scope", async () => {
    const store = new FakeMemoryStore([memory({})]);
    const promoted = await new MemoryPromotionService(store).promoteEligibleWithLLM();
    expect(promoted).toHaveLength(1);
    expect(promoted[0].state).toBe("promoted");
    expect(promoted[0].metadata?.promotion_scope).toBe("organization");
  }, 15000);

  it("blocks deterministic contradictions before promotion", () => {
    const resolver = new MemoryConflictResolver();
    const a = memory({ id: "a", content: "Always use Axios for HTTP requests", summary: "Always use Axios for HTTP requests" });
    const b = memory({ id: "b", content: "Never use Axios for HTTP requests", summary: "Never use Axios for HTTP requests" });
    expect(resolver.hasConflict(a, [a, b])).toBe(true);
  });

  it("persists memory, rule, and their support link in SQLite", () => {
    const root = mkdtempSync(join(tmpdir(), "autoimprove-sqlite-")).replace(/\\/g, "/");
    const memoryDb = join(root, "memories.sqlite");
    const previousRoot = process.env.AUTOIMPROVE_STORAGE_ROOT;
    process.env.AUTOIMPROVE_STORAGE_ROOT = root;
    const memories = new SQLiteMemoryStore(memoryDb);
    const rules = new RuleStorageSQLite();
    try {
      const record = memory({ id: "memory-sqlite-1" });
      memories.apply({ decision: "ADD", memory: record });
      const entry = createRuleIndexEntry({ id: "rule-sqlite-1", type: PatternType.PREFERENCE, priority: Priority.MEDIUM, confidence: 0.9 });
      rules.addRule(entry, createRuleContent({ id: entry.id, content: record.content, reason: "Derived from durable memory" }));
      memories.linkRule({ memory_id: record.id, rule_id: entry.id, relation: "supports", support_score: 0.9, created_at: record.created_at, updated_at: record.updated_at });

      expect(memories.list({ kind: "procedural" }).map(item => item.id)).toContain(record.id);
      expect(rules.getRule(entry.id)?.id).toBe(entry.id);
      expect(memories.getRulesForMemory(record.id)).toEqual([expect.objectContaining({ rule_id: entry.id, relation: "supports" })]);
    } finally {
      memories.close();
      rules.close();
      if (previousRoot === undefined) delete process.env.AUTOIMPROVE_STORAGE_ROOT;
      else process.env.AUTOIMPROVE_STORAGE_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
