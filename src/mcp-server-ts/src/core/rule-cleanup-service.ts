/**
 * Rule Cleanup Service - Maintenance tool for existing rules
 *
 * Features:
 * 1. Scan for duplicate/similar rules in existing database
 * 2. Assess rule quality based on multiple criteria
 * 3. Merge duplicate rules
 * 4. Optimize low-quality rules
 */

import { RuleIndexEntry, RuleContent } from "./models.js";
import { RuleDeduplicator, SimilarityResult } from "./rule-deduplicator.js";

export interface QualityAssessment {
  ruleId: string;
  overallScore: number; // 0.0-1.0
  issues: QualityIssue[];
  recommendations: string[];
}

export interface QualityIssue {
  type: "low-keywords" | "missing-scene" | "weak-description" | "low-confidence" | "unused";
  severity: "critical" | "high" | "medium" | "low";
  description: string;
}

export interface DuplicateGroup {
  primaryRule: RuleIndexEntry;
  duplicates: Array<{
    rule: RuleIndexEntry;
    similarity: number;
    reason: string;
  }>;
}

export interface CleanupReport {
  totalRules: number;
  duplicateGroups: DuplicateGroup[];
  lowQualityRules: QualityAssessment[];
  recommendations: {
    mergeCandidates: number;
    optimizeCandidates: number;
    deleteCandidates: number;
  };
}

export interface CleanupResult {
  success: boolean;
  mergedCount: number;
  optimizedCount: number;
  deletedCount: number;
  errors: string[];
  details: {
    merged: Array<{ from: string[]; to: string }>;
    optimized: string[];
    deleted: string[];
  };
}

export class RuleCleanupService {
  private deduplicator: RuleDeduplicator;

  // Quality thresholds
  private readonly MIN_KEYWORDS = 2;
  private readonly MIN_DESCRIPTION_LENGTH = 30;
  private readonly MIN_CONFIDENCE = 0.5;
  private readonly DUPLICATE_SIMILARITY_THRESHOLD = 0.75;

  constructor() {
    this.deduplicator = new RuleDeduplicator();
  }

  /**
   * Scan existing rules for duplicates and quality issues
   */
  scanExistingRules(
    rules: RuleIndexEntry[],
    contents: Map<string, RuleContent>
  ): CleanupReport {
    const duplicateGroups = this.findDuplicateGroups(rules);
    const lowQualityRules = this.assessAllRules(rules, contents);

    const mergeCandidates = duplicateGroups.reduce(
      (sum, group) => sum + group.duplicates.length,
      0
    );

    const optimizeCandidates = lowQualityRules.filter(
      (qa) => qa.overallScore < 0.7 && qa.overallScore >= 0.4
    ).length;

    const deleteCandidates = lowQualityRules.filter(
      (qa) => qa.overallScore < 0.4
    ).length;

    return {
      totalRules: rules.length,
      duplicateGroups,
      lowQualityRules: lowQualityRules.filter((qa) => qa.overallScore < 0.7),
      recommendations: {
        mergeCandidates,
        optimizeCandidates,
        deleteCandidates,
      },
    };
  }

  /**
   * Find groups of duplicate rules
   */
  private findDuplicateGroups(rules: RuleIndexEntry[]): DuplicateGroup[] {
    const groups: DuplicateGroup[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < rules.length; i++) {
      if (processed.has(rules[i].id)) continue;

      const primary = rules[i];
      const duplicates: Array<{
        rule: RuleIndexEntry;
        similarity: number;
        reason: string;
      }> = [];

      // Find similar rules
      const remainingRules = rules.slice(i + 1).filter((r) => !processed.has(r.id));
      const similarities = this.deduplicator.findSimilarRules(primary, remainingRules);

      for (const sim of similarities) {
        if (sim.similarity >= this.DUPLICATE_SIMILARITY_THRESHOLD) {
          duplicates.push({
            rule: sim.existingRule,
            similarity: sim.similarity,
            reason: sim.reason,
          });
          processed.add(sim.existingRule.id);
        }
      }

      if (duplicates.length > 0) {
        groups.push({ primaryRule: primary, duplicates });
        processed.add(primary.id);
      }
    }

    return groups;
  }

  /**
   * Assess quality of all rules
   */
  private assessAllRules(
    rules: RuleIndexEntry[],
    contents: Map<string, RuleContent>
  ): QualityAssessment[] {
    return rules.map((rule) => this.assessRuleQuality(rule, contents.get(rule.id)));
  }

