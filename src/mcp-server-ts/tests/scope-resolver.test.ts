/**
 * ScopeResolver — 方向4 统一仲裁 scope 的加权投票 + 安全护栏
 */
import { describe, it, expect } from "vitest";
import { ScopeResolver } from "../src/core/scope-resolver.js";
import { RuleScope } from "../src/core/models.js";

describe("ScopeResolver weighted voting", () => {
  const resolver = new ScopeResolver();

  it("combines promotion(0.5) + llm(0.3) global into GLOBAL with full confidence", () => {
    const result = resolver.resolve({
      promotion: { scope: "global", confidence: 0.9, reason: "x", project_count: 5, organization_count: 0 },
      llm_suggestion: { scope: "global", confidence: 0.8, reason: "y" },
    });
    expect(result.scope).toBe(RuleScope.GLOBAL);
    // maxVote = 0.8, confidence = min(1, 0.8/0.8) = 1.0
    expect(result.confidence).toBeCloseTo(1.0, 5);
  });

  it("all three sources agreeing on PROJECT yields PROJECT", () => {
    const result = resolver.resolve({
      promotion: { scope: "project", confidence: 0.9, reason: "x", project_count: 1, organization_count: 0 },
      llm_suggestion: { scope: "project", confidence: 0.8, reason: "y" },
      heuristic: { scope: RuleScope.PROJECT, confidence: 0.9, reason: "z" },
    });
    expect(result.scope).toBe(RuleScope.PROJECT);
    expect(result.confidence).toBeCloseTo(1.0, 5);
  });

  it("defaults to PROJECT (safest) when all sources missing", () => {
    const result = resolver.resolve({});
    expect(result.scope).toBe(RuleScope.PROJECT);
    expect(result.confidence).toBe(0);
    expect(result.contributions).toEqual([]);
  });
});

describe("ScopeResolver safety guardrails", () => {
  const resolver = new ScopeResolver();

  it("demotes an LLM global suggestion when promotion is non-global", () => {
    const result = resolver.resolve({
      promotion: { scope: "organization", confidence: 0.9, reason: "x", project_count: 5, organization_count: 3 },
      llm_suggestion: { scope: "global", confidence: 0.9, reason: "y" },
      heuristic: { scope: RuleScope.ORGANIZATION, confidence: 0.9, reason: "z" },
    });
    // llm global weight dropped from 0.30 -> 0.10
    const llm = result.contributions.find((c) => c.source === "llm");
    expect(llm?.weight).toBeCloseTo(0.1, 5);
    // organization = 0.5 + 0.2 = 0.7 beats global = 0.10
    expect(result.scope).toBe(RuleScope.ORGANIZATION);
  });

  it("halves heuristic global weight when confidence is low (< 0.7)", () => {
    const result = resolver.resolve({
      promotion: { scope: "project", confidence: 0.9, reason: "x", project_count: 1, organization_count: 0 },
      llm_suggestion: { scope: "project", confidence: 0.8, reason: "y" },
      heuristic: { scope: RuleScope.GLOBAL, confidence: 0.3, reason: "z" },
    });
    const heuristic = result.contributions.find((c) => c.source === "heuristic");
    expect(heuristic?.weight).toBeCloseTo(0.1, 5);
    // project = 0.5 + 0.3 = 0.8 beats global = 0.10
    expect(result.scope).toBe(RuleScope.PROJECT);
  });

  it("breaks ties in favor of ORGANIZATION", () => {
    const result = resolver.resolve({
      promotion: { scope: "organization", confidence: 0.9, reason: "x", project_count: 5, organization_count: 3 },
      llm_suggestion: { scope: "project", confidence: 0.8, reason: "y" },
      heuristic: { scope: RuleScope.PROJECT, confidence: 0.9, reason: "z" },
    });
    // organization = 0.5, project = 0.3 + 0.2 = 0.5 -> tie -> organization wins
    expect(result.scope).toBe(RuleScope.ORGANIZATION);
  });
});

describe("ScopeResolver.buildFromMemory", () => {
  it("infers ORGANIZATION heuristic from 3+ project paths", () => {
    const input = ScopeResolver.buildFromMemory(
      { scope: "organization", confidence: 0.8 },
      { project_path: "/a/b" },
      { project_paths: ["/p1", "/p2", "/p3"] } as any
    );
    expect(input.promotion?.scope).toBe("organization");
    expect(input.heuristic?.scope).toBe(RuleScope.ORGANIZATION);
  });

  it("infers PROJECT from 1-2 paths, ORGANIZATION from 3+, GLOBAL from empty list", () => {
    const one = ScopeResolver.buildFromMemory(
      { scope: "project", confidence: 0.8 },
      {},
      { project_paths: ["/p1"] } as any
    );
    expect(one.heuristic?.scope).toBe(RuleScope.PROJECT);

    const three = ScopeResolver.buildFromMemory(
      { scope: "organization", confidence: 0.8 },
      {},
      { project_paths: ["/p1", "/p2", "/p3"] } as any
    );
    expect(three.heuristic?.scope).toBe(RuleScope.ORGANIZATION);

    const empty = ScopeResolver.buildFromMemory(
      { scope: "global", confidence: 0.8 },
      {},
      { project_paths: [] } as any
    );
    expect(empty.heuristic?.scope).toBe(RuleScope.GLOBAL);
  });

  it("does not set a heuristic when no pattern is provided", () => {
    const none = ScopeResolver.buildFromMemory({ scope: "global", confidence: 0.8 }, {}, undefined);
    expect(none.heuristic).toBeUndefined();
  });
});
