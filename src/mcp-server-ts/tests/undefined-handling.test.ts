/**
 * Tests for undefined/null handling in storage layer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RuleIndexManager } from "../src/storage/rule-index.js";
import { PatternType, Priority } from "../src/core/models.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

describe("Undefined/Null Handling", () => {
  const testStorageRoot = join(process.cwd(), "test-storage-undefined");
  const originalEnv = process.env.AUTOIMPROVE_STORAGE_ROOT;
  let activeManager: RuleIndexManager | undefined;

  beforeEach(() => {
    process.env.AUTOIMPROVE_STORAGE_ROOT = testStorageRoot;
    activeManager?.close();
    if (existsSync(testStorageRoot)) {
      rmSync(testStorageRoot, { recursive: true });
    }
    mkdirSync(testStorageRoot, { recursive: true });
  });

  afterEach(() => {
    activeManager?.close();
    if (existsSync(testStorageRoot)) {
      rmSync(testStorageRoot, { recursive: true });
    }
    if (originalEnv) {
      process.env.AUTOIMPROVE_STORAGE_ROOT = originalEnv;
    } else {
      delete process.env.AUTOIMPROVE_STORAGE_ROOT;
    }
  });

  it("should handle rule with undefined keywords", () => {
    const manager = activeManager = new RuleIndexManager();

    const ruleWithUndefinedKeywords: any = {
      id: "rule-001",
      type: PatternType.REPEATED_CORRECTION,
      priority: Priority.MEDIUM,
      confidence: 0.8,
      scenes: { tech: ["react"], functional: ["auth"], business: [] },
      keywords: undefined, // Explicitly undefined
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(() => manager.addRule(ruleWithUndefinedKeywords)).not.toThrow();

    const loaded = manager.getRule("rule-001");
    expect(loaded).not.toBeNull();
    expect(loaded?.keywords).toEqual([]); // Should be normalized to empty array
  });

  it("should handle rule with null keywords", () => {
    const manager = activeManager = new RuleIndexManager();

    const ruleWithNullKeywords: any = {
      id: "rule-002",
      type: PatternType.ANTI_PATTERN,
      priority: Priority.HIGH,
      confidence: 0.9,
      scenes: { tech: ["vue"], functional: ["validation"], business: [] },
      keywords: null, // Explicitly null
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(() => manager.addRule(ruleWithNullKeywords)).not.toThrow();

    const loaded = manager.getRule("rule-002");
    expect(loaded).not.toBeNull();
    expect(loaded?.keywords).toEqual([]); // Should be normalized to empty array
  });

  it("should handle rule with missing scenes fields", () => {
    const manager = activeManager = new RuleIndexManager();

    const ruleWithPartialScenes: any = {
      id: "rule-003",
      type: PatternType.PREFERENCE,
      priority: Priority.LOW,
      confidence: 0.7,
      scenes: { tech: ["python"] }, // Missing functional and business
      keywords: ["async", "await"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(() => manager.addRule(ruleWithPartialScenes)).not.toThrow();

    const loaded = manager.getRule("rule-003");
    expect(loaded).not.toBeNull();
    expect(loaded?.scenes.tech).toEqual(["python"]);
    expect(loaded?.scenes.functional).toEqual([]); // Should be normalized to empty array
    expect(loaded?.scenes.business).toEqual([]); // Should be normalized to empty array
  });

  it("should handle corrupted index file with malformed rules", () => {
    const rulesDir = join(testStorageRoot, "rules");
    mkdirSync(rulesDir, { recursive: true });

    const corruptedIndex = {
      version: "1.0",
      rules: [
        {
          id: "rule-good",
          type: "repeated-correction",
          priority: "medium",
          confidence: 0.8,
          scenes: { tech: ["react"], functional: [], business: [] },
          keywords: ["test"],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        null, // Corrupted entry
        {
          id: "rule-partial",
          type: "anti-pattern",
          priority: "high",
          confidence: 0.9,
          scenes: undefined, // Missing scenes
          keywords: undefined, // Missing keywords
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };

    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify(corruptedIndex, null, 2)
    );

    const manager = activeManager = new RuleIndexManager();
    const index = manager.loadIndex();

    // Should filter out null entries and normalize the rest
    expect(index.rules.length).toBe(2); // null entry filtered out
    expect(index.rules[0].id).toBe("rule-good");
    expect(index.rules[1].id).toBe("rule-partial");
    expect(index.rules[1].keywords).toEqual([]); // Normalized
    expect(index.rules[1].scenes).toBeDefined(); // Normalized
  });

  it("should handle completely invalid JSON", () => {
    const rulesDir = join(testStorageRoot, "rules");
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(join(rulesDir, "index.json"), "{ invalid json");

    const manager = activeManager = new RuleIndexManager();
    const index = manager.loadIndex();

    // Should return empty index on parse error
    expect(index.rules).toEqual([]);
  });

  it("should handle index with missing rules array", () => {
    const rulesDir = join(testStorageRoot, "rules");
    mkdirSync(rulesDir, { recursive: true });

    const indexWithoutRules = {
      version: "1.0",
      // Missing rules array
    };

    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify(indexWithoutRules, null, 2)
    );

    const manager = activeManager = new RuleIndexManager();
    const index = manager.loadIndex();

    // Should normalize to empty rules array
    expect(index.rules).toEqual([]);
  });

  it("should handle adding completely undefined entry", () => {
    const manager = activeManager = new RuleIndexManager();

    expect(() => manager.addRule(undefined as any)).toThrow(
      "Failed to normalize rule entry"
    );
  });

  it("should handle adding null entry", () => {
    const manager = activeManager = new RuleIndexManager();

    expect(() => manager.addRule(null as any)).toThrow(
      "Failed to normalize rule entry"
    );
  });
});
