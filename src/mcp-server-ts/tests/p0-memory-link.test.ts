import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync, existsSync } from "fs";
import { MemoryStore } from "../src/storage/memory-store.js";
import { SQLiteMemoryStore } from "../src/storage/memory-sqlite-store.js";
import { MemoryConsolidator } from "../src/core/memory-consolidator.js";
import { findRelevantMemoryIds, resolveMemorySupport, FALLBACK_MEMORY_SUPPORT } from "../src/core/memory-support.js";
import { MemoryRecord } from "../src/core/memory-models.js";

const tmpFiles: string[] = [];
function tmpPath(name: string): string {
  const p = join(tmpdir(), `autoimprove-p0-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  tmpFiles.push(p);
  return p;
}
afterEach(() => {
  for (const f of tmpFiles) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    try { if (existsSync(f + "-wal")) unlinkSync(f + "-wal"); } catch { /* ignore */ }
    try { if (existsSync(f + "-shm")) unlinkSync(f + "-shm"); } catch { /* ignore */ }
  }
  tmpFiles.length = 0;
});

function mkRecord(over: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: over.id ?? "mem-x",
    kind: over.kind ?? "procedural",
    content: over.content ?? "default content",
    summary: over.summary ?? over.content ?? "default content",
    pattern_type: over.pattern_type,
    scene: over.scene ?? { tech: [], functional: [], business: [] },
    keywords: over.keywords ?? [],
    evidence: over.evidence ?? [],
    confidence: over.confidence ?? 0.8,
    importance: over.importance ?? 0.7,
    strength: over.strength ?? 2,
    created_at: over.created_at ?? new Date().toISOString(),
    updated_at: over.updated_at ?? new Date().toISOString(),
    valid_from: over.valid_from ?? new Date().toISOString(),
    status: over.status ?? "active",
    state: over.state ?? "observed",
    namespace: over.namespace ?? {},
    outcome: over.outcome,
    metadata: over.metadata ?? {},
    ...over,
  };
}

describe("P0 — 缺陷 A/E 修复：规则↔记忆链接 + 后端回退", () => {
  it("A2: MemoryStore.reload() 让独立实例看到其他实例写入的记忆", () => {
    const path = tmpPath("reload.jsonl");

    // 模拟引擎持有的、在写入之前构造的空实例（此时文件尚不存在）
    const reader = new MemoryStore(path);
    expect(reader.list().length).toBe(0);

    // 分析阶段由另一个实例写入记忆到同一文件
    const writer = new MemoryStore(path);
    writer.apply({ decision: "ADD", memory: mkRecord({ id: "m1", content: "Always prefer absolute paths over relative paths" }) });

    // 修复前：reader 持有构造时的空 Map，查不到任何记忆 → source_memory_ids 全空
    // 修复后：reload() 让 reader 看到文件后续写入的内容
    reader.reload();
    const list = reader.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("m1");
  });

  it("A1: 注入的 MemoryRepository 会收到 MemoryConsolidator 的写入（共享实例，JSONL 后端不再隔离）", () => {
    const store = new MemoryStore(tmpPath("inject.jsonl"));
    const consolidator = new MemoryConsolidator(store); // 注入共享 store
    const mut = consolidator.persist(mkRecord({ id: "m2", content: "Use absolute paths for tool call arguments" }));
    expect(mut.decision).toBe("ADD");
    expect(store.list().length).toBe(1);
    expect(store.list()[0].id).toBe("m2");
  });

  it("A: findRelevantMemoryIds 在 store 已填充时能找到相关记忆（修复前查空 Map 返回 []）", () => {
    const store = new MemoryStore(tmpPath("lookup.jsonl"));
    store.apply({ decision: "ADD", memory: mkRecord({ id: "m3", kind: "preference", content: "When providing file paths as tool call arguments, always prefer absolute paths over relative paths", keywords: ["absolute", "paths", "tool"] }) });

    const ids = findRelevantMemoryIds(store, "use absolute paths instead of relative paths for tool calls", {});
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("m3");

    const support = resolveMemorySupport(store, ids);
    expect(support.ids.length).toBeGreaterThan(0);
    expect(support.score).not.toBe(FALLBACK_MEMORY_SUPPORT); // 不再是写死的 0.5
  });

  it("E1: SQLite 记忆后端现在可构造（better-sqlite3 与运行时 Node 22 ABI 匹配）", () => {
    const dbPath = tmpPath("sqlite.db");
    let store: SQLiteMemoryStore | null = null;
    expect(() => { store = new SQLiteMemoryStore(dbPath); }).not.toThrow();
    expect(store).not.toBeNull();
    // 写入并读回，验证不是空壳
    store!.apply({ decision: "ADD", memory: mkRecord({ id: "sq1", content: "sqlite roundtrip works" }) });
    const list = store!.list();
    expect(list.length).toBe(1);
    store!.close();
  });
});
