/**
 * MemoryRuleAdapter — 方向2 将 promoted MemoryRecord 转换为规则生成输入
 */
import { describe, it, expect } from "vitest";
import { MemoryRuleAdapter } from "../src/core/memory-rule-adapter.js";
import { PatternType } from "../src/core/models.js";
import type { MemoryRecord } from "../src/core/memory-models.js";

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem-1",
    kind: "procedural",
    content: "Use parameterized queries to avoid SQL injection",
    summary: "use parameterized queries",
    scene: {} as any,
    keywords: [],
    evidence: [{ source_excerpt: "always use prepared statements", session_id: "s1" } as any],
    confidence: 0.8,
    importance: 0.6,
    strength: 3,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    valid_from: "2024-01-01T00:00:00Z",
    status: "active",
    info_class: "experience",
    independent_session_count: 2,
    independent_project_count: 1,
    validation_count: 1,
    metadata: {
      promotion_score: 0.85,
      promotion_scope: "project",
      generalization_confidence: 0.7,
      promotion_reason: "cross-project validation",
    },
    namespace: { project_path: "/proj/a", organization_id: "org-1", repository: "r", branch: "main" },
    ...overrides,
  } as MemoryRecord;
}

describe("MemoryRuleAdapter.fromPromotedMemory", () => {
  it("maps core fields and reads promotion metadata", () => {
    const input = MemoryRuleAdapter.fromPromotedMemory(makeMemory());
    expect(input.memory_id).toBe("mem-1");
    expect(input.content).toBe("Use parameterized queries to avoid SQL injection");
    expect(input.info_class).toBe("experience");
    expect(input.promotion.score).toBeCloseTo(0.85, 5);
    expect(input.promotion.scope).toBe("project");
    expect(input.promotion.confidence).toBeCloseTo(0.7, 5);
    expect(input.promotion.reason).toBe("cross-project validation");
    expect(input.scope_context?.project_path).toBe("/proj/a");
    expect(input.stats.independent_sessions).toBe(2);
    expect(input.stats.validation_count).toBe(1);
  });

  it("falls back to safe defaults when promotion metadata is absent", () => {
    const input = MemoryRuleAdapter.fromPromotedMemory(
      makeMemory({ metadata: {}, info_class: undefined })
    );
    expect(input.promotion.scope).toBe("project"); // default safest
    expect(input.promotion.confidence).toBeCloseTo(0.5, 5);
    expect(input.info_class).toBe("experience"); // default class
  });

  it("keeps only meaningful evidence excerpts (length > 10)", () => {
    const input = MemoryRuleAdapter.fromPromotedMemory(
      makeMemory({ evidence: [{ source_excerpt: "short", session_id: "s1" } as any, { source_excerpt: "a sufficiently long excerpt here", session_id: "s2" } as any] })
    );
    expect(input.evidence_excerpts).toEqual(["a sufficiently long excerpt here"]);
  });
});

describe("MemoryRuleAdapter memoryToPatternType mapping", () => {
  const cases: Array<[string, PatternType]> = [
    ["Validate requests to prevent XSS and CSRF security issues", PatternType.SECURITY],
    ["Use parameterized queries to avoid SQL injection", PatternType.SECURITY],
    ["Sanitize user input to prevent command injection vulnerabilities", PatternType.SECURITY],
    ["Memoize expensive computations to improve performance", PatternType.PERFORMANCE],
    ["Fix the null dereference bug in the parser", PatternType.ANTI_PATTERN],
    ["Prefer early returns for readability", PatternType.REPEATED_CORRECTION],
  ];

  it.each(cases)("maps '%s' -> %s", (content, expected) => {
    const input = MemoryRuleAdapter.fromPromotedMemory(
      makeMemory({ content, summary: content, info_class: "experience" })
    );
    expect(input.pattern_type).toBe(expected);
  });

  it("maps preference info_class to PREFERENCE", () => {
    const input = MemoryRuleAdapter.fromPromotedMemory(makeMemory({ info_class: "preference" }));
    expect(input.pattern_type).toBe(PatternType.PREFERENCE);
  });
});

describe("MemoryRuleAdapter.groupByScope", () => {
  it("groups inputs by promotion scope", () => {
    const a = MemoryRuleAdapter.fromPromotedMemory(makeMemory({ id: "1", metadata: { promotion_scope: "project" } }));
    const b = MemoryRuleAdapter.fromPromotedMemory(makeMemory({ id: "2", metadata: { promotion_scope: "global" } }));
    const groups = MemoryRuleAdapter.groupByScope([a, b]);
    expect(groups.get("project")?.length).toBe(1);
    expect(groups.get("global")?.length).toBe(1);
  });
});
