/**
 * PatternSemanticClassifier — Phase 1 / P1 (optional LLM classification)
 *
 * A lightweight semantic classifier that labels a piece of text as one of
 * "code" | "business" | "general". It is intended as an *enhancement* on top of
 * the cheap `PatternContentFilter` heuristic: when the heuristic is confident
 * (clear code or clear business signal) we trust it; only when it is uncertain
 * do we optionally consult an LLM.
 *
 * The LLM call is fully optional and guarded behind a caller-supplied
 * `classifyFn`. When no LLM is configured (the common case in tests/CI) the
 * classifier falls back to the heuristic, so it is always safe and never throws.
 */

import { PatternContentFilter, ContentFilterResult } from "./pattern-content-filter.js";

export type SemanticCategory = "code" | "business" | "general";

export interface SemanticClassification {
  category: SemanticCategory;
  confidence: number;
  reason: string;
  /** true when the verdict came from the LLM, false for heuristic fallback */
  usedLLM: boolean;
}

export interface PatternSemanticClassifierOptions {
  /** Heuristic confidence below this triggers the LLM path (when available). */
  heuristicConfidenceThreshold?: number;
  /**
   * Optional LLM hook. Receives the text and must resolve to a raw
   * `{ category, confidence, reason }`. Left undefined to disable LLM use.
   */
  classifyFn?: (text: string) => Promise<{ category: SemanticCategory; confidence: number; reason: string }>;
  /** Override the underlying heuristic filter (mainly for tests). */
  filter?: PatternContentFilter;
}

export class PatternSemanticClassifier {
  private readonly filter: PatternContentFilter;
  private readonly classifyFn?: PatternSemanticClassifierOptions["classifyFn"];
  private readonly heuristicConfidenceThreshold: number;

  constructor(options: PatternSemanticClassifierOptions = {}) {
    this.filter = options.filter ?? new PatternContentFilter();
    this.classifyFn = options.classifyFn;
    this.heuristicConfidenceThreshold = options.heuristicConfidenceThreshold ?? 0.6;
  }

  async classify(text: string): Promise<SemanticClassification> {
    const heuristic = this.heuristicVerdict(text);

    // If we have a confident heuristic verdict there is no need to spend an LLM call.
    if (heuristic.confidence >= this.heuristicConfidenceThreshold) {
      return { ...heuristic, usedLLM: false };
    }

    // Uncertain heuristic → consult LLM if configured.
    if (this.classifyFn) {
      try {
        const llm = await this.classifyFn(text);
        if (llm && ["code", "business", "general"].includes(llm.category)) {
          return {
            category: llm.category,
            confidence: Math.max(0, Math.min(1, llm.confidence)),
            reason: `llm: ${llm.reason}`,
            usedLLM: true,
          };
        }
      } catch {
        // LLM failure → degrade gracefully to the heuristic verdict.
        return { ...heuristic, usedLLM: false };
      }
    }

    return { ...heuristic, usedLLM: false };
  }

  /**
   * Map the heuristic filter result to a semantic classification. Confidence is
   * high when the signal is unambiguous, low when it is "general"/mixed.
   */
  private heuristicVerdict(text: string): { category: SemanticCategory; confidence: number; reason: string } {
    const r: ContentFilterResult = this.filter.isCodeRelated(text);
    switch (r.category) {
      case "code":
        return { category: "code", confidence: 0.9, reason: `heuristic: ${r.reason}` };
      case "business":
        return { category: "business", confidence: 0.9, reason: `heuristic: ${r.reason}` };
      case "mixed":
        // Present in both axes but code-relevant → moderate confidence.
        return { category: "code", confidence: 0.5, reason: `heuristic: ${r.reason}` };
      case "general":
      default:
        return { category: "general", confidence: 0.4, reason: `heuristic: ${r.reason}` };
    }
  }
}
