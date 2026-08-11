/**
 * KnowledgeHealthAnalyzer — 生成规则/记忆健康度报告
 */
import { describe, it, expect } from "vitest";
import { KnowledgeHealthAnalyzer } from "../src/core/knowledge-health.js";
import type { RuleIndexEntry } from "../src/core/models.js";
import type { MemoryRecord } from "../src/core/memory-models.js";

function fakeIndexManager(rules: Partial<RuleIndexEntry>[]) {
  return { getAllRules: () => rules as RuleIndexEntry[] };
}
function fakeMemoryStore(memories: Partial<MemoryRecord>[]) {
  return { list: () => memories as MemoryRecord[] };
}

describe("KnowledgeHealthAnalyzer.getReport", () => {
  it("computes memory and rule aggregates correctly", () => {
    const rules = [
      { id: "r1", status: "active", source_memory_ids: ["m1"], usage_count: 10, acceptance_count: 4, correction_count: 1, confidence: 0.8 } as any,
      { id: "r2", status: "candidate", source_memory_ids: [], usage_count: 0, acceptance_count: 0, correction_count: 0, confidence: 0.4 } as any,
    ];
    const memories = [
      { id: "m1", status: "active", kind: "procedural", state: "promoted", validation_count: 2, contradiction_count: 0 } as any,
      { id: "m2", status: "active", kind: "semantic", state: "observed", validation_count: 0, contradiction_count: 1 } as any,
      { id: "m3", status: "deprecated", kind: "episodic", state: "deprecated", validation_count: 0, contradiction_count: 0 } as any,
    ];

    const analyzer = new KnowledgeHealthAnalyzer(
      fakeIndexManager(rules) as any,
      fakeMemoryStore(memories) as any
    );
    const report = analyzer.getReport();

    expect(report.memories.total).toBe(3);
    expect(report.memories.active).toBe(2);
    expect(report.memories.by_kind.procedural).toBe(1);
    expect(report.memories.contradiction_count).toBe(1);

    expect(report.rules.total).toBe(2);
    expect(report.rules.linked_to_memory).toBe(1);
    expect(report.rules.memory_link_rate).toBeCloseTo(0.5, 5);
    expect(report.rules.average_confidence).toBeCloseTo(0.6, 5);
    expect(report.rules.usage_count).toBe(10);
    expect(report.rules.acceptance_count).toBe(4);
    expect(report.rules.acceptance_rate).toBeCloseTo(0.4, 5);
    expect(report.rules.correction_rate).toBeCloseTo(0.1, 5);
  });

  it("handles empty stores without dividing by zero", () => {
    const analyzer = new KnowledgeHealthAnalyzer(
      fakeIndexManager([]) as any,
      fakeMemoryStore([]) as any
    );
    const report = analyzer.getReport();
    expect(report.rules.memory_link_rate).toBe(0);
    expect(report.rules.average_confidence).toBe(0);
    expect(report.rules.acceptance_rate).toBe(0);
  });
});
