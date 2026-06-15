/**
 * LLM-based signal extractor for discovering new signals from unmatched content
 */

import Anthropic from "@anthropic-ai/sdk";
import { SignalDictionaryDB, SignalEntry } from "../storage/signal-dictionary-db.js";

export interface ExtractedSignal {
  text: string;
  pattern_type: "correction" | "anti-pattern" | "preference" | "performance" | "security";
  polarity: "positive" | "negative" | "neutral";
  confidence: number;
  context: string;
  example_usage: string;
  language: "zh" | "en" | "mixed";
}

export interface ExtractionResult {
  signals: ExtractedSignal[];
  total_content_analyzed: number;
  new_signals_added: number;
  duplicate_signals_skipped: number;
}

export class LLMSignalExtractor {
  private db: SignalDictionaryDB;
  private anthropic: Anthropic;

  constructor() {
    this.db = new SignalDictionaryDB();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required");
    }

    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Extract signals from unmatched content using LLM
   */
  async extractSignals(unmatchedContent: string[]): Promise<ExtractionResult> {
    if (unmatchedContent.length === 0) {
      return {
        signals: [],
        total_content_analyzed: 0,
        new_signals_added: 0,
        duplicate_signals_skipped: 0
      };
    }

    // Optimize: Batch content for efficiency (max 15 items per LLM call, reduced from 20)
    const batchSize = 15;
    const batches: string[][] = [];

    for (let i = 0; i < unmatchedContent.length; i += batchSize) {
      batches.push(unmatchedContent.slice(i, i + batchSize));
    }

    const allExtracted: ExtractedSignal[] = [];

    for (const batch of batches) {
      const extracted = await this.extractFromBatch(batch);
      allExtracted.push(...extracted);
    }

    // Validate and add to dictionary
    let newSignalsAdded = 0;
    let duplicatesSkipped = 0;

    for (const signal of allExtracted) {
      if (this.validateSignal(signal)) {
        const existing = this.db.getSignalByText(signal.text);

        if (existing) {
          duplicatesSkipped++;
          console.error(`Signal already exists: "${signal.text}"`);
        } else {
          this.addSignalToDictionary(signal);
          newSignalsAdded++;
          console.error(`Added new signal: "${signal.text}" (${signal.pattern_type}, confidence: ${signal.confidence})`);
        }
      } else {
        console.error(`Invalid signal rejected: "${signal.text}"`);
      }
    }

    return {
      signals: allExtracted,
      total_content_analyzed: unmatchedContent.length,
      new_signals_added: newSignalsAdded,
      duplicate_signals_skipped: duplicatesSkipped
    };
  }

