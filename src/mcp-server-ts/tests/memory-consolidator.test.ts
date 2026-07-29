import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryConsolidator } from "../src/core/memory-consolidator.js";
import { MemoryRecord } from "../src/core/memory-models.js";
import { MemoryStore } from "../src/storage/memory-store.js";

function memory(id: string, content: string, session = "s1"): MemoryRecord {
  return {
    id,
    kind: "procedural",
    content,
    summary: content,
    scene: { tech: ["typescript"], functional: ["testing"], business: [] },
    keywords: ["typescript", "testing"],
    evidence: [{ session_id: session, message_lines: [10], source_excerpt: content }],
    confidence: 0.8,
    importance: 0.7,
    strength: 1,
    created_at: "2026-07-28T00:00:00.000Z",
    updated_at: "2026-07-28T00:00:00.000Z",
    valid_from: "2026-07-28T00:00:00.000Z",
    status: "active"
  };
}

describe("MemoryConsolidator", () => {
  it("adds new memories and merges repeated evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "autoimprove-memory-"));
    const path = join(root, "memories.jsonl");
    try {
      const store = new MemoryStore(path);
      const consolidator = new MemoryConsolidator(store);
      expect(consolidator.persist(memory("m1", "Always run TypeScript tests before committing")).decision).toBe("ADD");
      expect(consolidator.persist(memory("m2", "Always run TypeScript tests before committing", "s2")).decision).toBe("UPDATE");
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0].evidence).toHaveLength(2);
      expect(readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves history when a similar procedural memory changes", () => {
    const root = mkdtempSync(join(tmpdir(), "autoimprove-memory-"));
    try {
      const store = new MemoryStore(join(root, "memories.jsonl"));
      const consolidator = new MemoryConsolidator(store);
      consolidator.persist(memory("m1", "Always run TypeScript tests before merging"));
      const mutation = consolidator.persist(memory("m2", "Always run TypeScript tests after merging"));
      expect(mutation.decision).toBe("SUPERSEDE");
      expect(store.list()).toHaveLength(2);
      expect(store.list({ activeOnly: true })).toHaveLength(1);
      expect(store.list().find(item => item.id === "m1")?.status).toBe("superseded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
