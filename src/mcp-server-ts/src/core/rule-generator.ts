/**
 * Rule generation from patterns.
 *
 * Converts validated patterns into structured rules.
 */

import { Pattern, RuleIndexEntry, RuleContent, Scene } from "./models.js";
import { RuleClassifier } from "./classifier.js";

export class RuleGenerator {
  private classifier: RuleClassifier;

  constructor() {
    this.classifier = new RuleClassifier();
  }

  generateRule(
    pattern: Pattern,
    ruleId: string,
    scene?: Scene
  ): { indexEntry: RuleIndexEntry; content: RuleContent } {
    // Determine priority
    const priority = this.classifier.determinePriority(pattern);

    // Generate rule content
    const content = this.generateContent(pattern);
    const reason = this.generateReason(pattern);

    // Create timestamp
    const now = new Date().toISOString();

    // Create index entry
    const indexEntry: RuleIndexEntry = {
      id: ruleId,
      type: pattern.type,
      priority,
      confidence: pattern.confidence,
      scenes: scene || { tech: [], functional: [], business: [] },
      keywords: pattern.keywords,
      created_at: now,
      updated_at: now
    };

    // Create content
    const ruleContent: RuleContent = {
      id: ruleId,
      content,
      reason,
      metadata: {
        type: pattern.type,
        priority,
        confidence: pattern.confidence,
        source: "learned",
        pattern_occurrences: pattern.occurrences.length,
        first_seen: pattern.first_seen,
        last_seen: pattern.last_seen,
        keywords: pattern.keywords
      }
    };

    return { indexEntry, content: ruleContent };
  }

  batchGenerateRules(
    patterns: Pattern[],
    startId: number,
    scene?: Scene
  ): Array<{ indexEntry: RuleIndexEntry; content: RuleContent }> {
    const rules: Array<{ indexEntry: RuleIndexEntry; content: RuleContent }> = [];

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const ruleId = `rule-${String(startId + i).padStart(3, "0")}`;

      // Check if should generate rule
      const { shouldGenerate } = this.classifier.shouldGenerateRule(pattern);
      if (!shouldGenerate) {
        continue;
      }

      const rule = this.generateRule(pattern, ruleId, scene);
      rules.push(rule);
    }

    return rules;
  }

  private generateContent(pattern: Pattern): string {
    // Pattern description already in rule format
    let content = pattern.description;

    // Add context if available from occurrences
    const contexts = new Set<string>();
    for (const occurrence of pattern.occurrences) {
      if (occurrence.context && occurrence.context.includes("/")) {
        const parts = occurrence.context.split("/");
        if (parts.length > 1) {
          contexts.add(parts[parts.length - 1]);
        }
      }
    }

    if (contexts.size > 0) {
      const contextStr = Array.from(contexts)
        .slice(0, 3)
        .sort()
        .join(", ");
      content += `\n\n**Applies to**: ${contextStr}`;
    }

    return content;
  }

  private generateReason(pattern: Pattern): string {
    const reasons: string[] = [];

    // Count occurrences
    const occurrenceCount = pattern.occurrences.length;
    const uniqueSessions = new Set(pattern.occurrences.map(o => o.session_id)).size;

    if (uniqueSessions > 1) {
      reasons.push(`Corrected ${occurrenceCount} times across ${uniqueSessions} sessions`);
    } else {
      reasons.push(`Corrected ${occurrenceCount} times in one session`);
    }

    // Add validation evidence
    const testPassed = pattern.occurrences.filter(o => o.test_passed === true).length;
    if (testPassed > 0) {
      reasons.push(`validated by ${testPassed} test(s)`);
    }

    const perfImproved = pattern.occurrences.filter(o => o.performance_improved === true)
      .length;
    if (perfImproved > 0) {
      reasons.push("improved performance");
    }

    const securityIssues = pattern.occurrences.filter(o => o.security_issue).length;
    if (securityIssues > 0) {
      reasons.push(`fixed ${securityIssues} security issue(s)`);
    }

    // Add user preference indication
    if (pattern.keywords.length > 0) {
      const keywordStr = pattern.keywords.slice(0, 3).join(", ");
      reasons.push(`keywords: ${keywordStr}`);
    }

    return reasons.join("; ");
  }
}
