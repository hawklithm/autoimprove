import { describe, it, expect } from "vitest";
import {
  checkMetaContent,
  isNoisePattern,
  filterNoisePatterns,
  isProjectSelfReference,
  generalityDiscount,
} from "../src/core/pattern-noise-filter.js";
import { Pattern } from "../src/core/models.js";

// Minimal Pattern factory — only the fields the filter reads.
function mkPattern(over: Partial<Pattern>): Pattern {
  return {
    pattern_type: "preference",
    content: over.content ?? "",
    description: over.description ?? "",
    keywords: over.keywords ?? [],
    evidence_excerpts: over.evidence_excerpts ?? [],
    occurrences: over.occurrences ?? [],
    project_paths: over.project_paths ?? [],
    confidence: over.confidence ?? 0.8,
  } as unknown as Pattern;
}

describe("P1-C1: meta / self-referential noise detection", () => {
  it("detects English meta boilerplate", () => {
    const r = checkMetaContent("Always strictly follow the rules when writing code");
    expect(r.noise).toBe(true);
    expect(r.reasons.some((x) => x.startsWith("meta-phrase"))).toBe(true);
  });

  it("detects Chinese meta boilerplate", () => {
    const r = checkMetaContent("在完成多步任务后，严格遵循规则");
    expect(r.noise).toBe(true);
  });

  it("detects self-reference phrases", () => {
    const r = checkMetaContent("This rule itself should not be taught to the learner");
    expect(r.noise).toBe(true);
    expect(r.reasons.some((x) => x.startsWith("self-ref"))).toBe(true);
  });

  it("returns noise=false for clean project content", () => {
    const r = checkMetaContent("Use absolute paths when invoking tools in Bash");
    expect(r.noise).toBe(false);
    expect(r.reasons.length).toBe(0);
  });

  it("isProjectSelfReference flags autoimprove-scoped patterns", () => {
    const p = mkPattern({ project_paths: ["D:/workspace/autoimprove/src/core/foo.ts"] });
    expect(isProjectSelfReference(p)).toBe(true);
    const q = mkPattern({ project_paths: ["D:/workspace/myapp/src/index.ts"] });
    expect(isProjectSelfReference(q)).toBe(false);
  });

  it("isNoisePattern combines meta text + project self-reference", () => {
    const p = mkPattern({
      description: "Strictly follow the rules",
      project_paths: ["src/mcp-server-ts/core/x.ts"],
    });
    const r = isNoisePattern(p);
    expect(r.noise).toBe(true);
    expect(r.reasons).toContain("project-self-reference");
  });

  it("filterNoisePatterns splits kept vs removed", () => {
    const patterns = [
      mkPattern({ description: "Use absolute paths over relative paths", content: "abs paths" }),
      mkPattern({ description: "Strictly follow the rules", content: "meta" }),
      mkPattern({ description: "You are an AI assistant that helps", content: "self" }),
    ];
    const { kept, removed } = filterNoisePatterns(patterns);
    expect(kept.length).toBe(1);
    expect(removed.length).toBe(2);
  });
});

describe("P1-C2: generality discount", () => {
  it("applies discount to global best-practice rules (no project signal)", () => {
    const p = mkPattern({
      description: "Keep code readable",
      keywords: ["readable"],
      project_paths: [],
    });
    expect(generalityDiscount(p)).toBeLessThan(1.0);
  });

  it("keeps full weight for rules with a concrete tech signal", () => {
    const p = mkPattern({
      description: "Configure the typescript compiler",
      keywords: ["typescript"],
      project_paths: [],
    });
    expect(generalityDiscount(p)).toBe(1.0);
  });

  it("keeps full weight for project-scoped rules", () => {
    const p = mkPattern({ project_paths: ["D:/workspace/app/src/x.ts"] });
    expect(generalityDiscount(p)).toBe(1.0);
  });
});

describe("P1-C3: rule-quality assessSpecificity penalizes meta content", () => {
  // Lazy import to avoid coupling the suite to implementation details.
  it("meta content scores lower than a concrete rule", async () => {
    const rq = await import("../src/core/rule-quality.js");
    const controller = new rq.RuleQualityController();
    const metaRule = { content: "Strictly follow the rules when completing multi-step tasks" } as any;
    const concreteRule = { content: "Use absolute paths over relative paths when invoking Bash" } as any;
    const metaScore = controller.assessSpecificity(metaRule);
    const concreteScore = controller.assessSpecificity(concreteRule);
    expect(metaScore).toBeLessThan(concreteScore);
  });
});