  /**
   * Extract signals from a batch of content
   */
  private async extractFromBatch(content: string[]): Promise<ExtractedSignal[]> {
    const prompt = this.buildExtractionPrompt(content);

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500, // Reduced from 2000
        messages: [{
          role: "user",
          content: prompt
        }]
      });

      const responseText = response.content[0].type === "text" ? response.content[0].text : "";
      return this.parseExtractionResponse(responseText);
    } catch (error) {
      console.error("LLM signal extraction failed:", error);
      return [];
    }
  }

  /**
   * Build extraction prompt (optimized for token efficiency)
   */
  private buildExtractionPrompt(content: string[]): string {
    // Truncate long messages to save tokens
    const truncatedContent = content.map(c =>
      c.length > 150 ? c.slice(0, 150) + '...' : c
    );

    return `Extract correction/preference signals from messages.

Task: Find SHORT signal words/phrases (2-50 chars) indicating:
1. Corrections: mistakes pointed out ("不对", "should", "fix")
2. Preferences: team choices ("我们用", "prefer")
3. Anti-patterns: bad approaches ("bug", "错误")
4. Performance: optimization ("优化", "useMemo")
5. Security: concerns ("注入", "xss")

Messages:
${truncatedContent.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Output JSON:
{"signals":[{"text":"应该用","pattern_type":"correction","polarity":"positive","confidence":0.7,"context":"Better approach","example_usage":"应该用X而不是Y","language":"zh"}]}

Requirements:
- Extract SHORT signals only (not full sentences)
- Confidence: 0.5-0.8 for new signals
- Return [] if no clear signals
- Be selective, quality over quantity`;
  }

  /**
   * Parse LLM response
   */
  private parseExtractionResponse(response: string): ExtractedSignal[] {
    try {
      // Extract JSON from markdown code block if present
      let jsonStr = response.trim();
      const jsonMatch = jsonStr.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr);

      if (!parsed.signals || !Array.isArray(parsed.signals)) {
        console.error("Invalid response format: missing signals array");
        return [];
      }

      return parsed.signals.filter((s: any) =>
        s.text && s.pattern_type && s.polarity && s.confidence !== undefined
      );
    } catch (error) {
      console.error("Failed to parse LLM response:", error);
      console.error("Response was:", response);
      return [];
    }
  }

  /**
   * Validate extracted signal
   */
  private validateSignal(signal: ExtractedSignal): boolean {
    // Check text length
    if (signal.text.length < 2 || signal.text.length > 50) {
      return false;
    }

    // Check confidence range
    if (signal.confidence < 0.5 || signal.confidence > 0.8) {
      return false;
    }

    // Check required fields
    if (!signal.pattern_type || !signal.polarity || !signal.language) {
      return false;
    }

    // Check for meaningful content (not just spaces/punctuation)
    if (!/[\w一-龥]/.test(signal.text)) {
      return false;
    }

    // Check for overly generic signals
    const genericPatterns = [
      /^(is|are|the|a|an|this|that|these|those)$/i,
      /^[.,!?;:]$/,
      /^[\d\s]+$/
    ];

    for (const pattern of genericPatterns) {
      if (pattern.test(signal.text.trim())) {
        return false;
      }
    }

    return true;
  }

  /**
   * Add validated signal to dictionary
   */
  private addSignalToDictionary(signal: ExtractedSignal) {
    const now = new Date().toISOString();

    const entry: Omit<SignalEntry, "id"> = {
      text: signal.text,
      language: signal.language,
      pattern_type: signal.pattern_type,
      polarity: signal.polarity,
      confidence: signal.confidence,
      typical_context: signal.example_usage ? [signal.example_usage] : [],
      related_signals: [],
      match_count: 0,
      true_positive: 0,
      false_positive: 0,
      first_seen: now,
      last_seen: now,
      source: "llm_extracted",
      created_at: now,
      updated_at: now
    };

    this.db.addSignal(entry);
  }

  /**
   * Extract signals from a specific session's unmatched messages
   */
  async extractFromSession(
    sessionMessages: Array<{ id: string; content: string; isMatched: boolean }>
  ): Promise<ExtractionResult> {
    const unmatched = sessionMessages
      .filter(msg => !msg.isMatched)
      .map(msg => msg.content);

    if (unmatched.length === 0) {
      console.error("No unmatched content to extract signals from");
      return {
        signals: [],
        total_content_analyzed: 0,
        new_signals_added: 0,
        duplicate_signals_skipped: 0
      };
    }

    console.error(`Extracting signals from ${unmatched.length} unmatched messages`);
    return await this.extractSignals(unmatched);
  }

  /**
   * Merge similar signals to avoid duplication
   */
  async mergeSimilarSignals(threshold: number = 0.8): Promise<number> {
    const signals = this.db.getAllSignals();
    const merged: Set<number> = new Set();
    let mergeCount = 0;

    for (let i = 0; i < signals.length; i++) {
      if (merged.has(i)) continue;

      const signal1 = signals[i];
      if (!signal1.id) continue;

      for (let j = i + 1; j < signals.length; j++) {
        if (merged.has(j)) continue;

        const signal2 = signals[j];
        if (!signal2.id) continue;

        // Check if signals are similar
        const similarity = this.calculateSimilarity(signal1.text, signal2.text);

        if (similarity > threshold && signal1.pattern_type === signal2.pattern_type) {
          // Merge signal2 into signal1
          const avgConfidence = (signal1.confidence + signal2.confidence) / 2;

          // Update signal1 with merged stats
          this.db.updateSignalConfidence(signal1.id, avgConfidence, "co_occurrence", {
            merged_from: signal2.id,
            similarity
          });

          // TODO: Delete signal2 or mark as merged
          merged.add(j);
          mergeCount++;

          console.error(`Merged "${signal2.text}" into "${signal1.text}" (similarity: ${similarity.toFixed(2)})`);
        }
      }
    }

    return mergeCount;
  }

  /**
   * Calculate text similarity (Levenshtein distance based)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const len1 = text1.length;
    const len2 = text2.length;

    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;

    // Simple character overlap ratio
    const set1 = new Set(text1.toLowerCase().split(''));
    const set2 = new Set(text2.toLowerCase().split(''));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  close() {
    this.db.close();
  }
}
