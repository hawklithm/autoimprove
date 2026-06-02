import { describe, it, expect } from "vitest";

import { ConfidenceCalculator } from "../src/core/confidence.js";
import { RuleClassifier } from "../src/core/classifier.js";
import { KeywordDetector } from "../src/core/keywords.js";
import { RuleGenerator } from "../src/core/rule-generator.js";
import {
  Pattern,
  PatternType,
  PatternOccurrence,
  Priority,
  createPattern,
  createScene,
  isFrameworkRule,
} from "../src/core/models.js";

describe("ConfidenceCalculator", () => {
  it("should calculate frequency score", () => {
    const calc = new ConfidenceCalculator();

    const pattern = createPattern({
      type: PatternType.PREFERENCE,
      description: "Test",
      occurrences: [
        {
          session_id: "s1",
          timestamp: "2026-05-30T10:00:00Z",
          user_action: "explicit_correction",
          context: "test.py",
        },
      ],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    const confidence = calc.calculateConfidence(pattern);
    expect(confidence).toBeGreaterThanOrEqual(0.0);
    expect(confidence).toBeLessThanOrEqual(1.0);
  });

  it("should apply same-session bonus for 3+ occurrences", () => {
    const calc = new ConfidenceCalculator();

    const pattern = createPattern({
      type: PatternType.REPEATED_CORRECTION,
      description: "Test",
      occurrences: [
        {
          session_id: "s1",
          timestamp: "2026-05-30T10:00:00Z",
          user_action: "explicit_correction",
          context: "test1.py",
        },
        {
          session_id: "s1",
          timestamp: "2026-05-30T10:30:00Z",
          user_action: "explicit_correction",
          context: "test2.py",
        },
        {
          session_id: "s1",
          timestamp: "2026-05-30T11:00:00Z",
          user_action: "explicit_correction",
          context: "test3.py",
        },
      ],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T11:00:00Z",
    });

    const confidence = calc.calculateConfidence(pattern);
    expect(confidence).toBeGreaterThan(0.3);
  });

  it("should calculate behavior score for preferences", () => {
    const calc = new ConfidenceCalculator();

    const pattern = createPattern({
      type: PatternType.PREFERENCE,
      description: "Test",
      occurrences: [
        {
          session_id: "s1",
          timestamp: "2026-05-30T10:00:00Z",
          user_action: "accept",
          context: "test.py",
        },
      ],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    const confidence = calc.calculateConfidence(pattern);
    expect(confidence).toBeGreaterThan(0);
  });

  it("should calculate validation score", () => {
    const calc = new ConfidenceCalculator();

    const pattern = createPattern({
      type: PatternType.ANTI_PATTERN,
      description: "Test",
      occurrences: [
        {
          session_id: "s1",
          timestamp: "2026-05-30T10:00:00Z",
          user_action: "explicit_correction",
          context: "test.py",
          test_passed: true,
        },
      ],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    const confidence = calc.calculateConfidence(pattern);
    expect(confidence).toBeGreaterThan(0);
  });

  it("should calculate full confidence for repeated correction", () => {
    const calc = new ConfidenceCalculator();

    const pattern = createPattern({
      type: PatternType.REPEATED_CORRECTION,
      description: "Use refreshToken() helper",
      occurrences: [
        {
          session_id: "s1",
          timestamp: "2026-05-01T10:00:00Z",
          user_action: "explicit_correction",
          context: "auth.py",
          test_passed: true,
        },
        {
          session_id: "s2",
          timestamp: "2026-05-15T10:00:00Z",
          user_action: "explicit_correction",
          context: "login.py",
          test_passed: true,
        },
      ],
      first_seen: "2026-05-01T10:00:00Z",
      last_seen: "2026-05-15T10:00:00Z",
    });

    const confidence = calc.calculateConfidence(pattern);
    expect(confidence).toBeGreaterThanOrEqual(0.0);
    expect(confidence).toBeLessThanOrEqual(1.0);
    expect(confidence).toBeGreaterThan(0.5);
  });
});

describe("RuleClassifier", () => {
  it("should generate rule for valid repeated correction", () => {
    const classifier = new RuleClassifier();

    const pattern = createPattern({
      type: PatternType.REPEATED_CORRECTION,
      description: "Test",
      occurrences: [
        {
          session_id: "s1",
          timestamp: "2026-05-01T10:00:00Z",
          user_action: "explicit_correction",
          context: "test1.py",
        },
        {
          session_id: "s2",
          timestamp: "2026-05-15T10:00:00Z",
          user_action: "explicit_correction",
          context: "test2.py",
        },
      ],
      first_seen: "2026-05-01T10:00:00Z",
      last_seen: "2026-05-15T10:00:00Z",
    });

    pattern.confidence = 0.6;

    const { shouldGenerate, reason } = classifier.shouldGenerateRule(pattern);
    expect(shouldGenerate).toBe(true);
    expect(reason).toContain("满足");
  });

  it("should reject low confidence patterns", () => {
    const classifier = new RuleClassifier();

    const pattern = createPattern({
      type: PatternType.REPEATED_CORRECTION,
      description: "Test",
      occurrences: [
        {
          session_id: "s1",
          timestamp: "2026-05-30T10:00:00Z",
          user_action: "explicit_correction",
          context: "test.py",
        },
      ],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    pattern.confidence = 0.2;

    const { shouldGenerate, reason } = classifier.shouldGenerateRule(pattern);
    expect(shouldGenerate).toBe(false);
    expect(reason).toContain("置信度不足");
  });

  it("should determine critical priority for security", () => {
    const classifier = new RuleClassifier();

    const pattern = createPattern({
      type: PatternType.SECURITY,
      description: "Prevent SQL injection",
      occurrences: [],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    pattern.confidence = 0.5;

    const priority = classifier.determinePriority(pattern);
    expect(priority).toBe(Priority.CRITICAL);
  });

  it("should boost priority for high confidence", () => {
    const classifier = new RuleClassifier();

    const pattern = createPattern({
      type: PatternType.PREFERENCE,
      description: "Use const",
      occurrences: [],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    pattern.confidence = 0.95;

    const priority = classifier.determinePriority(pattern);
    expect(priority).toBe(Priority.MEDIUM);
  });
});

describe("KeywordDetector", () => {
  it("should detect preference keywords", () => {
    const detector = new KeywordDetector();

    const pattern = createPattern({
      type: PatternType.PREFERENCE,
      description: "我们团队使用 const",
      occurrences: [],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    const keywords = detector.detectKeywords(pattern);
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords.some((kw) => kw.includes("团队"))).toBe(true);
  });

  it("should detect performance keywords", () => {
    const detector = new KeywordDetector();

    const pattern = createPattern({
      type: PatternType.PERFORMANCE,
      description: "Use useMemo to optimize",
      occurrences: [],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    const keywords = detector.detectKeywords(pattern);
    expect(keywords).toContain("useMemo");
  });

  it("should detect keywords in user input", () => {
    const detector = new KeywordDetector();

    const pattern = createPattern({
      type: PatternType.SECURITY,
      description: "Validate input",
      occurrences: [
        {
          session_id: "s1",
          timestamp: "2026-05-30T10:00:00Z",
          user_action: "explicit_correction",
          context: "test.py",
          user_input: "防止 SQL injection",
        },
      ],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    const keywords = detector.detectKeywords(pattern);
    expect(keywords.some((kw) => kw.toLowerCase().includes("injection"))).toBe(true);
  });
});

describe("Framework Rule Detection", () => {
  it("should detect React framework rule", () => {
    const pattern = createPattern({
      type: PatternType.ANTI_PATTERN,
      description: "Don't call hooks in loops",
      occurrences: [],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    expect(isFrameworkRule(pattern)).toBe(true);
  });

  it("should detect Vue framework rule", () => {
    const pattern = createPattern({
      type: PatternType.ANTI_PATTERN,
      description: "Use reactive() for objects",
      occurrences: [],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    expect(isFrameworkRule(pattern)).toBe(true);
  });
});

describe("RuleGenerator", () => {
  it("should generate rule from pattern", () => {
    const generator = new RuleGenerator();

    const pattern = createPattern({
      type: PatternType.PREFERENCE,
      description: "Use const instead of let",
      occurrences: [
        {
          session_id: "s1",
          timestamp: "2026-05-30T10:00:00Z",
          user_action: "accept",
          context: "src/utils.ts",
        },
      ],
      first_seen: "2026-05-30T10:00:00Z",
      last_seen: "2026-05-30T10:00:00Z",
    });

    pattern.confidence = 0.5;
    pattern.keywords = ["convention"];

    const scene = createScene({ tech: ["typescript"], functional: ["utils"] });

    const { indexEntry, content } = generator.generateRule(pattern, "rule-001", scene);

    expect(indexEntry.id).toBe("rule-001");
    expect(indexEntry.type).toBe(PatternType.PREFERENCE);
    expect(indexEntry.confidence).toBe(0.5);
    expect(content.id).toBe("rule-001");
    expect(content.content).toContain("const");
  });

  it("should batch generate rules", () => {
    const generator = new RuleGenerator();

    const patterns = [
      createPattern({
        type: PatternType.PREFERENCE,
        description: "Use const",
        occurrences: [
          {
            session_id: "s1",
            timestamp: "2026-05-30T10:00:00Z",
            user_action: "accept",
            context: "test.ts",
          },
        ],
        first_seen: "2026-05-30T10:00:00Z",
        last_seen: "2026-05-30T10:00:00Z",
      }),
      createPattern({
        type: PatternType.SECURITY,
        description: "Validate input",
        occurrences: [
          {
            session_id: "s1",
            timestamp: "2026-05-30T10:00:00Z",
            user_action: "explicit_correction",
            context: "api.ts",
            security_issue: "input-validation",
          },
        ],
        first_seen: "2026-05-30T10:00:00Z",
        last_seen: "2026-05-30T10:00:00Z",
      }),
    ];

    patterns[0].confidence = 0.5;
    patterns[1].confidence = 0.8;

    const rules = generator.batchGenerateRules(patterns, 1);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0].indexEntry.id).toBe("rule-001");
  });
});
