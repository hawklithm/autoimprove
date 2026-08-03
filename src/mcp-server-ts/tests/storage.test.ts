import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { RuleIndexManager } from "../src/storage/rule-index.js";
import { RuleContentManager } from "../src/storage/rule-content.js";
import { SessionArchiveManager } from "../src/storage/session-archive.js";
import { initStorage, loadConfig } from "../src/storage/init.js";
import { PatternType, Priority, createScene } from "../src/core/models.js";

describe("RuleIndexManager", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalStorageRoot: string | undefined;
  let activeManager: RuleIndexManager | undefined;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = join(tmpdir(), `autoimprove-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(join(tempDir, ".autoimprove", "rules"), { recursive: true });

    // Override storage root via env var
    originalStorageRoot = process.env.AUTOIMPROVE_STORAGE_ROOT;
    process.env.AUTOIMPROVE_STORAGE_ROOT = join(tempDir, ".autoimprove");
  });

  afterEach(() => {
    // Release SQLite handles before removing the temporary directory on
    // Windows.  SQLite keeps WAL/shm files locked until the connection closes.
    activeManager?.close();

    // Restore env vars
    if (originalStorageRoot !== undefined) {
      process.env.AUTOIMPROVE_STORAGE_ROOT = originalStorageRoot;
    } else {
      delete process.env.AUTOIMPROVE_STORAGE_ROOT;
    }

    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should load empty index", () => {
    const manager = activeManager = new RuleIndexManager();
    const index = manager.loadIndex();

    expect(index.version).toBe("1.0");
    expect(index.rules).toHaveLength(0);
  });

  it("should save and load index", () => {
    const manager = activeManager = new RuleIndexManager();

    const entry = {
      id: "rule-001",
      type: PatternType.REPEATED_CORRECTION,
      priority: Priority.HIGH,
      confidence: 0.75,
      scenes: createScene({ tech: ["react"], functional: ["auth"] }),
      keywords: ["token", "refresh"],
      created_at: "2026-05-30T10:00:00Z",
      updated_at: "2026-05-30T10:00:00Z",
    };

    manager.addRule(entry);

    const index = manager.loadIndex();
    expect(index.rules).toHaveLength(1);
    expect(index.rules[0].id).toBe("rule-001");
    expect(index.rules[0].confidence).toBe(0.75);
  });

  it("should find a rule by ID without regard to case", () => {
    const manager = activeManager = new RuleIndexManager();
    const entry = {
      id: "rule-Case-001",
      type: PatternType.PREFERENCE,
      priority: Priority.MEDIUM,
      confidence: 0.8,
      scenes: createScene(),
      keywords: [],
      created_at: "2026-05-30T10:00:00Z",
      updated_at: "2026-05-30T10:00:00Z",
    };

    manager.addRule(entry, {
      id: entry.id,
      content: "Use the canonical rule ID when loading content.",
      reason: "Preserves the stored rule identity.",
      metadata: {},
    });

    expect(manager.getRule("RULE-case-001")?.id).toBe("rule-Case-001");
  });

  it("should reject duplicate rule ID", () => {
    const manager = activeManager = new RuleIndexManager();

    const entry = {
      id: "rule-001",
      type: PatternType.PREFERENCE,
      priority: Priority.LOW,
      confidence: 0.5,
      scenes: createScene(),
      keywords: [],
      created_at: "2026-05-30T10:00:00Z",
      updated_at: "2026-05-30T10:00:00Z",
    };

    manager.addRule(entry);

    expect(() => manager.addRule(entry)).toThrow("already exists");
  });

  it("should update rule", () => {
    const manager = activeManager = new RuleIndexManager();

    const entry = {
      id: "rule-001",
      type: PatternType.PREFERENCE,
      priority: Priority.LOW,
      confidence: 0.5,
      scenes: createScene(),
      keywords: [],
      created_at: "2026-05-30T10:00:00Z",
      updated_at: "2026-05-30T10:00:00Z",
    };

    manager.addRule(entry);
    manager.updateRule("rule-001", { confidence: 0.8, priority: Priority.HIGH });

    const rule = manager.getRule("rule-001");
    expect(rule?.confidence).toBe(0.8);
    expect(rule?.priority).toBe(Priority.HIGH);
  });

  it("should remove rule", () => {
    const manager = activeManager = new RuleIndexManager();

    const entry = {
      id: "rule-001",
      type: PatternType.PREFERENCE,
      priority: Priority.LOW,
      confidence: 0.5,
      scenes: createScene(),
      keywords: [],
      created_at: "2026-05-30T10:00:00Z",
      updated_at: "2026-05-30T10:00:00Z",
    };

    manager.addRule(entry);
    manager.removeRule("rule-001");

    expect(manager.getRule("rule-001")).toBeNull();
  });

  it("should list rules with filters", () => {
    const manager = activeManager = new RuleIndexManager();

    for (let i = 0; i < 3; i++) {
      const entry = {
        id: `rule-${String(i).padStart(3, "0")}`,
        type: i === 0 ? PatternType.PREFERENCE : PatternType.SECURITY,
        priority: i === 0 ? Priority.LOW : Priority.CRITICAL,
        confidence: 0.3 + i * 0.2,
        scenes: createScene(),
        keywords: [],
        created_at: "2026-05-30T10:00:00Z",
        updated_at: "2026-05-30T10:00:00Z",
      };
      manager.addRule(entry);
    }

    const securityRules = manager.listRules({ typeFilter: PatternType.SECURITY });
    expect(securityRules).toHaveLength(2);

    const criticalRules = manager.listRules({ priorityFilter: Priority.CRITICAL });
    expect(criticalRules).toHaveLength(2);

    const highConfRules = manager.listRules({ minConfidence: 0.6 });
    expect(highConfRules).toHaveLength(1);
  });

  it("should generate next ID", () => {
    const manager = activeManager = new RuleIndexManager();

    expect(manager.getNextRuleId()).toBe("rule-001");

    const entry = {
      id: "rule-001",
      type: PatternType.PREFERENCE,
      priority: Priority.LOW,
      confidence: 0.5,
      scenes: createScene(),
      keywords: [],
      created_at: "2026-05-30T10:00:00Z",
      updated_at: "2026-05-30T10:00:00Z",
    };
    manager.addRule(entry);

    expect(manager.getNextRuleId()).toBe("rule-002");
  });
});

describe("RuleContentManager", () => {
  let tempDir: string;
  let originalStorageRoot: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `autoimprove-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(join(tempDir, ".autoimprove", "rules", "content"), { recursive: true });

    originalStorageRoot = process.env.AUTOIMPROVE_STORAGE_ROOT;
    process.env.AUTOIMPROVE_STORAGE_ROOT = join(tempDir, ".autoimprove");
  });

  afterEach(() => {
    if (originalStorageRoot !== undefined) {
      process.env.AUTOIMPROVE_STORAGE_ROOT = originalStorageRoot;
    } else {
      delete process.env.AUTOIMPROVE_STORAGE_ROOT;
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should save and load content", () => {
    const manager = new RuleContentManager();

    const rule = {
      id: "rule-001",
      content: "Always use refreshToken() helper function for JWT token refresh",
      reason: "Prevents inconsistent token handling and security issues",
      metadata: {
        type: PatternType.REPEATED_CORRECTION,
        priority: Priority.HIGH,
        confidence: 0.75,
      },
    };

    manager.saveContent(rule);

    const loaded = manager.loadContent("rule-001");
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("rule-001");
    expect(loaded?.content).toContain("refreshToken()");
    expect(loaded?.metadata.confidence).toBe(0.75);
  });

  it("should return null for non-existent content", () => {
    const manager = new RuleContentManager();
    expect(manager.loadContent("rule-999")).toBeNull();
  });

  it("should delete content", () => {
    const manager = new RuleContentManager();

    const rule = {
      id: "rule-001",
      content: "Test content",
      reason: "Test reason",
      metadata: {},
    };

    manager.saveContent(rule);
    expect(manager.exists("rule-001")).toBe(true);

    manager.deleteContent("rule-001");
    expect(manager.exists("rule-001")).toBe(false);
  });
});

