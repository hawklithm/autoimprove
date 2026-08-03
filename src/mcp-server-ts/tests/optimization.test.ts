/**
 * Tests for optimization features
 */

import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { RuleQualityController } from "../src/core/rule-quality.js";
import { RuleVersionControl } from "../src/storage/rule-version.js";
import { AdaptiveConfidenceCalculator } from "../src/core/adaptive-confidence.js";
import { EnhancedSceneDetector } from "../src/core/enhanced-scene-detector.js";
import { IndexedRuleMatcher } from "../src/core/indexed-rule-matcher.js";
import { RuleIndexManager } from "../src/storage/rule-index.js";
import { createRuleContent, createRuleIndexEntry, createPattern, PatternType } from "../src/core/models.js";

// These components intentionally persist state. Give every test a fresh
// storage root so historical data cannot affect version numbers or feedback
// counters, and so the tests do not touch the user's profile.
beforeEach(() => {
  process.env.AUTOIMPROVE_STORAGE_ROOT = join(tmpdir(), `autoimprove-optimization-${Date.now()}-${Math.random()}`);
});

describe("Rule Quality Controller", () => {
  let qualityController: RuleQualityController;

  beforeEach(() => {
    qualityController = new RuleQualityController();
  });

  it("should assess rule clarity", () => {
    const rule = createRuleContent({
      id: "rule-001",
      content: "Always use TypeScript strict mode for better type safety",
      reason: "Prevents common type errors",
    });

    const clarity = qualityController.assessClarity(rule);
    expect(clarity).toBeGreaterThan(0.5);
  });

  it("should penalize vague language", () => {
    const vagueRule = createRuleContent({
      id: "rule-002",
      content: "Maybe use something that might work",
      reason: "Could be useful",
    });

    const clarity = qualityController.assessClarity(vagueRule);
    expect(clarity).toBeLessThan(0.6);
  });

  it("should detect contradictions", () => {
    const rule1 = createRuleContent({
      id: "rule-001",
      content: "Always use const for variables",
      reason: "Immutability",
    });

    const rule2 = createRuleContent({
      id: "rule-002",
      content: "Never use const, prefer let",
      reason: "Flexibility",
    });

    const indexEntry1 = createRuleIndexEntry({ id: "rule-001", type: PatternType.PREFERENCE });
    const indexEntry2 = createRuleIndexEntry({ id: "rule-002", type: PatternType.PREFERENCE });

    const conflicts = qualityController.detectConflicts(rule1, [
      { index: indexEntry2, content: rule2 },
    ]);

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].conflict_type).toBe("contradiction");
  });

  it("should suggest merging similar rules", () => {
    const rule1 = createRuleContent({
      id: "rule-001",
      content: "Use functional components in React",
      reason: "Modern best practice",
    });

    const rule2 = createRuleContent({
      id: "rule-002",
      content: "Prefer functional components over class components",
      reason: "Better performance",
    });

    const indexEntry1 = createRuleIndexEntry({ id: "rule-001", type: PatternType.PREFERENCE });
    const indexEntry2 = createRuleIndexEntry({ id: "rule-002", type: PatternType.PREFERENCE });

    const proposal = qualityController.suggestMerge([
      { index: indexEntry1, content: rule1 },
      { index: indexEntry2, content: rule2 },
    ]);

    expect(proposal).not.toBeNull();
    expect(proposal!.rule_ids).toHaveLength(2);
  });
});

describe("Rule Version Control", () => {
  let versionControl: RuleVersionControl;

  beforeEach(() => {
    versionControl = new RuleVersionControl();
  });

  it("should save a new version", () => {
    const rule = createRuleContent({
      id: "test-rule-001",
      content: "Test rule content",
      reason: "Testing",
    });

    const version = versionControl.saveVersion(rule, "auto", "Initial version");
    expect(version.version).toBe(1);
    expect(version.created_by).toBe("auto");
  });

  it("should track version history", () => {
    const rule = createRuleContent({
      id: "test-rule-002",
      content: "Original content",
      reason: "Testing",
    });

    // Save first version
    versionControl.saveVersion(rule, "auto");

    // Update and save second version
    rule.content = "Updated content";
    versionControl.saveVersion(rule, "user", "User update");

    const history = versionControl.getVersionHistory("test-rule-002");
    expect(history).toHaveLength(2);
    expect(history[1].parent_version).toBe(1);
  });

  it("should compare versions", () => {
    const rule = createRuleContent({
      id: "test-rule-003",
      content: "Version 1",
      reason: "Original",
    });

    versionControl.saveVersion(rule, "auto");

    rule.content = "Version 2";
    rule.reason = "Updated";
    versionControl.saveVersion(rule, "user");

    const comparison = versionControl.compareVersions("test-rule-003", 1, 2);
    expect(comparison.contentChanged).toBe(true);
    expect(comparison.reasonChanged).toBe(true);
  });
});

