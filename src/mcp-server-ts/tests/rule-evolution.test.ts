/**
 * RuleEvolutionService — 依据反馈与源记忆重算规则状态/置信度
 */
import { describe, it, expect } from "vitest";
import { RuleEvolutionService } from "../src/core/rule-evolution.js";
import type { RuleIndexEntry, RuleContent } from "../src/core/models.js";
import type { MemoryRecord } from "../src/core/memory-models.js";

class FakeIndexManager {
  private rules = new Map<string, RuleIndexEntry>();
  constructor(seed: RuleIndexEntry[]) {
    for (const r of seed) this.rules.set(r.id, { ...r });
  }
  getRule(id: string) {
    return this.rules.get(id);
  }
  getAllRules() {
    return [...this.rules.values()];
  }
  updateRule(id: string, patch: Partial<RuleIndexEntry>) {
    const cur = this.rules.get(id)!;
    this.rules.set(id, { ...cur, ...patch });
  }
  replaceRule(id: string, updated: RuleIndexEntry) {
    this.rules.set(id, updated);
  }
}

class FakeContentManager {
  private contents = new Map<string, RuleContent>();
  constructor(seed: Record<string, RuleContent>) {
    for (const [k, v] of Object.entries(seed)) this.contents.set(k, v);
  }
  loadContent(id: string) {
    return this.contents.get(id);
  }
  saveContent(content: RuleContent) {
    this.contents.set(content.id as string, content);
  }
}

class FakeMemoryStore {
  constructor(private memories: MemoryRecord[]) {}
  list() {
    return this.memories;
  }
}

function makeRule(overrides: Partial<RuleIndexEntry> = {}): RuleIndexEntry {
  return {
    id: "r1",
    rule_id: "r1",
    title: "t",
    description: "d",
    content: "Use React useState hook instead of class state for component state.",
    scope: "project" as any,
    status: "active",
    confidence: 0.5,
    usage_count: 0,
    acceptance_count: 0,
    correction_count: 0,
    contradiction_count: 0,
    source_memory_ids: ["m1"],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    valid_from: "2024-01-01T00:00:00Z",
    ...overrides,
  } as RuleIndexEntry;
}

describe("RuleEvolutionService.recordFeedback", () => {
  function setup(rule = makeRule(), memories: MemoryRecord[] = []) {
    const index = new FakeIndexManager([rule]);
    const content = new FakeContentManager({
      r1: {
        id: "r1",
        rule_id: "r1",
        content: "Use React useState hook instead of class state for component state.",
        metadata: { evidence_confidence: 0.8, scope_confidence: 0.6 },
      } as RuleContent,
    });
    const store = new FakeMemoryStore(memories);
    const svc = new RuleEvolutionService(index as any, content as any, store as any);
    return { index, content, store, svc };
  }

  it("increments acceptance_count and keeps rule active on accepted feedback", () => {
    const { svc, index } = setup();
    svc.recordFeedback("r1", "accepted");
    const rule = index.getRule("r1")!;
    expect(rule.acceptance_count).toBe(1);
    expect(rule.status).toBe("active");
  });

  it("disables the rule on disabled feedback", () => {
    const { svc, index } = setup();
    svc.recordFeedback("r1", "disabled");
    expect(index.getRule("r1")!.status).toBe("disabled");
  });

  it("marks rule deprecated on contradicted feedback", () => {
    const { svc, index } = setup();
    svc.recordFeedback("r1", "contradicted");
    expect(index.getRule("r1")!.status).toBe("deprecated");
    expect(index.getRule("r1")!.contradiction_count).toBe(1);
  });

  it("increments usage_count only for recalled/applied feedback", () => {
    const { svc, index } = setup();
    svc.recordFeedback("r1", "recalled");
    svc.recordFeedback("r1", "corrected");
    expect(index.getRule("r1")!.usage_count).toBe(1);
    expect(index.getRule("r1")!.correction_count).toBe(1);
  });
});

describe("RuleEvolutionService.reevaluateRule", () => {
  it("writes a computed confidence and memory_support_score into content metadata", () => {
    const index = new FakeIndexManager([makeRule()]);
    const content = new FakeContentManager({
      r1: {
        id: "r1",
        rule_id: "r1",
        content: "Use React useState hook instead of class state for component state.",
        metadata: { evidence_confidence: 0.8, scope_confidence: 0.6 },
      } as RuleContent,
    });
    const store = new FakeMemoryStore([
      { id: "m1", confidence: 0.9, importance: 0.5, strength: 3, state: "promoted", validation_count: 2 } as any,
    ]);
    const svc = new RuleEvolutionService(index as any, content as any, store as any);

    const updated = svc.reevaluateRule("r1")!;
    expect(updated).toBeDefined();
    expect(updated.confidence).toBeGreaterThanOrEqual(0);
    expect(updated.confidence).toBeLessThanOrEqual(1);
    const saved = content.loadContent("r1")!;
    expect((saved.metadata as any).memory_support_score).toBeGreaterThanOrEqual(0);
    expect((saved.metadata as any).lifecycle_reason).toContain("validated");
  });

  it("deprecates a rule when its source memory is contradicted", () => {
    const index = new FakeIndexManager([makeRule()]);
    const content = new FakeContentManager({
      r1: {
        id: "r1",
        rule_id: "r1",
        content: "Use React useState hook instead of class state for component state.",
        metadata: { evidence_confidence: 0.8, scope_confidence: 0.6 },
      } as RuleContent,
    });
    const store = new FakeMemoryStore([
      { id: "m1", confidence: 0.9, importance: 0.5, strength: 3, state: "deprecated", contradiction_count: 1 } as any,
    ]);
    const svc = new RuleEvolutionService(index as any, content as any, store as any);

    const updated = svc.reevaluateRule("r1")!;
    expect(updated.status).toBe("deprecated");
    expect((content.loadContent("r1")!.metadata as any).lifecycle_reason).toContain("contradiction");
  });
});
