import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  QualityMetricsCollector,
  DEFAULT_QUALITY_THRESHOLDS,
} from "../src/core/quality-metrics.js";

const TMP_ROOTS: string[] = [];
function tmp(): string {
  const r = mkdtempSync(join(tmpdir(), "qmetrics-"));
  TMP_ROOTS.push(r);
  return r;
}
afterAll(() => {
  for (const r of TMP_ROOTS) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("QualityMetricsCollector", () => {
  it("computes pattern rejection rate by reason", () => {
    const c = new QualityMetricsCollector();
    c.recordPatternRejection("business-dominant");
    c.recordPatternRejection("business-dominant");
    c.recordPatternAccepted();
    const snap = c.snapshot({ reviewQueueSize: 0, totalRules: 10, orphanedRatio: 0 });
    expect(snap.pattern_rejections["business-dominant"]).toBe(2);
    expect(snap.pattern_accepted).toBe(1);
    // 2 rejected / (2+1) = 0.667
    expect(snap.pattern_rejection_rate).toBeCloseTo(0.667, 2);
  });

  it("computes memory rejection rate", () => {
    const c = new QualityMetricsCollector();
    c.recordMemoryRejection("non-code-content");
    c.recordMemoryAccepted();
    c.recordMemoryAccepted();
    const snap = c.snapshot({ reviewQueueSize: 0, totalRules: 10, orphanedRatio: 0 });
    expect(snap.memory_rejections["non-code-content"]).toBe(1);
    expect(snap.memory_rejection_rate).toBeCloseTo(1 / 3, 2);
  });

  it("flags review queue overflow", () => {
    const c = new QualityMetricsCollector();
    const alerts = c.evaluateAlerts({ reviewQueueSize: 120, totalRules: 10, orphanedRatio: 0 });
    const a = alerts.find((x) => x.code === "review_queue_overflow");
    expect(a).toBeDefined();
    expect(a!.level).toBe("critical"); // > 2x threshold (50*2=100)
  });

  it("flags high orphaned ratio", () => {
    const c = new QualityMetricsCollector();
    const alerts = c.evaluateAlerts({ reviewQueueSize: 0, totalRules: 100, orphanedRatio: 0.35 });
    const a = alerts.find((x) => x.code === "high_orphaned_ratio");
    expect(a).toBeDefined();
    expect(a!.level).toBe("warning");
  });

  it("flags pattern over-blocking", () => {
    const c = new QualityMetricsCollector();
    c.recordPatternRejection("business-dominant");
    c.recordPatternRejection("business-dominant");
    c.recordPatternAccepted();
    const alerts = c.evaluateAlerts({ reviewQueueSize: 0, totalRules: 10, orphanedRatio: 0 });
    const a = alerts.find((x) => x.code === "pattern_over_blocking");
    expect(a).toBeDefined();
  });

  it("issues no alerts within thresholds", () => {
    const c = new QualityMetricsCollector();
    c.recordPatternAccepted();
    c.recordMemoryAccepted();
    const alerts = c.evaluateAlerts({
      reviewQueueSize: 5,
      totalRules: 100,
      orphanedRatio: 0.05,
    });
    expect(alerts.length).toBe(0);
  });

  it("persists a snapshot to disk", () => {
    const c = new QualityMetricsCollector();
    c.recordPatternRejection("business-dominant");
    c.recordQualityScore(0.8);
    const dir = tmp();
    const path = join(dir, "quality_metrics.json");
    const written = c.saveSnapshot(
      c.snapshot({ reviewQueueSize: 3, totalRules: 10, orphanedRatio: 0.1 }),
      path
    );
    expect(existsSync(written)).toBe(true);
    const parsed = JSON.parse(readFileSync(written, "utf-8"));
    expect(parsed.review_queue_size).toBe(3);
    expect(parsed.thresholds.review_queue_size).toBe(DEFAULT_QUALITY_THRESHOLDS.review_queue_size);
  });
});