describe("Adaptive Confidence Calculator", () => {
  let adaptiveConfidence: AdaptiveConfidenceCalculator;

  beforeEach(() => {
    adaptiveConfidence = new AdaptiveConfidenceCalculator();
  });

  it("should calculate confidence for pattern", () => {
    const pattern = createPattern({
      type: PatternType.REPEATED_CORRECTION,
      description: "Use async/await instead of promises",
      occurrences: [
        {
          session_id: "session-1",
          timestamp: new Date().toISOString(),
          user_action: "explicit_correction",
          context: "src/api.ts",
        },
        {
          session_id: "session-1",
          timestamp: new Date().toISOString(),
          user_action: "explicit_correction",
          context: "src/handlers.ts",
        },
      ],
      first_seen: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      last_seen: new Date().toISOString(),
    });

    const confidence = adaptiveConfidence.calculateConfidence(pattern);
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("should record and retrieve feedback", () => {
    const feedback = {
      rule_id: "rule-001",
      timestamp: new Date().toISOString(),
      feedback_type: "used" as const,
      user_rating: 5,
    };

    adaptiveConfidence.recordFeedback(feedback);

    const stats = adaptiveConfidence.getFeedbackStats("rule-001");
    expect(stats.total).toBe(1);
    expect(stats.used).toBe(1);
  });
});

describe("Enhanced Scene Detector", () => {
  let sceneDetector: EnhancedSceneDetector;

  beforeEach(() => {
    sceneDetector = new EnhancedSceneDetector();
  });

  it("should detect scene from user input", () => {
    const sceneWeights = sceneDetector.detectMultiScenes({
      userInput: "Fix the React useEffect hook in the authentication component",
    });

    expect(sceneWeights.length).toBeGreaterThan(0);

    const topScene = sceneWeights[0];
    expect(topScene.scene.tech).toContain("react");
    expect(topScene.scene.functional).toContain("auth");
  });

  it("should detect scene from file paths", () => {
    const sceneWeights = sceneDetector.detectMultiScenes({
      filePaths: ["src/components/LoginForm.tsx", "src/api/auth.ts"],
    });

    expect(sceneWeights.length).toBeGreaterThan(0);

    const hasReact = sceneWeights.some((sw) => sw.scene.tech.includes("react"));
    const hasAuth = sceneWeights.some((sw) => sw.scene.functional.includes("auth"));

    expect(hasReact).toBe(true);
    expect(hasAuth).toBe(true);
  });

  it("should assign weights based on evidence", () => {
    const sceneWeights = sceneDetector.detectMultiScenes({
      userInput: "React component with TypeScript",
      filePaths: ["src/Component.tsx"],
    });

    expect(sceneWeights.length).toBeGreaterThan(0);
    expect(sceneWeights[0].weight).toBeGreaterThan(0);
    expect(sceneWeights[0].reasons.length).toBeGreaterThan(0);
  });
});

describe("Indexed Rule Matcher", () => {
  let indexManager: RuleIndexManager;
  let indexedMatcher: IndexedRuleMatcher;

  beforeEach(() => {
    indexManager = new RuleIndexManager();
    indexedMatcher = new IndexedRuleMatcher(indexManager);
  });

  it("should build index from rules", () => {
    const rules = [
      createRuleIndexEntry({
        id: "rule-001",
        type: PatternType.PREFERENCE,
        keywords: ["react", "hooks"],
        scenes: { tech: ["react"], functional: ["ui"], business: [] },
      }),
      createRuleIndexEntry({
        id: "rule-002",
        type: PatternType.SECURITY,
        keywords: ["sql", "injection"],
        scenes: { tech: [], functional: ["database"], business: [] },
      }),
    ];

    indexedMatcher.buildIndex(rules);

    const stats = indexedMatcher.getIndexStats();
    expect(stats.indexed_rules).toBe(2);
    expect(stats.keyword_count).toBeGreaterThan(0);
  });

  it("should perform fast keyword search", () => {
    const rules = [
      createRuleIndexEntry({
        id: "rule-001",
        type: PatternType.PREFERENCE,
        keywords: ["typescript", "strict"],
      }),
    ];

    indexedMatcher.buildIndex(rules);

    const matches = indexedMatcher.searchByKeyword("typescript");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe("rule-001");
  });
});
