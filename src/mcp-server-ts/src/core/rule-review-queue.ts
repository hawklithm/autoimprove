/**
 * RuleReviewQueue — Phase 3 / P0
 *
 * A lightweight, file-backed queue of rules that were generated but blocked from
 * automatic入库 (empty scenes, LLM-rejected, low quality score, orphaned memory
 * references). A human reviewer later approves or rejects each item via the
 * `list_review_queue` / `approve_rule` / `reject_rule` MCP tools.
 *
 * Storage: `~/.autoimprove/review_queue.jsonl` (one JSON object per line).
 * Decisions are persisted by rewriting the file with the updated item status,
 * so the queue is crash-safe and auditable.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { STORAGE_ROOT } from "../storage/init.js";
import { RuleIndexEntry, RuleContent } from "./models.js";

export type ReviewReason =
  | "empty_scene"
  | "low_quality_score"
  | "llm_rejected"
  | "orphaned_memory"
  | string;

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface RuleReviewItem {
  rule_id: string;
  title?: string;
  /** Human-readable reason the rule was held for review. */
  reason: ReviewReason;
  /** Original index entry (scenes / confidence / keywords). */
  index_entry: RuleIndexEntry;
  /** Original rule content. */
  rule_content: RuleContent;
  created_at: string;
  status: ReviewStatus;
  decided_at?: string;
  decision_note?: string;
}

export interface RuleReviewDecision {
  rule_id: string;
  status: "approved" | "rejected";
  note?: string;
}

export class RuleReviewQueue {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? `${STORAGE_ROOT}/review_queue.jsonl`;
  }

  /** Write a new pending item to the queue. Returns the stored item. */
  add(item: Omit<RuleReviewItem, "status" | "created_at"> & Partial<Pick<RuleReviewItem, "status" | "created_at">>): RuleReviewItem {
    const full: RuleReviewItem = {
      status: item.status ?? "pending",
      created_at: item.created_at ?? new Date().toISOString(),
      ...item,
    } as RuleReviewItem;
    this.ensureFile();
    appendFileSync(this.filePath, JSON.stringify(full) + "\n", "utf8");
    return full;
  }

  /** List all items, optionally filtered by status. */
  list(status?: ReviewStatus): RuleReviewItem[] {
    const items = this.readAll();
    return status ? items.filter((i) => i.status === status) : items;
  }

  /** Approve a pending item. Returns the updated item, or null if not found. */
  approve(ruleId: string, note?: string): RuleReviewItem | null {
    return this.decide(ruleId, "approved", note);
  }

  /** Reject a pending item. Returns the updated item, or null if not found. */
  reject(ruleId: string, note?: string): RuleReviewItem | null {
    return this.decide(ruleId, "rejected", note);
  }

  /** Number of pending items — surfaced for monitoring/alerting. */
  pendingCount(): number {
    return this.list("pending").length;
  }

  private decide(ruleId: string, status: "approved" | "rejected", note?: string): RuleReviewItem | null {
    const items = this.readAll();
    const idx = items.findIndex((i) => i.rule_id === ruleId);
    if (idx === -1) return null;
    items[idx] = {
      ...items[idx],
      status,
      decided_at: new Date().toISOString(),
      decision_note: note,
    };
    this.writeAll(items);
    return items[idx];
  }

  private ensureFile(): void {
    if (!existsSync(this.filePath)) {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, "", "utf8");
    }
  }

  private readAll(): RuleReviewItem[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, "utf8").trim();
    if (!raw) return [];
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as RuleReviewItem;
        } catch {
          return null;
        }
      })
      .filter((x): x is RuleReviewItem => x !== null);
  }

  private writeAll(items: RuleReviewItem[]): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, items.map((i) => JSON.stringify(i)).join("\n") + (items.length ? "\n" : ""), "utf8");
  }
}
