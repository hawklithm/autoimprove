/**
 * Keyword detection for AutoImprove patterns.
 *
 * Detects relevant keywords in pattern descriptions and user input.
 */

import { Pattern, PatternType } from "./models.js";

// Keyword lists by pattern type
const PREFERENCE_KEYWORDS = [
  "我们团队",
  "团队习惯",
  "我更喜欢",
  "我们约定",
  "we prefer",
  "our team",
  "we use",
  "convention",
  "约定",
  "规范",
  "standard",
  "guideline"
];

const PERFORMANCE_KEYWORDS = [
  "useMemo",
  "useCallback",
  "React.memo",
  "重渲染",
  "性能",
  "optimize",
  "performance",
  "slow",
  "lag",
  "卡顿",
  "优化",
  "cache",
  "memoize",
  "debounce",
  "throttle"
];

const SECURITY_KEYWORDS = [
  "sql injection",
  "xss",
  "csrf",
  "injection",
  "注入",
  "安全",
  "security",
  "vulnerability",
  "sanitize",
  "escape",
  "validate",
  "attack",
  "exploit",
  "漏洞",
  "breach",
  "unauthorized"
];

export class KeywordDetector {
  private keywordLists: Map<PatternType, string[]>;

  constructor() {
    this.keywordLists = new Map([
      [PatternType.PREFERENCE, PREFERENCE_KEYWORDS],
      [PatternType.PERFORMANCE, PERFORMANCE_KEYWORDS],
      [PatternType.SECURITY, SECURITY_KEYWORDS],
      [PatternType.REPEATED_CORRECTION, []],
      [PatternType.ANTI_PATTERN, []]
    ]);
  }

  detectKeywords(pattern: Pattern): string[] {
    const keywords = this.keywordLists.get(pattern.type) || [];

    if (keywords.length === 0) {
      return [];
    }

    const foundKeywords = new Set<string>();

    // Check description
    const descriptionLower = pattern.description.toLowerCase();
    for (const keyword of keywords) {
      if (descriptionLower.includes(keyword.toLowerCase())) {
        foundKeywords.add(keyword);
      }
    }

    // Check user input in occurrences
    for (const occurrence of pattern.occurrences) {
      if (occurrence.user_input) {
        const inputLower = occurrence.user_input.toLowerCase();
        for (const keyword of keywords) {
          if (inputLower.includes(keyword.toLowerCase())) {
            foundKeywords.add(keyword);
          }
        }
      }
    }

    return Array.from(foundKeywords);
  }

  hasKeywords(pattern: Pattern): boolean {
    return this.detectKeywords(pattern).length > 0;
  }

  addKeywords(patternType: PatternType, keywords: string[]): void {
    const existing = this.keywordLists.get(patternType) || [];
    this.keywordLists.set(patternType, [...existing, ...keywords]);
  }

  getKeywordsForType(patternType: PatternType): string[] {
    return this.keywordLists.get(patternType) || [];
  }
}
