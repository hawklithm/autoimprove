import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  MATCH_THRESHOLD,
  MERGE_THRESHOLD,
  MemorySimilarity,
  jaccardSimilarity
} from "../src/core/memory-similarity.js";
import { MemoryConsolidator } from "../src/core/memory-consolidator.js";
import { MemoryRecord, MemoryRelation } from "../src/core/memory-models.js";
import { MemoryStore } from "../src/storage/memory-store.js";

function memory(
  id: string,
  content: string,
  overrides: Partial<MemoryRecord> = {}
): MemoryRecord {
  return {
    id,
    kind: "procedural",
    content,
    summary: content,
    scene: { tech: ["typescript"], functional: ["testing"], business: [] },
    keywords: ["typescript", "testing"],
    evidence: [{ session_id: "s1", message_lines: [10], source_excerpt: content }],
    confidence: 0.8,
    importance: 0.7,
    strength: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    valid_from: "2026-08-01T00:00:00.000Z",
    status: "active",
    ...overrides
  };
}

function withStore(fn: (consolidator: MemoryConsolidator, store: MemoryStore) => void): void {
  const root = mkdtempSync(join(tmpdir(), "autoimprove-similarity-"));
  try {
    const store = new MemoryStore(join(root, "memories.jsonl"));
    fn(new MemoryConsolidator(store), store);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("[P2-1] MemorySimilarity", () => {
  const similarity = new MemorySimilarity();

  it("scores identical memories at the merge threshold", () => {
    const score = similarity.score(
      memory("a", "Always run the TypeScript build before committing"),
      memory("b", "Always run the TypeScript build before committing")
    );
    expect(score).toBeGreaterThanOrEqual(MERGE_THRESHOLD);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("never returns a score above 1 despite hash collisions", () => {
    // The hashed 2048-dim space computes its norm pre-collision, so the raw
    // cosine can drift slightly past 1.0. It must be clamped.
    for (const text of ["always run npm run build before committing", "禁止直接操作数据库，必须通过 MCP 工具"]) {
      const score = similarity.score(memory("a", text), memory("b", text));
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("scores unrelated memories below the match threshold", () => {
    const score = similarity.score(
      memory("a", "Always run the TypeScript build before committing"),
      memory("b", "用户偏好使用简体中文交流", { keywords: ["language", "chinese"] })
    );
    expect(score).toBeLessThan(MATCH_THRESHOLD);
  });

  it("catches paraphrases that word-set Jaccard scores at zero", () => {
    const a = "不要绕过 MCP 工具直接读写存储";
    const b = "禁止绕过 MCP 工具直接访问存储层";
    // Jaccard over content alone sees almost no shared tokens.
    expect(jaccardSimilarity(a, b)).toBeLessThan(0.3);
    const breakdown = similarity.compare(
      memory("a", a, { keywords: [] }),
      memory("b", b, { keywords: [] })
    );
    expect(breakdown.semantic).toBeGreaterThan(breakdown.lexical);
    expect(breakdown.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("keeps the Jaccard floor so pre-P2-1 matches never regress", () => {
    const breakdown = similarity.compare(
      memory("a", "use absolute paths for tool arguments"),
      memory("b", "use absolute paths for tool arguments")
    );
    expect(breakdown.score).toBeGreaterThanOrEqual(breakdown.lexical);
  });
});

describe("[P2-2] MemoryConsolidator three-way decision", () => {
  it("UPDATE: merges evidence for a semantically equivalent memory", () => {
    withStore((consolidator, store) => {
      expect(consolidator.persist(memory("m1", "Always run TypeScript tests before committing")).decision).toBe("ADD");
      const second = memory("m2", "Always run TypeScript tests before committing");
      second.evidence = [{ session_id: "s2", message_lines: [20] }];
      expect(consolidator.persist(second).decision).toBe("UPDATE");
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0].evidence).toHaveLength(2);
    });
  });

  it("SUPERSEDE: a contrastive qualifier means the user changed their mind", () => {
    withStore((consolidator, store) => {
      consolidator.persist(memory("m1", "Always run TypeScript tests before merging"));
      const mutation = consolidator.persist(
        memory("m2", "Always run TypeScript tests after merging", { updated_at: "2026-08-02T00:00:00.000Z" })
      );
      expect(mutation.decision).toBe("SUPERSEDE");
      expect(mutation.memory.metadata?.conflict_reason).toBe("contrastive-qualifier");
      expect(store.list({ activeOnly: true })).toHaveLength(1);
      expect(store.list().find(item => item.id === "m1")?.status).toBe("superseded");
    });
  });

  it("SUPERSEDE: an opposing obligation on the same subject overrides", () => {
    withStore((consolidator, store) => {
      consolidator.persist(memory("m1", "必须使用 MCP 工具访问数据库", { keywords: ["mcp", "数据库"] }));
      const mutation = consolidator.persist(
        memory("m2", "禁止使用 MCP 工具访问数据库", {
          keywords: ["mcp", "数据库"],
          updated_at: "2026-08-02T00:00:00.000Z"
        })
      );
      expect(mutation.decision).toBe("SUPERSEDE");
      expect(mutation.memory.metadata?.conflict_reason).toBe("opposing-obligation");
      expect(store.list({ activeOnly: true })).toHaveLength(1);
    });
  });

  it("SUPERSEDE: same subject+predicate with a new object replaces the old value", () => {
    const relation = (object: string): MemoryRelation[] => [
      { subject: "project", predicate: "test-runner", object }
    ];
    withStore((consolidator, store) => {
      consolidator.persist(memory("m1", "The project uses Jest as its test runner", { relations: relation("jest") }));
      const mutation = consolidator.persist(
        memory("m2", "The project uses Vitest as its test runner", {
          relations: relation("vitest"),
          updated_at: "2026-08-02T00:00:00.000Z"
        })
      );
      expect(mutation.decision).toBe("SUPERSEDE");
      expect(mutation.memory.metadata?.conflict_reason).toBe("relation-object-changed");
      expect(store.list({ activeOnly: true })).toHaveLength(1);
    });
  });

  it("ADD: same topic but complementary memories both survive", () => {
    // Regression guard for P2-1: on the char-ngram backend these two score
    // ~0.84, which the old "score >= 0.7 and same kind" rule would have
    // wrongly treated as SUPERSEDE.
    withStore((consolidator, store) => {
      consolidator.persist(memory("m1", "Always run npm run build before committing"));
      const mutation = consolidator.persist(
        memory("m2", "Always run npm run test before committing", { updated_at: "2026-08-02T00:00:00.000Z" })
      );
      expect(mutation.decision).toBe("ADD");
      expect(store.list({ activeOnly: true })).toHaveLength(2);
    });
  });

  it("ADD: a Chinese complementary pair is not collapsed either", () => {
    withStore((consolidator, store) => {
      consolidator.persist(memory("m1", "提交前必须先运行构建", { keywords: ["提交", "构建"] }));
      const mutation = consolidator.persist(
        memory("m2", "提交前必须先运行测试", {
          keywords: ["提交", "测试"],
          updated_at: "2026-08-02T00:00:00.000Z"
        })
      );
      expect(mutation.decision).toBe("ADD");
      expect(store.list({ activeOnly: true })).toHaveLength(2);
    });
  });

  it("never returns NOOP, so complementary candidates are not silently dropped", () => {
    withStore((consolidator) => {
      consolidator.persist(memory("m1", "Always run npm run build before committing"));
      const decisions = [
        consolidator.persist(memory("m2", "Always run npm run test before committing")).decision,
        consolidator.persist(memory("m3", "Always run npm run lint before committing")).decision
      ];
      expect(decisions).not.toContain("NOOP");
    });
  });
});
