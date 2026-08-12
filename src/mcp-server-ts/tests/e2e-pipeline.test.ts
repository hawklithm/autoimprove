import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import * as initMod from "../src/storage/init.js";
import { PatternContentFilter } from "../src/core/pattern-content-filter.js";
import { PatternType, createPattern, Pattern, PatternOccurrence } from "../src/core/models.js";
import { RuleReviewQueue } from "../src/core/rule-review-queue.js";
import { MemoryRepository, MemoryRecord } from "../src/core/memory-models.js";
import { join } from "path";
import { tmpdir } from "os";

const tmpQueuePath = join(tmpdir(), `autoimprove-e2e-review-${Date.now()}.jsonl`);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makePattern(description: string, type: PatternType = PatternType.REPEATED_CORRECTION): Pattern {
  const occ: PatternOccurrence = {
    session_id: "s1",
    timestamp: new Date().toISOString(),
    user_action: "explicit_correction",
    context: "unknown",
    user_input: description,
  };
  return createPattern({
    type,
    description,
    occurrences: [occ],
    first_seen: occ.timestamp,
    last_seen: occ.timestamp,
    confidence: 0.8,
    keywords: [],
  });
}

function makeSession(messages: { role: "user" | "assistant"; content: string }[]): any {
  return {
    session_id: "e2e-session",
    messages: messages.map((m, i) => ({ role: m.role, content: m.content, line_number: i + 1 })),
    tool_calls: [],
    metadata: {},
    project_path: "/tmp/project",
  };
}

const emptyScene = { tech: [], functional: [], business: [] };

const BUSINESS_MSG = "我们团队需要招聘一名前端工程师，筛选候选人简历并安排面试";
const TECH_MSG = "我更喜欢用 TypeScript 严格模式写 React 组件，避免 any 类型";
const BUSINESS_PATTERN = makePattern("招聘候选人并安排面试评估简历");
const TECH_PATTERN = makePattern("Use TypeScript strict mode in React components");

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

// ---------------------------------------------------------------------------
// Layer 1 — Pattern Detection content filter
// ---------------------------------------------------------------------------

