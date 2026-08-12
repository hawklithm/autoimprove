import { describe, expect, it } from "vitest";
import { PatternContentFilter } from "../src/core/pattern-content-filter.js";
import { PatternSemanticClassifier } from "../src/core/pattern-semantic-classifier.js";

describe("PatternContentFilter.isCodeRelated", () => {
  const filter = new PatternContentFilter();

  it("allows clear code content (React/TypeScript)", () => {
    const r = filter.isCodeRelated("Use useEffect for side effects in React components with TypeScript");
    expect(r.allowed).toBe(true);
    expect(r.category).toBe("code");
    expect(r.codeScore).toBeGreaterThan(0);
  });

  it("rejects pure business content (recruiting)", () => {
    const r = filter.isCodeRelated("我们需要招聘一名前端工程师，请筛选候选人的简历并安排面试");
    expect(r.allowed).toBe(false);
    expect(r.category).toBe("business");
    expect(r.codeScore).toBe(0);
    expect(r.businessScore).toBeGreaterThan(0);
  });

  it("rejects pure business content (marketing, English)", () => {
    const r = filter.isCodeRelated("Our marketing campaign needs better conversion rate and more leads from SEO");
    expect(r.allowed).toBe(false);
    expect(r.category).toBe("business");
  });

  it("rejects business-dominant mixed content", () => {
    // 2 code-ish words vs 4 business words → ratio > 0.6
    const text =
      "招聘候选人时，用 sql 查询简历库，做营销活动策划，提升转化率，优化销售线索的订单转化";
    const r = filter.isCodeRelated(text);
    expect(r.allowed).toBe(false);
    expect(r.category).toBe("business");
  });

  it("allows mixed content where code clearly dominates", () => {
    const text =
      "在 React 组件里用 TypeScript 编写 async/await 的 api 调用，同时和产品经理确认需求文档的优先级，并安排面试候选人";
    const r = filter.isCodeRelated(text);
    expect(r.allowed).toBe(true);
    expect(r.category).toBe("mixed");
  });

  it("treats content with no signal as general (allowed)", () => {
    const r = filter.isCodeRelated("今天天气不错，我们散个步吧");
    expect(r.allowed).toBe(true);
    expect(r.category).toBe("general");
  });

  it("treats empty content as general (allowed)", () => {
    const r = filter.isCodeRelated("");
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/empty/);
  });

  it("does not match short token 'go' inside unrelated words", () => {
    const filter2 = new PatternContentFilter({ codeKeywords: ["go"] });
    const r = filter2.isCodeRelated("google the answer please");
    // 'go' should NOT count as a code hit here (whole-word match)
    expect(r.codeScore).toBe(0);
  });

  it("matches short token 'go' as a standalone programming language", () => {
    const filter2 = new PatternContentFilter({ codeKeywords: ["go"] });
    const r = filter2.isCodeRelated("Refactor the service in go and add unit tests");
    expect(r.codeScore).toBeGreaterThan(0);
    expect(r.allowed).toBe(true);
  });

  it("respects a custom business-ratio threshold", () => {
    const filter3 = new PatternContentFilter({ businessRatioThreshold: 0.9 });
    const text = "招聘候选人，做营销，写 sql 查询，用 react 和 typescript 重构 api";
    const r = filter3.isCodeRelated(text);
    // With a 0.9 threshold, the mixed content is no longer rejected.
    expect(r.allowed).toBe(true);
  });

  it("returns detailed scores for logging/debugging", () => {
    const r = filter.isCodeRelated("招聘 candidates and run a marketing campaign");
    expect(typeof r.codeScore).toBe("number");
    expect(typeof r.businessScore).toBe("number");
    expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe("PatternSemanticClassifier", () => {
  it("uses the heuristic verdict when confident (no LLM)", async () => {
    const classifier = new PatternSemanticClassifier();
    const r = await classifier.classify("招聘候选人并安排面试");
    expect(r.category).toBe("business");
    expect(r.usedLLM).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("falls back to heuristic when LLM is not configured", async () => {
    const classifier = new PatternSemanticClassifier();
    const r = await classifier.classify("Use React and TypeScript for the frontend");
    expect(r.category).toBe("code");
    expect(r.usedLLM).toBe(false);
  });

  it("consults the LLM only when the heuristic is uncertain", async () => {
    const calls: string[] = [];
    const classifier = new PatternSemanticClassifier({
      // Force the heuristic to be uncertain by treating everything as 'general'.
      filter: new PatternContentFilter({ codeKeywords: [], businessKeywords: [] }),
      classifyFn: async (text: string) => {
        calls.push(text);
        return { category: "code", confidence: 0.8, reason: "model says code" };
      },
    });
    const r = await classifier.classify("some ambiguous text");
    expect(calls).toHaveLength(1);
    expect(r.usedLLM).toBe(true);
    expect(r.category).toBe("code");
    expect(r.reason).toMatch(/^llm:/);
  });

  it("degrades to heuristic when the LLM throws", async () => {
    const classifier = new PatternSemanticClassifier({
      filter: new PatternContentFilter({ codeKeywords: [], businessKeywords: [] }),
      classifyFn: async () => {
        throw new Error("network down");
      },
    });
    const r = await classifier.classify("招聘候选人并安排面试");
    // heuristic with empty dicts → general, not LLM
    expect(r.usedLLM).toBe(false);
    expect(r.category).toBe("general");
  });
});