  /**
   * Assess quality of a single rule
   */
  assessRuleQuality(
    rule: RuleIndexEntry,
    content?: RuleContent
  ): QualityAssessment {
    const issues: QualityIssue[] = [];
    let score = 1.0;

    // Check keywords
    if (rule.keywords.length < this.MIN_KEYWORDS) {
      issues.push({
        type: "low-keywords",
        severity: "medium",
        description: `Only ${rule.keywords.length} keyword(s), should have at least ${this.MIN_KEYWORDS}`,
      });
      score -= 0.15;
    }

    // Check scene completeness
    const hasScene =
      rule.scenes.tech.length > 0 || rule.scenes.functional.length > 0;
    if (!hasScene) {
      issues.push({
        type: "missing-scene",
        severity: "high",
        description: "No tech or functional scene specified",
      });
      score -= 0.25;
    }

    // Check description quality
    if (content) {
      const descLength = (content.description || content.content || "").length;
      if (descLength < this.MIN_DESCRIPTION_LENGTH) {
        issues.push({
          type: "weak-description",
          severity: "medium",
          description: `Description too short (${descLength} chars)`,
        });
        score -= 0.2;
      }
    }

    // Check confidence
    if (rule.confidence < this.MIN_CONFIDENCE) {
      issues.push({
        type: "low-confidence",
        severity: "high",
        description: `Low confidence score: ${rule.confidence.toFixed(2)}`,
      });
      score -= 0.3;
    }

    score = Math.max(0, score);

    const recommendations = this.generateRecommendations(issues, rule);

    return {
      ruleId: rule.id,
      overallScore: score,
      issues,
      recommendations,
    };
  }

  /**
   * Generate recommendations based on issues
   */
  private generateRecommendations(
    issues: QualityIssue[],
    rule: RuleIndexEntry
  ): string[] {
    const recommendations: string[] = [];

    for (const issue of issues) {
      switch (issue.type) {
        case "low-keywords":
          recommendations.push(
            "Extract more keywords from rule description and examples"
          );
          break;
        case "missing-scene":
          recommendations.push(
            "Infer tech/functional scene from keywords and content"
          );
          break;
        case "weak-description":
          recommendations.push(
            "Use LLM to generate detailed, structured description"
          );
          break;
        case "low-confidence":
          recommendations.push(
            "Merge with similar high-confidence rule or gather more examples"
          );
          break;
        case "unused":
          recommendations.push("Consider archiving if never used in 30+ days");
          break;
      }
    }

    return recommendations;
  }

  /**
   * Optimize low-quality rule
   */
  optimizeRule(
    rule: RuleIndexEntry,
    content: RuleContent | undefined
  ): { indexEntry: RuleIndexEntry; content?: RuleContent; changes: string[] } {
    const changes: string[] = [];
    let optimizedEntry = { ...rule };
    let optimizedContent = content ? { ...content } : undefined;

    // Optimization 1: Extract keywords from content
    if (rule.keywords.length < this.MIN_KEYWORDS && content) {
      const extractedKeywords = this.extractKeywordsFromContent(content);
      const newKeywords = Array.from(
        new Set([...rule.keywords, ...extractedKeywords])
      );

      if (newKeywords.length > rule.keywords.length) {
        optimizedEntry.keywords = newKeywords;
        changes.push(
          `Added ${newKeywords.length - rule.keywords.length} keywords from content`
        );
      }
    }

    // Optimization 2: Infer scenes from keywords
    const hasScene =
      rule.scenes.tech.length > 0 || rule.scenes.functional.length > 0;
    if (!hasScene) {
      const inferredScenes = this.inferScenesFromKeywords(rule.keywords);
      if (
        inferredScenes.tech.length > 0 ||
        inferredScenes.functional.length > 0
      ) {
        optimizedEntry.scenes = {
          tech: Array.from(
            new Set([...rule.scenes.tech, ...inferredScenes.tech])
          ),
          functional: Array.from(
            new Set([...rule.scenes.functional, ...inferredScenes.functional])
          ),
          business: rule.scenes.business,
        };
        changes.push(
          `Inferred scenes: tech=[${inferredScenes.tech.join(", ")}], functional=[${inferredScenes.functional.join(", ")}]`
        );
      }
    }

    // Optimization 3: Boost confidence if rule has good structure
    if (
      rule.confidence < 0.7 &&
      optimizedEntry.keywords.length >= 3 &&
      (optimizedEntry.scenes.tech.length > 0 ||
        optimizedEntry.scenes.functional.length > 0)
    ) {
      const boost = 0.1;
      optimizedEntry.confidence = Math.min(1.0, rule.confidence + boost);
      changes.push(
        `Boosted confidence from ${rule.confidence.toFixed(2)} to ${optimizedEntry.confidence.toFixed(2)}`
      );
    }

    // Update timestamp if changes were made
    if (changes.length > 0) {
      optimizedEntry.updated_at = new Date().toISOString();
    }

    return {
      indexEntry: optimizedEntry,
      content: optimizedContent,
      changes,
    };
  }

