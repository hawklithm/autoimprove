/**
 * Regression tests for Chinese-language support in the rule quality / conflict
 * pipeline.
 *
 * Before the fix, calculateSimilarity / extractWords split text on whitespace,
 * so Chinese (which has no spaces) collapsed into a single token — similarity
 * was always 0 or 1, and the clarity/specificity/actionability word lists (all
 * English) never fired for Chinese rules. These tests lock in the jieba-based
 * behavior.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { RuleQualityController } from "../src/core/rule-quality.js";
import { createRuleContent, createRuleIndexEntry, PatternType } from "../src/core/models.js";

beforeEach(() => {
  process.env.AUTOIMPROVE_STORAGE_ROOT = join(tmpdir(), `autoimprove-zh-${Date.now()}-${Math.random()}`);
});

describe("Chinese rule similarity (jieba tokenization)", () => {
  let qc: RuleQualityController;

  beforeEach(() => {
    qc = new RuleQualityController();
  });

  it("detects overlap between two near-identical Chinese rules", () => {
    const ruleA = createRuleContent({
      id: "zh-001",
      content: "优先使用参数化查询来防止 SQL 注入漏洞",
      reason: "安全",
    });
    const ruleB = createRuleContent({
      id: "zh-002",
      content: "优先使用参数化查询来防止 SQL 注入攻击",
      reason: "安全",
    });
    const entryB = createRuleIndexEntry({ id: "zh-002", type: PatternType.SECURITY });

    const conflicts = qc.detectConflicts(ruleA, [{ index: entryB, content: ruleB }]);

    // The two rules share most tokens but differ in the last one, so similarity
    // should land in the (0.7, 0.95) overlap band — not 0 (the old behavior).
    const overlap = conflicts.find((c) => c.conflict_type === "overlap" || c.conflict_type === "redundancy");
    expect(overlap).toBeDefined();
  });

  it("does NOT report overlap for clearly different Chinese rules", () => {
    const ruleA = createRuleContent({
      id: "zh-101",
      content: "优先使用参数化查询来防止 SQL 注入漏洞",
      reason: "安全",
    });
    const ruleB = createRuleContent({
      id: "zh-102",
      content: "使用 memo 缓存昂贵的计算以提升 React 渲染性能",
      reason: "性能",
    });
    const entryB = createRuleIndexEntry({ id: "zh-102", type: PatternType.PERFORMANCE });

    const conflicts = qc.detectConflicts(ruleA, [{ index: entryB, content: ruleB }]);
    expect(conflicts.find((c) => c.conflict_type === "overlap" || c.conflict_type === "redundancy")).toBeUndefined();
  });
});

describe("Chinese contradiction detection", () => {
  let qc: RuleQualityController;

  beforeEach(() => {
    qc = new RuleQualityController();
  });

  it("flags opposite polarity for Chinese '总是使用' vs '绝不使用'", () => {
    const ruleA = createRuleContent({
      id: "zh-201",
      content: "总是使用参数化查询来防止 SQL 注入",
      reason: "安全",
    });
    const ruleB = createRuleContent({
      id: "zh-202",
      content: "绝不使用参数化查询来防止 SQL 注入",
      reason: "安全",
    });
    const entryB = createRuleIndexEntry({ id: "zh-202", type: PatternType.SECURITY });

    const conflicts = qc.detectConflicts(ruleA, [{ index: entryB, content: ruleB }]);
    const contradiction = conflicts.find((c) => c.conflict_type === "contradiction");
    expect(contradiction).toBeDefined();
  });
});

describe("Chinese quality scoring", () => {
  let qc: RuleQualityController;

  beforeEach(() => {
    qc = new RuleQualityController();
  });

  it("penalizes vague Chinese phrasing in clarity", () => {
    const vague = createRuleContent({
      id: "zh-301",
      content: "也许可以考虑使用参数化查询，这样可能避免一些问题",
      reason: "安全",
    });
    const clear = createRuleContent({
      id: "zh-302",
      content: "使用参数化查询来防止 SQL 注入攻击",
      reason: "安全",
    });
    expect(qc.assessClarity(vague)).toBeLessThan(qc.assessClarity(clear));
  });

  it("rewards Chinese action verbs in actionability", () => {
    const actionable = createRuleContent({
      id: "zh-311",
      content: "优先使用参数化查询，避免拼接 SQL 字符串",
      reason: "安全",
    });
    expect(qc.assessActionability(actionable)).toBeGreaterThan(0.5);
  });

  it("rewards Chinese technical terms in specificity", () => {
    const specific = createRuleContent({
      id: "zh-321",
      content: "在 React 组件中使用 useState 函数管理状态",
      reason: "前端",
    });
    expect(qc.assessSpecificity(specific)).toBeGreaterThan(0.5);
  });
});
