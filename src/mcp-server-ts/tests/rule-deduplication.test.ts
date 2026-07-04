/**
 * Rule Deduplication Tests
 */

import { describe, it, expect } from "vitest";
import { RuleDeduplicator } from "../src/core/rule-deduplicator.js";
import { RuleIndexEntry, createScene } from "../src/core/models.js";

describe("RuleDeduplicator", () => {
  const deduplicator = new RuleDeduplicator();

  describe("Keyword Similarity", () => {
    it("should detect identical keywords", () => {
      const rule1: RuleIndexEntry = {
        id: "rule-001",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.8,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo", "performance"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const rule2: RuleIndexEntry = {
        id: "rule-002",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.85,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo", "performance"],
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      };

      const similarity = deduplicator.calculateSimilarity(rule1, rule2);
      expect(similarity).toBeGreaterThan(0.8); // High similarity
    });

    it("should detect partial keyword overlap", () => {
      const rule1: RuleIndexEntry = {
        id: "rule-001",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.8,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo", "performance"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const rule2: RuleIndexEntry = {
        id: "rule-002",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.85,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "usememo", "optimization"],
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      };

      const similarity = deduplicator.calculateSimilarity(rule1, rule2);
      expect(similarity).toBeGreaterThan(0.3); // Moderate similarity
      expect(similarity).toBeLessThan(0.8); // Not high similarity
    });

    it("should detect no similarity for different keywords", () => {
      const rule1: RuleIndexEntry = {
        id: "rule-001",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.8,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo", "performance"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const rule2: RuleIndexEntry = {
        id: "rule-002",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.85,
        scenes: createScene({ tech: ["python"], functional: ["database"], business: [] }),
        keywords: ["python", "sql", "injection"],
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      };

      const similarity = deduplicator.calculateSimilarity(rule1, rule2);
      expect(similarity).toBeLessThan(0.5); // Low similarity
    });
  });

  describe("Scene Similarity", () => {
    it("should detect identical scenes", () => {
      const rule1: RuleIndexEntry = {
        id: "rule-001",
        type: "security",
        priority: "critical",
        confidence: 0.9,
        scenes: createScene({ tech: ["python"], functional: ["database"], business: [] }),
        keywords: ["sql", "injection"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const rule2: RuleIndexEntry = {
        id: "rule-002",
        type: "security",
        priority: "critical",
        confidence: 0.92,
        scenes: createScene({ tech: ["python"], functional: ["database"], business: [] }),
        keywords: ["sql", "parameterized"],
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      };

      const similarity = deduplicator.calculateSimilarity(rule1, rule2);
      expect(similarity).toBeGreaterThan(0.5); // Moderate-high similarity (scene + type match)
    });
  });

  describe("Similarity Actions", () => {
    it("should recommend merge for high similarity", () => {
      const newRule: RuleIndexEntry = {
        id: "rule-new",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.8,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo", "performance", "optimization"],
        created_at: "2026-01-03T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
      };

      const existingRules: RuleIndexEntry[] = [
        {
          id: "rule-001",
          type: "repeated-correction",
          priority: "medium",
          confidence: 0.85,
          scenes: createScene({ tech: ["react"], functional: [], business: [] }),
          keywords: ["react", "memo", "performance"],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ];

      const similarities = deduplicator.findSimilarRules(newRule, existingRules);
      expect(similarities.length).toBeGreaterThan(0);

      if (similarities.length > 0 && similarities[0].similarity >= 0.8) {
        expect(similarities[0].action).toBe("merge");
      }
    });

    it("should recommend keep-separate for low similarity", () => {
      const newRule: RuleIndexEntry = {
        id: "rule-new",
        type: "security",
        priority: "critical",
        confidence: 0.9,
        scenes: createScene({ tech: ["python"], functional: ["api"], business: [] }),
        keywords: ["xss", "sanitization", "validation"],
        created_at: "2026-01-03T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
      };

      const existingRules: RuleIndexEntry[] = [
        {
          id: "rule-001",
          type: "repeated-correction",
          priority: "medium",
          confidence: 0.8,
          scenes: createScene({ tech: ["react"], functional: [], business: [] }),
          keywords: ["react", "memo", "performance"],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ];

      const similarities = deduplicator.findSimilarRules(newRule, existingRules);
      // Should find no similar rules (below threshold)
      expect(similarities.length).toBe(0);
    });
  });

  describe("Rule Merging", () => {
    it("should merge keywords correctly", () => {
      const existing: RuleIndexEntry = {
        id: "rule-001",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.8,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const newRule: RuleIndexEntry = {
        id: "rule-002",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.85,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "performance", "optimization"],
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      };

      const merged = deduplicator.mergeRules(existing, newRule);

      // Should have union of keywords
      expect(merged.indexEntry.keywords).toContain("react");
      expect(merged.indexEntry.keywords).toContain("memo");
      expect(merged.indexEntry.keywords).toContain("performance");
      expect(merged.indexEntry.keywords).toContain("optimization");
      expect(merged.indexEntry.keywords.length).toBe(4);
    });

    it("should boost confidence for merged rules", () => {
      const existing: RuleIndexEntry = {
        id: "rule-001",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.75,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const newRule: RuleIndexEntry = {
        id: "rule-002",
        type: "repeated-correction",
        priority: "medium",
        confidence: 0.85,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo"],
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      };

      const merged = deduplicator.mergeRules(existing, newRule);

      // Confidence should be boosted (average + boost factor)
      expect(merged.indexEntry.confidence).toBeGreaterThan(0.8);
      expect(merged.indexEntry.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe("Type Filtering", () => {
    it("should not merge rules with different types", () => {
      const newRule: RuleIndexEntry = {
        id: "rule-new",
        type: "security", // Different type
        priority: "critical",
        confidence: 0.9,
        scenes: createScene({ tech: ["react"], functional: [], business: [] }),
        keywords: ["react", "memo", "performance"],
        created_at: "2026-01-03T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
      };

      const existingRules: RuleIndexEntry[] = [
        {
          id: "rule-001",
          type: "repeated-correction", // Different type
          priority: "medium",
          confidence: 0.8,
          scenes: createScene({ tech: ["react"], functional: [], business: [] }),
          keywords: ["react", "memo", "performance"],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ];

      const similarities = deduplicator.findSimilarRules(newRule, existingRules);
      // Should not find similar rules (different types filtered out)
      expect(similarities.length).toBe(0);
    });
  });
});
