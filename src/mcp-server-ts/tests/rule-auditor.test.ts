import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { RuleIndexManager } from "../src/storage/rule-index.js";
import { RuleAuditor } from "../src/core/rule-auditor.js";
import {
  createRuleIndexEntry,
  createRuleContent,
  PatternType,
  Priority,
  RuleScope,
} from "../src/core/models.js";
import { MemoryRepository, MemoryRecord } from "../src/core/memory-models.js";

function makeMemoryRepo(activeIds: string[]): MemoryRepository {
  const records: MemoryRecord[] = activeIds.map((id) => ({
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
    list: (opts?: { activeOnly?: boolean }) => (opts?.activeOnly ? records : records),
    search: () => [],
    apply: (m) => m.memory,
  };
}

const TMP_ROOTS: string[] = [];

function freshStorageRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "rule-audit-"));
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
  opts: {
    content: string;
    sourceMemoryIds?: string[];
    scenes?: { tech: string[]; functional: string[]; business: string[] };
    confidence?: number;
  }
) {
  const scenes = opts.scenes || { tech: ["typescript"], functional: [], business: [] };
  const entry = createRuleIndexEntry({
    id,
    type: PatternType.PREFERENCE,
    priority: Priority.MEDIUM,
    confidence: opts.confidence ?? 0.7,
    keywords: ["ts"],
    scenes,
    description: opts.content,
    source_memory_ids: opts.sourceMemoryIds || [],
    status: "active",
    scope: RuleScope.GLOBAL,
  });
  index.addRule(entry, createRuleContent({ id, content: opts.content, reason: "test" }));
}

describe("RuleAuditor", () => {
  let root: string;
  let index: RuleIndexManager;
  let memoryStore: MemoryRepository;
  let reportPath: string;

  beforeEach(() => {
    root = freshStorageRoot();
    vi.stubEnv("AUTOIMPROVE_STORAGE_ROOT", root);
    index = new RuleIndexManager();
    memoryStore = makeMemoryRepo(["mem-aaa", "mem-bbb"]);
    reportPath = join(root, "audit_report.json");
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

  function seedRules() {
    // empty scene
    addRule(index, "rule-001", {
      content: "Use typescript function for async calls.",
      scenes: { tech: [], functional: [], business: [] },
    });
    // low quality (vague, short, no structure)
    addRule(index, "rule-002", {
      content: "maybe possibly sometimes try to do the thing",
      confidence: 0.3,
    });
    // orphaned memory reference
    addRule(index, "rule-003", {
      content: "Use dependency injection in the service layer.",
      sourceMemoryIds: ["mem-ghost"],
    });
    // business-dominated content
    addRule(index, "rule-004", {
      content: "安排面试候选人，招聘产品经理，制定营销策略，推进销售线索转化。",
    });
  }

  it("detects all four issue categories", () => {
    seedRules();
    const auditor = new RuleAuditor(index, memoryStore);
    const report = auditor.generate(0.5);

    expect(report.total_rules).toBe(4);
    const has = (ruleId: string, issueType: string) =>
      report.issues.some((i) => i.rule_id === ruleId && i.issue_type === issueType);

    expect(has("rule-001", "empty_scene")).toBe(true);
    expect(has("rule-002", "low_quality")).toBe(true);
    expect(has("rule-003", "orphaned_memory")).toBe(true);
    expect(has("rule-004", "high_business_ratio")).toBe(true);
  });

  it("writes the audit report to disk", () => {
    seedRules();
    const auditor = new RuleAuditor(index, memoryStore);
    const report = auditor.generate(0.5);
    const path = auditor.writeReport(report, reportPath);

    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.total_rules).toBe(4);
    expect(parsed.summary.empty_scene).toBeGreaterThanOrEqual(1);
    expect(parsed.summary.low_quality).toBeGreaterThanOrEqual(1);
    expect(parsed.summary.orphaned_memory).toBeGreaterThanOrEqual(1);
    expect(parsed.summary.high_business_ratio).toBeGreaterThanOrEqual(1);
  });

  it("batchArchive dry-run lists high-severity flagged rules without mutating", () => {
    seedRules();
    const auditor = new RuleAuditor(index, memoryStore);
    const report = auditor.generate(0.5);
    const result = auditor.batchArchive(report, [], true);

    // high-severity issues: empty_scene (rule-001) + low_quality (rule-002)
    expect(result.dry_run).toBe(true);
    expect(result.archived).toEqual(expect.arrayContaining(["rule-001", "rule-002"]));
    // no storage mutation
    expect(index.getRule("rule-001")!.status).toBe("active");
  });

  it("batchArchive applies and excludes whitelisted rules", () => {
    seedRules();
    const auditor = new RuleAuditor(index, memoryStore);
    const report = auditor.generate(0.5);
    const result = auditor.batchArchive(report, ["rule-001"], false);

    expect(result.archived).toContain("rule-002");
    expect(result.archived).not.toContain("rule-001");
    expect(index.getRule("rule-002")!.status).toBe("archived");
    expect(index.getRule("rule-001")!.status).toBe("active");
  });
});
