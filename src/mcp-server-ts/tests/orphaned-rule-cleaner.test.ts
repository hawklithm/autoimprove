import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { RuleIndexManager } from "../src/storage/rule-index.js";
import { OrphanedRuleCleaner } from "../src/core/orphaned-rule-cleaner.js";
import {
  createRuleIndexEntry,
  createRuleContent,
  PatternType,
  Priority,
  RuleScope,
} from "../src/core/models.js";
import { MemoryRepository, MemoryRecord } from "../src/core/memory-models.js";

function makeMemoryRepo(activeIds: string[]): MemoryRepository {
  const records: MemoryRecord[] = activeIds.map((id, i) => ({
    id,
    kind: "procedural",
    content: `memory ${id}`,
    summary: `memory ${id}`,
    scene: { tech: [], functional: [], business: [] },
    keywords: [],
    evidence: [],
    confidence: 0.8,
    importance: 0.6,
    strength: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    valid_from: new Date().toISOString(),
    status: "active",
  }));
  return {
    list: (opts?: { activeOnly?: boolean }) =>
      opts?.activeOnly ? records : records,
    search: () => [],
    apply: (m) => m.memory,
  };
}

const TMP_ROOTS: string[] = [];

function freshStorageRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "orphan-clean-"));
  // Force the JSON storage backend so the unit tests are independent of the
  // native better-sqlite3 module (which may be compiled for a different Node).
  const rulesDir = join(root, "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, "index.json"), JSON.stringify({ version: "1.0", rules: [] }));
  TMP_ROOTS.push(root);
  return root;
}

function addRule(
  index: RuleIndexManager,
  id: string,
  sourceMemoryIds: string[],
  scenes: { tech: string[]; functional: string[]; business: string[] } = { tech: ["typescript"], functional: [], business: [] }
) {
  const entry = createRuleIndexEntry({
    id,
    type: PatternType.PREFERENCE,
    priority: Priority.MEDIUM,
    confidence: 0.7,
    keywords: ["ts"],
    scenes,
    source_memory_ids: sourceMemoryIds,
    status: "active",
    scope: RuleScope.GLOBAL,
  });
  index.addRule(
    entry,
    createRuleContent({ id, content: `Rule ${id} content about typescript`, reason: "test" })
  );
}

describe("OrphanedRuleCleaner", () => {
  let root: string;
  let index: RuleIndexManager;
  let memoryStore: MemoryRepository;

  beforeEach(() => {
    root = freshStorageRoot();
    vi.stubEnv("AUTOIMPROVE_STORAGE_ROOT", root);
    index = new RuleIndexManager();
    memoryStore = makeMemoryRepo(["mem-aaa", "mem-bbb"]);
  });

  afterAll(() => {
    for (const r of TMP_ROOTS) {
      try {
        rmSync(r, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    vi.unstubAllEnvs();
  });

  it("classifies rules into fully/partially/normal/no_references", () => {
    addRule(index, "rule-001", ["mem-aaa"]); // normal
    addRule(index, "rule-002", ["mem-ghost"]); // fully orphaned
    addRule(index, "rule-003", ["mem-aaa", "mem-ghost"]); // partially orphaned
    addRule(index, "rule-004", []); // no references

    const cleaner = new OrphanedRuleCleaner(index, memoryStore);
    const report = cleaner.audit();

    expect(report.total_rules).toBe(4);
    expect(report.normal).toBe(1);
    expect(report.fully_orphaned).toBe(1);
    expect(report.partially_orphaned).toBe(1);
    expect(report.no_references).toBe(1);

    const byId: Record<string, any> = {};
    for (const r of report.rules) byId[r.rule_id] = r;
    expect(byId["rule-002"].type).toBe("fully_orphaned");
    expect(byId["rule-002"].orphaned_memory_ids).toEqual(["mem-ghost"]);
    expect(byId["rule-003"].type).toBe("partially_orphaned");
    expect(byId["rule-003"].valid_memory_ids).toEqual(["mem-aaa"]);
  });

  it("dry-run archive does not mutate storage", () => {
    addRule(index, "rule-002", ["mem-ghost"]);

    const cleaner = new OrphanedRuleCleaner(index, memoryStore);
    const report = cleaner.clean({ action: "archive", dryRun: true });

    expect(report.dry_run).toBe(true);
    // still active, not archived
    expect(index.getRule("rule-002")!.status).toBe("active");
  });

  it("archive action archives fully-orphaned rules", () => {
    addRule(index, "rule-001", ["mem-aaa"]);
    addRule(index, "rule-002", ["mem-ghost"]);
    addRule(index, "rule-003", ["mem-aaa", "mem-ghost"]);

    const cleaner = new OrphanedRuleCleaner(index, memoryStore);
    const report = cleaner.clean({ action: "archive", dryRun: false });

    expect(index.getRule("rule-002")!.status).toBe("archived");
    expect(index.getRule("rule-001")!.status).toBe("active");
    expect(index.getRule("rule-003")!.status).toBe("active");
    const detail = report.rules.find((r) => r.rule_id === "rule-002");
    expect(detail!.action_taken).toBe("archived");
  });

  it("fix action trims partially-orphaned references to valid ids", () => {
    addRule(index, "rule-003", ["mem-aaa", "mem-ghost"]);

    const cleaner = new OrphanedRuleCleaner(index, memoryStore);
    const report = cleaner.clean({ action: "fix", dryRun: false });

    const fixed = index.getRule("rule-003")!;
    expect(fixed.source_memory_ids).toEqual(["mem-aaa"]);
    const detail = report.rules.find((r) => r.rule_id === "rule-003");
    expect(detail!.action_taken).toBe("fixed");
  });

  it("whitelist protects rules from mutation", () => {
    addRule(index, "rule-002", ["mem-ghost"]);

    const cleaner = new OrphanedRuleCleaner(index, memoryStore);
    const report = cleaner.clean({ action: "archive", dryRun: false, whitelist: ["rule-002"] });

    expect(index.getRule("rule-002")!.status).toBe("active");
    const detail = report.rules.find((r) => r.rule_id === "rule-002");
    expect(detail!.action_taken).toBe("skipped");
  });
});