describe("SessionArchiveManager", () => {
  let tempDir: string;
  let originalStorageRoot: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `autoimprove-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(join(tempDir, ".autoimprove", "sessions"), { recursive: true });

    originalStorageRoot = process.env.AUTOIMPROVE_STORAGE_ROOT;
    process.env.AUTOIMPROVE_STORAGE_ROOT = join(tempDir, ".autoimprove");
  });

  afterEach(() => {
    if (originalStorageRoot !== undefined) {
      process.env.AUTOIMPROVE_STORAGE_ROOT = originalStorageRoot;
    } else {
      delete process.env.AUTOIMPROVE_STORAGE_ROOT;
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should save and load session", () => {
    const manager = new SessionArchiveManager();

    const archive = {
      session_id: "session-001",
      created_at: "2026-05-30T10:00:00Z",
      patterns_count: 2,
      rules_generated: ["rule-001", "rule-002"],
      metadata: { duration_ms: 1500 },
    };

    manager.saveArchive(archive);

    const loaded = manager.loadArchive("session-001");
    expect(loaded).not.toBeNull();
    expect(loaded?.session_id).toBe("session-001");
    expect(loaded?.rules_generated).toHaveLength(2);
  });

  it("should list archives", () => {
    const manager = new SessionArchiveManager();

    for (let i = 0; i < 3; i++) {
      const archive = {
        session_id: `session-${String(i).padStart(3, "0")}`,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        patterns_count: i,
        rules_generated: [],
      };
      manager.saveArchive(archive);
    }

    const archives = manager.listArchives();
    expect(archives).toHaveLength(3);
    // Should be sorted by created_at descending
    expect(archives[0].session_id).toBe("session-000");
  });
});

describe("Storage Initialization", () => {
  it("should have valid config structure", () => {
    const config = loadConfig();

    expect(config.version).toBe("1.0");
    expect(config.confidence_thresholds).toBeDefined();
    expect(config.confidence_weights).toBeDefined();
    expect(config.rule_matching).toBeDefined();
    expect(config.business_domain_mappings).toBeDefined();
  });
});
