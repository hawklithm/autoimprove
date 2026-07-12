/**
 * Tests for Personalizer (F1/F2/F3): per-user centroid, adaptive thresholds,
 * EMA incremental update, and JSON persistence with encoder version.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Personalizer } from "../src/core/personalizer.js";
import { loadConfig, saveConfig } from "../src/storage/init.js";
import { join } from "path";
import { existsSync, rmSync, readFileSync } from "fs";
import { homedir } from "os";

const TMP_ROOT = "/tmp/autoimprove-test-personalizer";

describe("Personalizer", () => {
  let p: Personalizer;

  beforeEach(() => {
    // Force-persist into a temp dir so we don't touch real profiles.
    process.env.AUTOIMPROVE_STORAGE_ROOT = TMP_ROOT;
    // Enable personalization so Personalizer.recordFeedback is not a no-op.
    const cfg = loadConfig();
    cfg.local_ml = cfg.local_ml || ({} as any);
    cfg.local_ml.enabled = true;
    cfg.local_ml.personalization = { enabled: true, per_user: true };
    saveConfig(cfg);
    p = new Personalizer();
  });

  afterEach(() => {
    rmSync("/tmp/autoimprove-test-personalizer", { recursive: true, force: true });
    delete process.env.AUTOIMPROVE_STORAGE_ROOT;
  });

  it("defaults to configured thresholds when no feedback recorded", () => {
    expect(p.getMatchThreshold("u1")).toBeCloseTo(0.62, 2);
    expect(p.getSimilarityThreshold("u1")).toBeCloseTo(0.25, 2);
  });

  it("updates centroid and tightens threshold toward positives via EMA", () => {
    for (let i = 0; i < 5; i++) {
      p.recordFeedback("u1", "used", "use useMemo to avoid re-render");
    }
    const path = join(TMP_ROOT, "personalization", "u1.json");
    expect(existsSync(path)).toBe(true);
    const prof = JSON.parse(require("fs").readFileSync(path, "utf-8"));
    expect(prof.positive_count).toBe(5);
    expect(prof.centroid.length).toBeGreaterThan(0);
    // More positives than negatives → threshold should be >= default.
    expect(prof.matchThreshold).toBeGreaterThanOrEqual(0.62);
  });

  it("loosens threshold when negatives dominate", () => {
    for (let i = 0; i < 5; i++) {
      p.recordFeedback("u2", "ignored", "unrelated noise signal text");
    }
    const prof = JSON.parse(require("fs").readFileSync(join(TMP_ROOT, "personalization", "u2.json"), "utf-8"));
    expect(prof.negative_count).toBe(5);
    expect(prof.matchThreshold).toBeLessThan(0.62);
  });

  it("folds session signals into centroid via recordSessionAnalyzed", () => {
    p.recordSessionAnalyzed("u3", ["use useMemo to avoid re-render", "prevent duplicate rendering with React.memo"]);
    const prof = JSON.parse(require("fs").readFileSync(join(TMP_ROOT, "personalization", "u3.json"), "utf-8"));
    expect(prof.positive_count).toBe(2);
    expect(prof.centroid.length).toBeGreaterThan(0);
  });

  it("centroidSimilarity is higher for on-style text than off-style text", () => {
    p.recordFeedback("u4", "used", "use useMemo to avoid re-render");
    p.recordFeedback("u4", "used", "prevent duplicate rendering with React.memo");
    const onStyle = p.centroidSimilarity("u4", "avoid re-render with useMemo");
    const offStyle = p.centroidSimilarity("u4", "今天天气真好我们去吃饭吧");
    expect(onStyle).toBeGreaterThan(offStyle);
  });
});
