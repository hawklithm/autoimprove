/**
 * QualityMetricsCollector — Phase 7 / P3
 *
 * Aggregates long-lived quality signals across the rule pipeline so operators
 * can watch for regressions:
 *   - pattern rejection rate (by reason)
 *   - memory rejection rate (by reason)
 *   - review queue size
 *   - average rule quality score
 *   - orphaned-rule ratio
 *
 * A module-level singleton (`qualityMetrics`) is recorded into by the pipeline
 * components (pattern filter, memory gate, rule generator) and surfaced through
 * the `get_quality_metrics` MCP tool, which also evaluates alert thresholds.
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type QualityAlertLevel = "info" | "warning" | "critical";

export interface QualityAlert {
  level: QualityAlertLevel;
  code: string;
  message: string;
}

export interface QualityMetricThresholds {
  /** Alert when the review queue holds more than this many pending rules. */
  review_queue_size?: number;
  /** Alert when the orphaned-rule ratio exceeds this fraction. */
  orphaned_ratio?: number;
  /** Alert when pattern rejection rate exceeds this fraction (over-blocking). */
  pattern_rejection_rate?: number;
  /** Alert when memory rejection rate exceeds this fraction (over-blocking). */
  memory_rejection_rate?: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: Required<QualityMetricThresholds> = {
  review_queue_size: 50,
  orphaned_ratio: 0.2,
  pattern_rejection_rate: 0.5,
  memory_rejection_rate: 0.5,
};

export interface QualityMetricsSnapshot {
  generated_at: string;
  pattern_rejections: Record<string, number>;
  memory_rejections: Record<string, number>;
  pattern_accepted: number;
  memory_accepted: number;
  pattern_rejection_rate: number;
  memory_rejection_rate: number;
  review_queue_size: number;
  total_rules: number;
  orphaned_ratio: number;
  average_rule_quality: number;
  thresholds: Required<QualityMetricThresholds>;
  alerts: QualityAlert[];
}

export class QualityMetricsCollector {
  private patternRejections = new Map<string, number>();
  private memoryRejections = new Map<string, number>();
  private patternAccepted = 0;
  private memoryAccepted = 0;
  private qualityScores: number[] = [];

  recordPatternRejection(reason: string): void {
    const key = reason || "unknown";
    this.patternRejections.set(key, (this.patternRejections.get(key) || 0) + 1);
  }

  recordPatternAccepted(): void {
    this.patternAccepted++;
  }

  recordMemoryRejection(reason: string): void {
    const key = reason || "unknown";
    this.memoryRejections.set(key, (this.memoryRejections.get(key) || 0) + 1);
  }

  recordMemoryAccepted(): void {
    this.memoryAccepted++;
  }

  recordQualityScore(score: number): void {
    if (typeof score === "number" && score >= 0 && score <= 1) {
      this.qualityScores.push(score);
    }
  }

  private rate(rejected: number, accepted: number): number {
    const total = rejected + accepted;
    return total === 0 ? 0 : rejected / total;
  }

  evaluateAlerts(input: {
    reviewQueueSize: number;
    totalRules: number;
    orphanedRatio: number;
    thresholds?: QualityMetricThresholds;
  }): QualityAlert[] {
    const t = { ...DEFAULT_QUALITY_THRESHOLDS, ...(input.thresholds || {}) };
    const alerts: QualityAlert[] = [];

    const prRate = this.rate(this.sum(this.patternRejections), this.patternAccepted);
    const mrRate = this.rate(this.sum(this.memoryRejections), this.memoryAccepted);

    if (input.reviewQueueSize > t.review_queue_size) {
      alerts.push({
        level: input.reviewQueueSize > t.review_queue_size * 2 ? "critical" : "warning",
        code: "review_queue_overflow",
        message: `Review queue has ${input.reviewQueueSize} pending rules (threshold ${t.review_queue_size})`,
      });
    }
    if (input.totalRules > 0 && input.orphanedRatio > t.orphaned_ratio) {
      alerts.push({
        level: input.orphanedRatio > t.orphaned_ratio * 2 ? "critical" : "warning",
        code: "high_orphaned_ratio",
        message: `Orphaned-rule ratio ${(input.orphanedRatio * 100).toFixed(1)}% exceeds threshold ${(t.orphaned_ratio * 100).toFixed(0)}%`,
      });
    }
    if (prRate > t.pattern_rejection_rate) {
      alerts.push({
        level: "warning",
        code: "pattern_over_blocking",
        message: `Pattern rejection rate ${(prRate * 100).toFixed(1)}% is unusually high (threshold ${(t.pattern_rejection_rate * 100).toFixed(0)}%)`,
      });
    }
    if (mrRate > t.memory_rejection_rate) {
      alerts.push({
        level: "warning",
        code: "memory_over_blocking",
        message: `Memory rejection rate ${(mrRate * 100).toFixed(1)}% is unusually high (threshold ${(t.memory_rejection_rate * 100).toFixed(0)}%)`,
      });
    }
    return alerts;
  }

  private sum(map: Map<string, number>): number {
    let s = 0;
    for (const v of map.values()) s += v;
    return s;
  }

  private avg(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  snapshot(input: {
    reviewQueueSize: number;
    totalRules: number;
    orphanedRatio: number;
    thresholds?: QualityMetricThresholds;
  }): QualityMetricsSnapshot {
    const thresholds = { ...DEFAULT_QUALITY_THRESHOLDS, ...(input.thresholds || {}) };
    const prRate = this.rate(this.sum(this.patternRejections), this.patternAccepted);
    const mrRate = this.rate(this.sum(this.memoryRejections), this.memoryAccepted);

    const patternRejections: Record<string, number> = {};
    for (const [k, v] of this.patternRejections) patternRejections[k] = v;
    const memoryRejections: Record<string, number> = {};
    for (const [k, v] of this.memoryRejections) memoryRejections[k] = v;

    return {
      generated_at: new Date().toISOString(),
      pattern_rejections: patternRejections,
      memory_rejections: memoryRejections,
      pattern_accepted: this.patternAccepted,
      memory_accepted: this.memoryAccepted,
      pattern_rejection_rate: Number(prRate.toFixed(3)),
      memory_rejection_rate: Number(mrRate.toFixed(3)),
      review_queue_size: input.reviewQueueSize,
      total_rules: input.totalRules,
      orphaned_ratio: Number(input.orphanedRatio.toFixed(3)),
      average_rule_quality: Number(this.avg(this.qualityScores).toFixed(3)),
      thresholds,
      alerts: this.evaluateAlerts(input),
    };
  }

  /** Reset all counters (e.g. after exporting). */
  reset(): void {
    this.patternRejections.clear();
    this.memoryRejections.clear();
    this.patternAccepted = 0;
    this.memoryAccepted = 0;
    this.qualityScores = [];
  }

  /** Persist the current snapshot to disk for dashboards / CI. */
  saveSnapshot(snapshot: QualityMetricsSnapshot, path?: string): string {
    const out = path || join(process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove"), "quality_metrics.json");
    const dir = out.substring(0, out.lastIndexOf("/"));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(out, JSON.stringify(snapshot, null, 2), "utf-8");
    return out;
  }
}

/** Singleton recorded into by the pipeline; surfaced via `get_quality_metrics`. */
export const qualityMetrics = new QualityMetricsCollector();
