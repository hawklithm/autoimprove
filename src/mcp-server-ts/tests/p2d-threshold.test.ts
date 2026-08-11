import { describe, it, expect } from "vitest";
import { isPatternQualifiedForRules, DEFAULT_REBUILD_MIN_CONFIDENCE } from "../src/core/batch-rebuild.js";
import { RuleClassifier } from "../src/core/classifier.js";
import { Pattern, PatternType } from "../src/core/models.js";

function mkPattern(over: Partial<Pattern>): Pattern {
  return {
    type: over.type ?? PatternType.PREFERENCE,
    pattern_type: over.pattern_type ?? "preference",
    content: over.content ?? "",
    description: over.description ?? "",
    keywords: over.keywords ?? [],
    evidence_excerpts: over.evidence_excerpts ?? [],
    occurrences: over.occurrences ?? [{ session_id: "s1", context: "x" }],
    confidence: over.confidence ?? 0.5,
    project_paths: over.project_paths ?? [],
  } as unknown as Pattern;
}

describe("P2-D: rule-generation gate no longer over-kills sparse sessions", () => {
  const classifier = new RuleClassifier();

  it("default rebuild min confidence is 0.3 (was 0.6)", () => {
    expect(DEFAULT_REBUILD_MIN_CONFIDENCE).toBe(0.3);
  });

  it("a single-session PREFERENCE at conf 0.4 passes even with a strict global 0.6 floor", () => {
    // Historically the global 0.6 cutoff killed this and produced 0 rules.
    const p = mkPattern({ type: PatternType.PREFERENCE, confidence: 0.4 });
    expect(isPatternQualifiedForRules(p, 0.6, classifier)).toBe(true);
  });

  it("a PREFERENCE at conf 0.4 also passes the 0.3 global floor", () => {
    const p = mkPattern({ type: PatternType.PREFERENCE, confidence: 0.4 });
    expect(isPatternQualifiedForRules(p, 0.3, classifier)).toBe(true);
  });

  it("a SECURITY pattern below its per-type min (0.5) is rejected even at global 0.6", () => {
    const p = mkPattern({ type: PatternType.SECURITY, confidence: 0.4 });
    expect(isPatternQualifiedForRules(p, 0.6, classifier)).toBe(false);
  });

  it("a very low confidence pattern (0.1) is rejected everywhere", () => {
    const p = mkPattern({ type: PatternType.PREFERENCE, confidence: 0.1 });
    expect(isPatternQualifiedForRules(p, 0.3, classifier)).toBe(false);
    expect(isPatternQualifiedForRules(p, 0.6, classifier)).toBe(false);
  });

  it("classifier still enforces per-type confidence minima independently", () => {
    // REPEATED_CORRECTION needs min_confidence 0.45; a low-conf single occurrence
    // is rejected by the classifier AND below the global floor -> false.
    const p = mkPattern({
      type: PatternType.REPEATED_CORRECTION,
      confidence: 0.4,
      occurrences: [{ session_id: "s1", context: "x" }],
    });
    expect(isPatternQualifiedForRules(p, 0.6, classifier)).toBe(false);
  });

  it("a high-confidence single-session pattern clears the global floor (D1 intent)", () => {
    // The gate must NOT over-kill confident single-session patterns; per-type
    // occurrence requirements (e.g. REPEATED_CORRECTION needs 2) are re-checked
    // downstream by the generator's classifier, not here.
    const p = mkPattern({
      type: PatternType.REPEATED_CORRECTION,
      confidence: 0.9,
      occurrences: [{ session_id: "s1", context: "x" }],
    });
    expect(isPatternQualifiedForRules(p, 0.3, classifier)).toBe(true);
  });
});
