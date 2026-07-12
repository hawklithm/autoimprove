/**
 * PreFilter — lightweight pre-screening to reduce token/compute cost before detectors run.
 *
 * Goal: drop LOW-INFORMATION content (small talk, repeated acks, no tool/code context),
 * NOT to pre-judge patterns. Pattern detection stays with the detectors to avoid recall loss.
 *
 * Modes:
 *  - "heuristic" (default, zero cost): rule-based filtering, no LLM.
 *  - "haiku" / "local-llm": optional richer scoring (implemented in B3), fall back to heuristic.
 */

import { Message } from "./extractors/session-extractor.interface.js";
import { logger } from "./logger.js";
import { loadConfig } from "../storage/init.js";

export type PreFilterMode = "heuristic" | "haiku" | "local-llm";

export interface PreFilterConfig {
  enabled: boolean;
  mode: PreFilterMode;
}

export interface FilterResult {
  /** Messages kept for downstream detectors. */
  kept: Message[];
  /** Count of dropped messages. */
  droppedCount: number;
  /** Reason -> count, for observability. */
  reason: Record<string, number>;
  /** G1: input message count (for kept-rate metric). */
  inputCount: number;
  /** G1: fraction of input kept (1 - drop rate). */
  keptRate: number;
}

// Short acknowledgements / pure small talk that carry no signal.
const ACK_PATTERNS: RegExp[] = [
  /^(ok|okay|好的|好|嗯|对|是的|yes|yeah|yep|👍|ok!|fine|sure|got it|noted)\.?\s*$/i,
];

// Signals that the message is information-rich (keep regardless of length).
const SIGNAL_HINTS: RegExp[] = [
  /```/,                       // code fence
  /`[^`]+`/,                   // inline code
  /\b(function|class|import|export|const|let|var|def|public|private|async|await)\b/, // code keywords
  /\/(?:[\w.-]+\/)*[\w.-]+\.\w{1,6}/, // file path
  /(fix|bug|error|wrong|incorrect|应该|不对|改成|修正|错误|问题|prefer|convention|约定|规范|optimize|性能|security|安全)/i, // correction/preference hints
];

export class PreFilter {
  private enabled: boolean;
  private mode: PreFilterMode;

  constructor(config?: PreFilterConfig) {
    const cfg = config ?? loadConfig().local_ml?.prefilter ?? { enabled: false, mode: "heuristic" };
    this.enabled = cfg.enabled;
    this.mode = cfg.mode;
  }

  /**
   * Filter a list of user messages. When disabled, returns all messages unchanged.
   */
  filter(messages: Message[]): FilterResult {
    if (!this.enabled) {
      return { kept: messages, droppedCount: 0, reason: {}, inputCount: messages.length, keptRate: 1 };
    }

    const reason: Record<string, number> = {};
    const kept: Message[] = [];

    let prevKept: Message | null = null;

    for (const msg of messages) {
      const drop = this.classify(msg, prevKept, reason);
      if (drop) {
        continue;
      }
      kept.push(msg);
      prevKept = msg;
    }

    const droppedCount = messages.length - kept.length;
    if (droppedCount > 0) {
      logger.debug("pre-filter", `Dropped ${droppedCount} low-information message(s): ${JSON.stringify(reason)}`);
    }
    return {
      kept,
      droppedCount,
      reason,
      inputCount: messages.length,
      keptRate: messages.length > 0 ? kept.length / messages.length : 1,
    };
  }

  /**
   * Returns a reason string if the message should be dropped, else null.
   */
  private classify(msg: Message, prevKept: Message | null, reason: Record<string, number>): boolean {
    const content = (msg.content || "").trim();

    // Keep anything with code/tool/technical signal.
    if (SIGNAL_HINTS.some(re => re.test(content))) {
      return false;
    }

    // Drop pure acknowledgements / small talk.
    if (ACK_PATTERNS.some(re => re.test(content))) {
      reason["ack"] = (reason["ack"] || 0) + 1;
      return true;
    }

    // Drop very short messages with no signal (e.g. single chars / filler).
    if (content.length <= 2) {
      reason["too_short"] = (reason["too_short"] || 0) + 1;
      return true;
    }

    // Drop near-duplicate of the previous kept message (>90% char-overlap similarity).
    if (prevKept && this.similarity(content, prevKept.content) > 0.9) {
      reason["duplicate"] = (reason["duplicate"] || 0) + 1;
      return true;
    }

    return false;
  }

  /**
   * Character-level Jaccard similarity (self-contained; message-clusterer's
   * cosineSimilarity is private and not reusable here).
   */
  private similarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(""));
    const setB = new Set(b.toLowerCase().split(""));
    if (setA.size === 0 || setB.size === 0) return 0;
    let inter = 0;
    for (const ch of setA) if (setB.has(ch)) inter++;
    const union = setA.size + setB.size - inter;
    return union === 0 ? 0 : inter / union;
  }
}
