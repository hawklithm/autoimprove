/**
 * Keyword Segment Index
 *
 * Provides fuzzy keyword matching by splitting camelCase/snake_case tokens
 * and building a reverse index (segment → rule IDs).
 *
 * Inspired by CodeGraph's name_segment_vocab table.
 */

import { RuleIndexEntry } from "./models.js";

export class KeywordSegmentIndex {
  private segmentMap: Map<string, Set<string>>; // segment → rule IDs
  private segmentFreq: Map<string, number>; // segment → document frequency
  private totalRules: number = 0;
  private initialized: boolean = false;

  constructor() {
    this.segmentMap = new Map();
    this.segmentFreq = new Map();
  }

  /**
   * Build index from rules
   */
  build(rules: RuleIndexEntry[]): void {
    this.segmentMap.clear();
    this.segmentFreq.clear();
    this.totalRules = rules.length;

    for (const rule of rules) {
      const tokens = this.extractTokens(rule);
      const ruleSegments = new Set<string>(); // Track unique segments per rule

      for (const token of tokens) {
        const segments = this.splitToken(token);

        for (const segment of segments) {
          const normalized = segment.toLowerCase();

          // Skip very short or common segments
          if (normalized.length < 2 || this.isStopWord(normalized)) {
            continue;
          }

          if (!this.segmentMap.has(normalized)) {
            this.segmentMap.set(normalized, new Set());
          }
          this.segmentMap.get(normalized)!.add(rule.id);

          // Track segment frequency (document frequency, not term frequency)
          ruleSegments.add(normalized);
        }
      }

      // Update segment frequencies
      for (const segment of ruleSegments) {
        this.segmentFreq.set(segment, (this.segmentFreq.get(segment) || 0) + 1);
      }
    }

    this.initialized = true;
  }

  /**
   * Search for rules matching query tokens
   *
   * @returns Set of rule IDs that match any segment
   */
  search(query: string): Set<string> {
    if (!this.initialized) {
      return new Set();
    }

    const segments = this.splitToken(query);
    const candidateRules = new Set<string>();

    for (const segment of segments) {
      const normalized = segment.toLowerCase();

      // Exact match
      const exactMatches = this.segmentMap.get(normalized);
      if (exactMatches) {
        exactMatches.forEach(ruleId => candidateRules.add(ruleId));
      }

      // Prefix match (for partial input like "auth" matching "authentication")
      for (const [indexSegment, ruleIds] of this.segmentMap.entries()) {
        if (indexSegment.startsWith(normalized) || normalized.startsWith(indexSegment)) {
          ruleIds.forEach(ruleId => candidateRules.add(ruleId));
        }
      }
    }

    return candidateRules;
  }

  /**
   * Extract searchable tokens from a rule
   */
  private extractTokens(rule: RuleIndexEntry): string[] {
    const tokens: string[] = [];

    // From keywords
    tokens.push(...rule.keywords);

    // From rule ID (rule-sql-injection → ["sql", "injection"])
    tokens.push(...rule.id.split('-').filter(s => s !== 'rule'));

    // From scenes
    if (rule.scenes) {
      tokens.push(...rule.scenes.tech);
      tokens.push(...rule.scenes.functional);
      tokens.push(...rule.scenes.business);
    }

    return tokens.filter(t => t && t.length > 0);
  }

  /**
   * Split token into segments
   *
   * Handles:
   * - camelCase: "getUserData" → ["get", "User", "Data"]
   * - snake_case: "user_auth" → ["user", "auth"]
   * - kebab-case: "sql-injection" → ["sql", "injection"]
   * - spaces: "SQL injection" → ["SQL", "injection"]
   */
  private splitToken(text: string): string[] {
    const segments: string[] = [];

    // Split by non-alphanumeric characters
    const words = text.split(/[_\-\s]+/);

    for (const word of words) {
      // Split camelCase: "getUserData" → ["get", "User", "Data"]
      const camelSegments = word.split(/(?=[A-Z])/).filter(s => s.length > 0);
      segments.push(...camelSegments);
    }

    return segments;
  }

  /**
   * Check if a segment is a common stop word
   */
  private isStopWord(segment: string): boolean {
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were',
      'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'and', 'or', 'but', 'not', 'be', 'do', 'it'
    ]);

    return stopWords.has(segment);
  }

  /**
   * Get IDF (Inverse Document Frequency) for a segment
   *
   * IDF measures term rarity: rare terms get higher scores.
   * Formula: log(totalRules / (segmentFreq + 1))
   *
   * @returns IDF score (higher = rarer/more discriminative)
   */
  getIDF(segment: string): number {
    if (!this.initialized || this.totalRules === 0) {
      return 0;
    }

    const normalized = segment.toLowerCase();
    const freq = this.segmentFreq.get(normalized) || 0;

    // Add 1 to avoid division by zero and smooth the calculation
    return Math.log(this.totalRules / (freq + 1));
  }

  /**
   * Get document frequency for a segment (how many rules contain it)
   */
  getDocumentFrequency(segment: string): number {
    const normalized = segment.toLowerCase();
    return this.segmentFreq.get(normalized) || 0;
  }

  /**
   * Get statistics about the index
   */
  getStats() {
    return {
      total_segments: this.segmentMap.size,
      total_rules: this.totalRules,
      initialized: this.initialized
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.segmentMap.clear();
    this.segmentFreq.clear();
    this.totalRules = 0;
    this.initialized = false;
  }
}