  /**
   * Extract keywords from rule content
   */
  private extractKeywordsFromContent(content: RuleContent): string[] {
    const text = (content.description || content.content || "").toLowerCase();
    const keywords: Set<string> = new Set();

    // Technical terms patterns
    const techPatterns = [
      /\b(react|vue|angular|typescript|javascript|python|java|go|rust)\b/g,
      /\b(api|database|sql|nosql|redis|mongodb|postgresql)\b/g,
      /\b(async|await|promise|callback|hook|memo|effect)\b/g,
      /\b(performance|optimization|cache|memory|speed)\b/g,
      /\b(security|auth|token|jwt|oauth|xss|csrf|injection)\b/g,
      /\b(test|testing|unit|integration|e2e|mock)\b/g,
      /\b(error|exception|validation|sanitize)\b/g,
    ];

    for (const pattern of techPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        keywords.add(match[1]);
      }
    }

    return Array.from(keywords).slice(0, 10); // Limit to 10
  }

  /**
   * Infer tech/functional scenes from keywords
   */
  private inferScenesFromKeywords(keywords: string[]): {
    tech: string[];
    functional: string[];
  } {
    const tech: Set<string> = new Set();
    const functional: Set<string> = new Set();

    // Tech stack mapping
    const techMap: Record<string, string> = {
      react: "react",
      vue: "vue",
      angular: "angular",
      typescript: "typescript",
      javascript: "javascript",
      python: "python",
      java: "java",
      go: "go",
      rust: "rust",
      node: "nodejs",
      express: "express",
      django: "django",
      flask: "flask",
    };

    // Functional domain mapping
    const functionalMap: Record<string, string> = {
      api: "api",
      rest: "api",
      graphql: "api",
      database: "database",
      sql: "database",
      nosql: "database",
      redis: "cache",
      cache: "cache",
      auth: "auth",
      authentication: "auth",
      authorization: "auth",
      token: "auth",
      jwt: "auth",
      oauth: "auth",
      test: "testing",
      testing: "testing",
      mock: "testing",
      validation: "validation",
      error: "error-handling",
      exception: "error-handling",
      performance: "performance",
      optimization: "performance",
      security: "security",
      xss: "security",
      csrf: "security",
      injection: "security",
    };

    for (const keyword of keywords) {
      const lower = keyword.toLowerCase();

      if (techMap[lower]) {
        tech.add(techMap[lower]);
      }

      if (functionalMap[lower]) {
        functional.add(functionalMap[lower]);
      }
    }

    return {
      tech: Array.from(tech),
      functional: Array.from(functional),
    };
  }

  /**
   * Execute cleanup plan
   */
  executeCleanup(
    duplicateGroups: DuplicateGroup[],
    lowQualityRules: QualityAssessment[],
    rules: RuleIndexEntry[],
    contents: Map<string, RuleContent>,
    options: {
      mergeDuplicates: boolean;
      optimizeLowQuality: boolean;
      deleteVeryLowQuality: boolean;
      veryLowQualityThreshold: number;
    }
  ): CleanupResult {
    const result: CleanupResult = {
      success: true,
      mergedCount: 0,
      optimizedCount: 0,
      deletedCount: 0,
      errors: [],
      details: {
        merged: [],
        optimized: [],
        deleted: [],
      },
    };

    try {
      // Step 1: Merge duplicates
      if (options.mergeDuplicates) {
        for (const group of duplicateGroups) {
          try {
            const duplicateIds = group.duplicates.map((d) => d.rule.id);
            result.details.merged.push({
              from: duplicateIds,
              to: group.primaryRule.id,
            });
            result.mergedCount += duplicateIds.length;
          } catch (error: any) {
            result.errors.push(
              `Failed to merge group ${group.primaryRule.id}: ${error.message}`
            );
          }
        }
      }

      // Step 2: Optimize low-quality rules
      if (options.optimizeLowQuality) {
        for (const qa of lowQualityRules) {
          if (
            qa.overallScore >= options.veryLowQualityThreshold &&
            qa.overallScore < 0.7
          ) {
            try {
              const rule = rules.find((r) => r.id === qa.ruleId);
              if (rule) {
                const content = contents.get(qa.ruleId);
                const optimized = this.optimizeRule(rule, content);

                if (optimized.changes.length > 0) {
                  result.details.optimized.push(qa.ruleId);
                  result.optimizedCount++;
                }
              }
            } catch (error: any) {
              result.errors.push(
                `Failed to optimize ${qa.ruleId}: ${error.message}`
              );
            }
          }
        }
      }

      // Step 3: Delete very low-quality rules
      if (options.deleteVeryLowQuality) {
        for (const qa of lowQualityRules) {
          if (qa.overallScore < options.veryLowQualityThreshold) {
            result.details.deleted.push(qa.ruleId);
            result.deletedCount++;
          }
        }
      }
    } catch (error: any) {
      result.success = false;
      result.errors.push(`Cleanup failed: ${error.message}`);
    }

    return result;
  }
}
