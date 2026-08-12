import { describe, expect, it, beforeAll, vi } from "vitest";
import { RuleReviewQueue } from "../src/core/rule-review-queue.js";
import { RuleQualityController } from "../src/core/rule-quality.js";
import * as initMod from "../src/storage/init.js";
import { join } from "path";
import { tmpdir } from "os";

const tmpQueuePath = join(tmpdir(), `autoimprove-test-review-${Date.now()}.jsonl`);

describe("RuleReviewQueue", () => {
  const queue = new RuleReviewQueue(tmpQueuePath);
  const entry: any = { id: "rule-001", type: "anti-pattern", scenes: { tech: [], functional: [], business: [] } };
  const content: any = { id: "rule-001", content: "do not hire", reason: "x" };

  it("adds a pending item and lists it", () => {
    const item = queue.add({ rule_id: "rule-001", reason: "empty_scene", index_entry: entry, rule_content: content });
    expect(item.status).toBe("pending");
    expect(queue.list().length).toBe(1);
    expect(queue.pendingCount()).toBe(1);
  });

  it("approves a pending item", () => {
    const approved = queue.approve("rule-001", "looks good");
    expect(approved?.status).toBe("approved");
    expect(queue.pendingCount()).toBe(0);
  });

  it("rejects unknown ids gracefully", () => {
    expect(queue.approve("nope")).toBeNull();
    expect(queue.reject("nope")).toBeNull();
  });

  it("rejects a pending item via reject()", () => {
    queue.add({ rule_id: "rule-002", reason: "low_quality_score", index_entry: entry, rule_content: content });
    const rejected = queue.reject("rule-002", "too vague");
    expect(rejected?.status).toBe("rejected");
  });
});

describe("RuleQualityController Phase 3 dimensions", () => {
  const qc = new RuleQualityController();

  it("assesses technical relevance (business content scores low)", () => {
    const business: any = { id: "r", content: "招聘候选人并安排面试评估简历" };
    const tech: any = { id: "r", content: "Use useEffect with TypeScript async/await in React components" };
    expect(qc.assessTechnicalRelevance(business)).toBeLessThan(0.3);
    expect(qc.assessTechnicalRelevance(tech)).toBeGreaterThan(0.5);
  });

  it("assesses scene completeness (empty -> 0)", () => {
    expect(qc.assessSceneCompleteness({ scenes: { tech: [], functional: [], business: [] } } as any)).toBe(0);
    expect(qc.assessSceneCompleteness({ scenes: { tech: ["react"], functional: [], business: [] } } as any)).toBeCloseTo(1 / 3);
    expect(qc.assessSceneCompleteness({ scenes: { tech: ["react"], functional: ["auth"], business: ["ecommerce"] } } as any)).toBe(1);
  });

  it("includes the new dimensions in the unified score", () => {
    const rule: any = { id: "r", content: "Use TypeScript strict mode in React components to avoid type errors" };
    const indexEntry: any = { id: "r", confidence: 0.8, scenes: { tech: ["typescript", "react"], functional: ["state-management"], business: [] }, keywords: ["typescript", "react"] };
    const score = qc.assessUnifiedScore(rule, indexEntry, 0.8, 0.7);
    expect(typeof score.technical_relevance).toBe("number");
    expect(typeof score.scene_completeness).toBe("number");
    expect(score.overall).toBeGreaterThan(0);
    expect(score.overall).toBeLessThanOrEqual(1);
  });
});

describe("HybridRuleGenerator finalizeRule gate", () => {
  let generator: any;
  beforeAll(async () => {
    // Deterministic config: gate both empty-scene and low-quality rules.
    vi.spyOn(initMod, "loadConfig").mockReturnValue({
      rule_generation: {
        require_manual_review_for: { empty_scene: true, low_quality_score: 0.5 },
      },
    } as any);

    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    vi.stubEnv("LLM_BASE_URL", "");
    vi.stubEnv("ANTHROPIC_BASE_URL", "");
    const mod = await import("../src/core/hybrid-rule-generator.js");
    generator = new mod.HybridRuleGenerator();
    // Use an isolated review queue so we don't touch the real storage root.
    generator.reviewQueue = new RuleReviewQueue(tmpQueuePath);
  });

  const baseEntry = (over: any = {}): any => ({
    id: "rule-x",
    type: "anti-pattern",
    confidence: 0.8,
    scenes: { tech: [], functional: [], business: [] },
    ...over,
  });
  const baseContent = (over: any = {}): any => ({
    id: "rule-x",
    content: "some rule content",
    reason: "x",
    metadata: {},
    ...over,
  });

  it("holds an empty-scene rule for review (returns null)", async () => {
    const result = await generator.finalizeRule(baseEntry(), baseContent());
    expect(result).toBeNull();
    const pending = generator.reviewQueue.list("pending").filter((i: any) => i.reason === "empty_scene");
    expect(pending.length).toBeGreaterThan(0);
  });

  it("holds a low-quality rule for review (returns null)", async () => {
    const result = await generator.finalizeRule(
      baseEntry({ scenes: { tech: ["react"], functional: [], business: [] } }),
      baseContent({ metadata: { quality_score: 0.2 } })
    );
    expect(result).toBeNull();
  });

  it("passes a valid rule through (returns the rule)", async () => {
    const result = await generator.finalizeRule(
      baseEntry({ scenes: { tech: ["react"], functional: ["auth"], business: [] } }),
      baseContent({ metadata: { quality_score: 0.9 } })
    );
    expect(result).not.toBeNull();
    expect(result.indexEntry.id).toBe("rule-x");
  });
});
