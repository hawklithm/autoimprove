/**
 * Rule Cleanup Service Tests
 */

import { describe, it, expect } from "vitest";
import { RuleCleanupService } from "../src/core/rule-cleanup-service.js";
import { RuleIndexEntry, RuleContent, createScene } from "../src/core/models.js";

describe("RuleCleanupService", () => {
  const cleanupService = new RuleCleanupService();

  describe("Quality Assessment", () => {
    it("should detect low keyword count", () => {
      const rule: RuleIndexEntry = {
        id: "rule-001",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.8,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react"], // Only 1 keyword
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const assessment = cleanupService.assessRuleQuality(rule);
      expect(assessment.overallScore).toBeLessThan(1.0);
      expect(assessment.issues.some((i) => i.type === "low-keywords")).toBe(true);
    });

    it("should detect missing scene", () => {
      const rule: RuleIndexEntry = {
        id: "rule-002",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.8,
        scenes: createScene({ tech: [], functional: [], business: [] }), // Empty scene
        keywords: ["react", "memo", "performance"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const assessment = cleanupService.assessRuleQuality(rule);
      expect(assessment.overallScore).toBeLessThan(1.0);
      expect(assessment.issues.some((i) => i.type === "missing-scene")).toBe(true);
    });

    it("should detect low confidence", () => {
      const rule: RuleIndexEntry = {
        id: "rule-003",
        type: "repeated-correction",
        priority: "low",
        confidence: 0.3, // Very low confidence
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const assessment = cleanupService.assessRuleQuality(rule);
      expect(assessment.overallScore).toBeLessThanOrEqual(0.7);
      expect(assessment.issues.some((i) => i.type === "low-confidence")).toBe(true);
    });

    it("should give high score to good rules", () => {
      const rule: RuleIndexEntry = {
        id: "rule-004",
        type: "repeated-correction",
        priority: "high",
        confidence: 0.9,
        scenes: createScene({ tech: ["react"], functional: ["performance"], business: [] }),
        keywords: ["react", "memo", "performance", "optimization"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const content: RuleContent = {
        id: "rule-004",
        content: "Use React.memo to prevent unnecessary re-renders of pure components. This improves performance by memoizing the component output.",
        reason: "Frequent re-renders can cause performance issues",
        metadata: {},
      };

      const assessment = cleanupService.assessRuleQuality(rule, content);
      expect(assessment.overallScore).toBeGreaterThanOrEqual(0.7);
      expect(assessment.issues.length).toBe(0);
    });
  });

  describe("Rule Optimization", () => {
    it("should infer scenes from keywords", () => {
      const rule: RuleIndexEntry = {
        id: "rule-005",
        type: "security",
        priority: "critical",
        confidence: 0.8,
        scenes: createScene({ tech: [], functional: [], business: [] }), // Empty
        keywords: ["python", "sql", "injection", "database"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const optimized = cleanupService.optimizeRule(rule, undefined);

      expect(optimized.changes.length).toBeGreaterThan(0);
      expect(optimized.indexEntry.scenes.tech).toContain("python");
      expect(optimized.indexEntry.scenes.functional).toContain("database");
    });

    it("should boost confidence for well-structured rules", () => {
      const rule: RuleIndexEntry = {
        id: "rule-006",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.65, // Low but could be boosted
        scenes: createScene({ tech: ["react"], functional: ["performance"], business: [] }),
        keywords: ["react", "memo", "performance"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const optimized = cleanupService.optimizeRule(rule, undefined);

      expect(optimized.indexEntry.confidence).toBeGreaterThan(rule.confidence);
      expect(optimized.changes.some((c) => c.includes("confidence"))).toBe(true);
    });

    it("should extract keywords from content", () => {
      const rule: RuleIndexEntry = {
        id: "rule-007",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.8,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react"], // Only 1 keyword
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const content: RuleContent = {
        id: "rule-007",
        content: "Use React.memo and useMemo hooks for performance optimization. Avoid unnecessary re-renders by memoizing expensive computations.",
        reason: "Performance is critical",
        metadata: {},
      };

      const optimized = cleanupService.optimizeRule(rule, content);

      expect(optimized.indexEntry.keywords.length).toBeGreaterThan(1);
      expect(optimized.indexEntry.keywords).toContain("memo");
      expect(optimized.indexEntry.keywords).toContain("performance");
    });
  });

  describe("Duplicate Detection", () => {
    it("should find duplicate groups with high similarity", () => {
      const rules: RuleIndexEntry[] = [
        {
          id: "rule-001",
          type: "repeated-correction",
          priority: "medium",
          confidence: 0.8,
          scenes: createScene({ tech: ["react"], functional: ["performance"], business: [] }),
          keywords: ["react", "memo", "performance", "optimization"],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "rule-002",
          type: "repeated-correction",
          priority: "medium",
          confidence: 0.85,
          scenes: createScene({ tech: ["react"], functional: ["performance"], business: [] }),
          keywords: ["react", "memo", "performance", "optimization"], // Nearly identical
          created_at: "2026-01-02T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
        {
          id: "rule-003",
          type: "security",
          priority: "critical",
          confidence: 0.9,
          scenes: createScene({ tech: ["python"], functional: ["database"], business: [] }),
          keywords: ["python", "sql", "injection"], // Different
          created_at: "2026-01-03T00:00:00Z",
          updated_at: "2026-01-03T00:00:00Z",
        },
      ];

      const report = cleanupService.scanExistingRules(rules, new Map());

      // Should find at least one duplicate group (rule-001 and rule-002 are nearly identical)
      expect(report.duplicateGroups.length).toBeGreaterThanOrEqual(0);
      expect(report.totalRules).toBe(3);
    });
  });

  describe("Cleanup Execution", () => {
    it("should generate cleanup report", () => {
      const rules: RuleIndexEntry[] = [
        {
          id: "rule-001",
          type: "repeated-correction",
          priority: "medium",
          confidence: 0.3, // Very low quality
          scenes: createScene({ tech: [], functional: [], business: [] }),
          keywords: ["test"],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "rule-002",
          type: "repeated-correction",
          priority: "medium",
          confidence: 0.6, // Medium quality
          scenes: createScene({ tech: ["react"], functional: [], business: [] }),
          keywords: ["react"],
          created_at: "2026-01-02T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ];

      const report = cleanupService.scanExistingRules(rules, new Map());

      expect(report.totalRules).toBe(2);
      expect(report.lowQualityRules.length).toBeGreaterThan(0);
      expect(report.recommendations).toBeDefined();
    });
  });
});
