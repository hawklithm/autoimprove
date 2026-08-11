/**
 * FactUpgrader — 方向3 将满足条件的 fact 升级为 experience
 */
import { describe, it, expect } from "vitest";
import { FactUpgrader } from "../src/core/fact-upgrader.js";
import type { MemoryRecord } from "../src/core/memory-models.js";

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    kind: "semantic",
    content: "Always validate input before processing",
    summary: "validate input",
    scene: {} as any,
    keywords: [],
    evidence: [],
    confidence: 0.6,
    importance: 0.5,
    strength: 2,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    valid_from: "2024-01-01T00:00:00Z",
    status: "active",
    info_class: "fact",
    ...overrides,
  } as MemoryRecord;
}

describe("FactUpgrader.evaluate", () => {
  const upgrader = new FactUpgrader();

  it("does not upgrade non-fact memories", () => {
    const result = upgrader.evaluate(makeMemory({ info_class: "experience" }));
    expect(result.should_upgrade).toBe(false);
    expect(result.reason).toContain("not a fact");
    expect(result.upgraded_class).toBe("fact");
  });

  it("upgrades a fact meeting high_recall + user_confirmed (score 0.7)", () => {
    const result = upgrader.evaluate(
      makeMemory({
        recall_count: 3,
        outcome: { user_confirmed: true } as any,
      })
    );
    expect(result.should_upgrade).toBe(true);
    expect(result.upgraded_class).toBe("experience");
    expect(result.upgraded_kind).toBe("procedural");
    expect(result.confidence).toBeCloseTo(0.7, 5);
  });

  it("does NOT upgrade a fact with only one condition met", () => {
    const result = upgrader.evaluate(makeMemory({ recall_count: 3 }));
    expect(result.should_upgrade).toBe(false);
    expect(result.confidence).toBeCloseTo(0.4, 5);
  });

  it("upgrades via experience_link even without high recall when 2 conditions pass", () => {
    const result = upgrader.evaluate(
      makeMemory({
        independent_session_count: 2,
        evidence: [{ source_excerpt: "You should avoid doing this", session_id: "s1" } as any],
      })
    );
    // cross_session(0.2) + experience_link(0.1) = 2 conditions, score 0.3 -> still upgrades due to count>=2
    expect(result.should_upgrade).toBe(true);
  });

  it("detects experience link from corrective keyword in evidence excerpt", () => {
    const withLink = upgrader.evaluate(
      makeMemory({ evidence: [{ source_excerpt: "We must fix the null check", session_id: "s1" } as any] })
    );
    const withoutLink = upgrader.evaluate(
      makeMemory({ evidence: [{ source_excerpt: "the function returned a value", session_id: "s1" } as any] })
    );
    expect(withLink.confidence).toBeGreaterThan(withoutLink.confidence);
  });
});

describe("FactUpgrader.upgrade", () => {
  it("rewrites kind/class and stamps upgrade metadata", () => {
    const upgrader = new FactUpgrader();
    const memory = makeMemory({ recall_count: 3, outcome: { user_confirmed: true } as any });
    const decision = upgrader.evaluate(memory);
    const upgraded = upgrader.upgrade(memory, decision);
    expect(upgraded.kind).toBe("procedural");
    expect(upgraded.info_class).toBe("experience");
    expect(upgraded.state).toBe("observed");
    expect((upgraded.metadata as any).upgraded_from).toBe("fact");
    expect((upgraded.metadata as any).upgrade_reason).toContain("high_recall");
  });
});
