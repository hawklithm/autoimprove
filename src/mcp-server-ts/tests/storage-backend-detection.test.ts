import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RuleIndexManager } from "../src/storage/rule-index.js";

describe("stale empty index.json should not flip backend to legacy JSON", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "autoimprove-stale-json-"));
    process.env.AUTOIMPROVE_STORAGE_ROOT = root;
    const rulesDir = join(root, "rules");
    mkdirSync(rulesDir, { recursive: true });
    // Simulate an installer that left an EMPTY index.json and no rules.db
    writeFileSync(join(rulesDir, "index.json"), '{"version":"1.0","rules":[]}');
  });

  afterEach(() => {
    delete process.env.AUTOIMPROVE_STORAGE_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  it("initializes SQLite and does not mark migration needed", () => {
    const manager = new RuleIndexManager();
    const status = manager.getMigrationStatus();
    expect(status.needsMigration).toBe(false);
    expect(status.backend).toBe("SQLite");
    expect(existsSync(join(root, "rules", "rules.db"))).toBe(true);
    manager.close();
  });

  it("renames the stale empty index.json aside", () => {
    const manager = new RuleIndexManager();
    const rulesDir = join(root, "rules");
    expect(existsSync(join(rulesDir, "index.json"))).toBe(false);
    expect(existsSync(join(rulesDir, "index.json.legacy-empty"))).toBe(true);
    manager.close();
  });

  it("keeps legacy JSON backend when index.json actually has rules", () => {
    const rulesDir = join(root, "rules");
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({ version: "1.0", rules: [{ id: "rule-001", confidence: 0.8, keywords: [], source_memory_ids: [], scenes: { tech: [], functional: [], business: [] } }] })
    );
    const manager = new RuleIndexManager();
    const status = manager.getMigrationStatus();
    expect(status.needsMigration).toBe(true);
    expect(status.backend).toBe("JSON");
    manager.close();
  });
});