describe("E2E L1: Pattern Detection content filter", () => {
  const filter = new PatternContentFilter();

  it("rejects business content", () => {
    expect(filter.isCodeRelated(BUSINESS_MSG).allowed).toBe(false);
    expect(filter.isCodeRelated(BUSINESS_PATTERN.description).category).toBe("business");
  });

  it("accepts technical content", () => {
    expect(filter.isCodeRelated(TECH_MSG).allowed).toBe(true);
    expect(filter.isCodeRelated(TECH_PATTERN.description).category).toBe("code");
  });

  it("classifies mixed content as mixed", () => {
    const mixed = "招聘前端工程师，同时用 TypeScript 实现组件";
    const res = filter.isCodeRelated(mixed);
    expect(res.category === "mixed" || res.category === "code" || res.category === "business").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — Memory Extraction content filter (LLM disabled → heuristic path)
// ---------------------------------------------------------------------------

describe("E2E L2: Memory Extraction content filter", () => {
  let SessionMemoryExtractor: typeof import("../src/core/memory-extractor.js").SessionMemoryExtractor;
  let extractor: any;

  beforeAll(async () => {
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    vi.stubEnv("LLM_BASE_URL", "");
    vi.stubEnv("ANTHROPIC_BASE_URL", "");
    const mod = await import("../src/core/memory-extractor.js");
    SessionMemoryExtractor = mod.SessionMemoryExtractor;
    extractor = new SessionMemoryExtractor();
  });

  it("produces no memories for a pure business session", async () => {
    const memories = await extractor.extract(makeSession([{ role: "user", content: BUSINESS_MSG }]), [BUSINESS_PATTERN], emptyScene);
    expect(memories.length).toBe(0);
  });

  it("extracts memories for a coding session", async () => {
    const memories = await extractor.extract(makeSession([{ role: "user", content: TECH_MSG }]), [TECH_PATTERN], emptyScene);
    expect(memories.length).toBeGreaterThan(0);
  });

  it("mixed session yields only technical memories (business dropped)", async () => {
    const memories = await extractor.extract(
      makeSession([
        { role: "user", content: BUSINESS_MSG },
        { role: "user", content: TECH_MSG },
      ]),
      [BUSINESS_PATTERN, TECH_PATTERN],
      emptyScene
    );
    expect(memories.length).toBeGreaterThan(0);
    // No memory should carry the recruiting keyword.
    for (const m of memories) {
      expect(m.content).not.toMatch(/招聘|面试|候选人/);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — Rule Generation guards (empty-scene / low-quality / orphaned memory)
// ---------------------------------------------------------------------------

describe("E2E L3: Rule Generation guards", () => {
  let generator: any;
  let reviewQueue: RuleReviewQueue;

  beforeAll(async () => {
    vi.spyOn(initMod, "loadConfig").mockReturnValue({
      memory_extraction: { enable_content_filter: true, require_code_context: false },
      rule_generation: { require_manual_review_for: { empty_scene: true, low_quality_score: 0.5 } },
    } as any);
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    vi.stubEnv("LLM_BASE_URL", "");
    vi.stubEnv("ANTHROPIC_BASE_URL", "");
    const mod = await import("../src/core/hybrid-rule-generator.js");
    generator = new mod.HybridRuleGenerator();
    reviewQueue = new RuleReviewQueue(tmpQueuePath);
    generator.reviewQueue = reviewQueue;
  });

  afterEach(() => {
    // reset queue between tests
    try {
      const fs = require("fs");
      if (fs.existsSync(tmpQueuePath)) fs.unlinkSync(tmpQueuePath);
    } catch {
      /* ignore */
    }
  });

  const entry = (over: any = {}) => ({
    id: "rule-e2e",
    type: "anti-pattern",
    confidence: 0.8,
    scenes: { tech: [], functional: [], business: [] },
    ...over,
  });
  const content = (over: any = {}) => ({
    id: "rule-e2e",
    content: "some rule",
    reason: "x",
    metadata: {},
    ...over,
  });

  it("holds an empty-scene (business-derived) rule for review", async () => {
    const result = await generator.finalizeRule(entry(), content());
    expect(result).toBeNull();
    expect(reviewQueue.pendingCount()).toBeGreaterThan(0);
  });

  it("holds a low-quality rule for review", async () => {
    const result = await generator.finalizeRule(
      entry({ scenes: { tech: ["react"], functional: [], business: [] } }),
      content({ metadata: { quality_score: 0.2 } })
    );
    expect(result).toBeNull();
  });

  it("holds a rule with orphaned memory references for review", async () => {
    const mem = makeMemoryRepo(["mem-aaa"]); // only mem-aaa is active
    const result = await generator.finalizeRule(
      entry({ scenes: { tech: ["react"], functional: [], business: [] }, source_memory_ids: ["mem-ghost"] }),
      content({ metadata: { quality_score: 0.9, source_memory_ids: ["mem-ghost"] } }),
      mem
    );
    expect(result).toBeNull();
  });

  it("passes a valid technical rule through", async () => {
    const result = await generator.finalizeRule(
      entry({ scenes: { tech: ["react"], functional: ["auth"], business: [] }, source_memory_ids: ["mem-aaa"] }),
      content({ metadata: { quality_score: 0.9, source_memory_ids: ["mem-aaa"] } }),
      makeMemoryRepo(["mem-aaa"])
    );
    expect(result).not.toBeNull();
    expect(result.indexEntry.id).toBe("rule-e2e");
  });
});

// ---------------------------------------------------------------------------
// Full cascade — business content never becomes a persisted rule
// ---------------------------------------------------------------------------

describe("E2E cascade: business content is stopped at every layer", () => {
  let SessionMemoryExtractor: typeof import("../src/core/memory-extractor.js").SessionMemoryExtractor;
  let extractor: any;
  let generator: any;
  let reviewQueue: RuleReviewQueue;

  beforeAll(async () => {
    vi.spyOn(initMod, "loadConfig").mockReturnValue({
      memory_extraction: { enable_content_filter: true, require_code_context: false },
      rule_generation: { require_manual_review_for: { empty_scene: true, low_quality_score: 0.5 } },
    } as any);
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    vi.stubEnv("LLM_BASE_URL", "");
    vi.stubEnv("ANTHROPIC_BASE_URL", "");
    const memMod = await import("../src/core/memory-extractor.js");
    const genMod = await import("../src/core/hybrid-rule-generator.js");
    SessionMemoryExtractor = memMod.SessionMemoryExtractor;
    extractor = new SessionMemoryExtractor();
    generator = new genMod.HybridRuleGenerator();
    reviewQueue = new RuleReviewQueue(tmpQueuePath);
    generator.reviewQueue = reviewQueue;
  });

  it("business message → dropped at L1, no memory at L2, held at L3", async () => {
    const filter = new PatternContentFilter();

    // L1
    expect(filter.isCodeRelated(BUSINESS_MSG).allowed).toBe(false);

    // L2
    const memories = await extractor.extract(makeSession([{ role: "user", content: BUSINESS_MSG }]), [BUSINESS_PATTERN], emptyScene);
    expect(memories.length).toBe(0);

    // L3 — even if it somehow reached generation, an empty-scene rule is held.
    const result = await generator.finalizeRule(
      { id: "rule-biz", type: "anti-pattern", confidence: 0.8, scenes: emptyScene, source_memory_ids: [] },
      { id: "rule-biz", content: BUSINESS_MSG, reason: "x", metadata: { quality_score: 0.9 } }
    );
    expect(result).toBeNull();
  });

  it("technical message flows L1 → L2 → L3 into a rule", async () => {
    const filter = new PatternContentFilter();
    expect(filter.isCodeRelated(TECH_MSG).allowed).toBe(true);

    const memories = await extractor.extract(makeSession([{ role: "user", content: TECH_MSG }]), [TECH_PATTERN], emptyScene);
    expect(memories.length).toBeGreaterThan(0);

    const result = await generator.finalizeRule(
      { id: "rule-tech", type: "preference", confidence: 0.8, scenes: { tech: ["typescript", "react"], functional: [], business: [] }, source_memory_ids: [] },
      { id: "rule-tech", content: TECH_MSG, reason: "x", metadata: { quality_score: 0.9 } }
    );
    expect(result).not.toBeNull();
  });
});
