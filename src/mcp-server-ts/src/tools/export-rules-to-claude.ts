/**
 * Export rules to claude-index.md for automatic loading by Claude Code.
 *
 * This tool generates a curated markdown file containing high-value rules
 * that will be automatically loaded into every Claude Code session.
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RuleIndexManager } from "../storage/rule-index.js";
import { RuleContentManager } from "../storage/rule-content.js";
import { RuleIndexEntry } from "../core/models.js";

interface ExportOptions {
  strategy: "top-n" | "category-balanced";
  limit?: number;
  minConfidence?: number;
}

interface CategoryQuotas {
  security: number;
  "repeated-correction": number;
  "anti-pattern": number;
  performance: number;
  preference: number;
}

export class ClaudeIndexExporter {
  private indexManager: RuleIndexManager;
  private contentManager: RuleContentManager;

  constructor(indexManager: RuleIndexManager, contentManager: RuleContentManager) {
    this.indexManager = indexManager;
    this.contentManager = contentManager;
  }

  private getClaudeIndexPath(): string {
    const storageRoot = process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
    return join(storageRoot, "rules", "claude-index.md");
  }

  /**
   * Export rules to claude-index.md
   */
  export(options: ExportOptions): { path: string; rulesExported: number; tokenEstimate: number } {
    const { strategy, limit = 10, minConfidence = 0.6 } = options;

    let selectedRules: RuleIndexEntry[];

    if (strategy === "top-n") {
      selectedRules = this.selectTopN(limit, minConfidence);
    } else if (strategy === "category-balanced") {
      selectedRules = this.selectCategoryBalanced(limit, minConfidence);
    } else {
      throw new Error(`Unknown strategy: ${strategy}`);
    }

    const markdown = this.generateMarkdown(selectedRules);
    const path = this.getClaudeIndexPath();

    // Ensure directory exists
    const dir = join(path, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(path, markdown, "utf-8");

    // Estimate tokens (rough: ~4 chars per token)
    const tokenEstimate = Math.ceil(markdown.length / 4);

    return {
      path,
      rulesExported: selectedRules.length,
      tokenEstimate,
    };
  }

  /**
   * Selec rules by confidence
   */
  private selectTopN(limit: number, minConfidence: number): RuleIndexEntry[] {
    const allRules = this.indexManager.listRules({ minConfidence });

    // Sort by confidence (descending), then by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    allRules.sort((a, b) => {
      if (Math.abs(a.confidence - b.confidence) < 0.01) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return b.confidence - a.confidence;
    });

    return allRules.slice(0, limit);
  }

  /**
   * Select rules with category balance (recommended)
   */
  private selectCategoryBalanced(limit: number, minConfidence: number): RuleIndexEntry[] {
    const allRules = this.indexManager.listRules({ minConfidence });

    // Define quotas for each category
    const quotas: CategoryQuotas = {
      security: Math.ceil(limit * 0.3), // 30% security (critical)
      "repeated-correction": Math.ceil(limit * 0.3), // 30% repeated corrections
      "anti-pattern": Math.ceil(limit * 0.2), // 20% anti-patterns
      performance: Math.ceil(limit * 0.15), // 15% performance
      preference: Math.ceil(limit * 0.05), // 5% preferences
    };

    const selected: RuleIndexEntry[] = [];
    const categoryCounts = {
      security: 0,
      "repeated-correction": 0,
      "anti-pattern": 0,
      performance: 0,
      preference: 0,
    };

    // Group by type
    const byType: Record<string, RuleIndexEntry[]> = {};
    for (const rule of allRules) {
      if (!byType[rule.type]) {
        byType[rule.type] = [];
      }
      byType[rule.type].push(rule);
    }

    // Sort each category by confidence
    for (const rules of Object.values(byType)) {
      rules.sort((a, b) => b.confidence - a.confidence);
    }

    // Fill quotas
    for (const [type, quota] of Object.entries(quotas)) {
      const rules = byType[type] || [];
      const toAdd = Math.min(quota, rules.length);

      for (let i = 0; i < toAdd; i++) {
        selected.push(rules[i]);
        categoryCounts[type as keyof CategoryQuotas]++;
      }
    }

    // If we haven't reached the limit, fill with highest confidence remaining
    if (selected.length < limit) {
      const remaining = allRules
        .filter((r) => !selected.includes(r))
        .sort((a, b) => b.confidence - a.confidence);

      const needed = limit - selected.length;
      selected.push(...remaining.slice(0, needed));
    }

    return selected.slice(0, limit);
  }

  /**
   * Generate markdown content
   */
  private generateMarkdown(rules: RuleIndexEntry[]): string {
    const lines: string[] = [];

    lines.push("# AutoImprove Learned Rules");
    lines.push("");
    lines.push("> 这些规则从你的编码习惯中自动学习。规则会根据当前工作场景自动匹配。");
    lines.push("");

    // Group by priority
    const byPriority: Record<string, RuleIndexEntry[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
    };

    for (const rule of rules) {
      byPriority[rule.priority].push(rule);
    }

    // Critical (Security) Rules
    if (byPriority.critical.length > 0) {
      lines.push("## 🔴 Critical Security Rules");
      lines.push("");
      for (const rule of byPriority.critical) {
        lines.push(...this.formatRule(rule));
      }
    }

    // High Priority Rules
    if (byPriority.high.length > 0) {
      lines.push("## 🟠 High Priority Patterns");
      lines.push("");
      for (const rule of byPriority.high) {
        lines.push(...this.formatRule(rule));
      }
    }

    // Medium Priority Rules
    if (byPriority.medium.length > 0) {
      lines.push("## 🟡 Medium Priority Rules");
      lines.push("");
      for (const rule of byPriority.medium) {
        lines.push(...this.formatRule(rule));
      }
    }

    // Low Priority Rules
    if (byPriority.low.length > 0) {
      lines.push("## ⚪ Preferences");
      lines.push("");
      for (const rule of byPriority.low) {
        lines.push(...this.formatRule(rule));
      }
    }

    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("💡 **动态匹配**: Claude 会根据你当前的代码场景自动应用相关规则。");
    lines.push(`📊 **完整规则库**: 运行 \`/autoimprove-rules\` 查看全部规则。`);
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Format a single rule for the index
   */
  private formatRule(rule: RuleIndexEntry): string[] {
    const lines: string[] = [];

    // Load full content
    const content = this.contentManager.loadContent(rule.id);

    // Create rule header
    const typeLabel = this.getTypeLabel(rule.type);
    const sceneLabel = this.formatScene(rule.scenes);

    lines.push(`### [${rule.id.toUpperCase()}] ${typeLabel} [置信度: ${rule.confidence.toFixed(2)}]`);

    if (sceneLabel) {
      lines.push(`**场景**: ${sceneLabel}`);
    }

    if (rule.keywords && rule.keywords.length > 0) {
      lines.push(`**关键词**: ${rule.keywords.join(", ")}`);
    }

    if (content) {
      // Extract a short summary from content (first 2 lines or 150 chars)
      const summary = this.extractSummary(content.content);
      lines.push(`**规则**: ${summary}`);
    }

    lines.push("");

    return lines;
  }

  /**
   * Get human-readable label
   */
  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      "repeated-correction": "反复修正的模式",
      "anti-pattern": "反模式警告",
      security: "安全规则",
      performance: "性能优化",
      preference: "编码偏好",
    };

    return labels[type] || type;
  }

  /**
   * Format scene for display
   */
  private formatScene(scenes: { tech: string[]; functional: string[]; business: string[] }): string {
    const parts: string[] = [];

    if (scenes.tech.length > 0) {
      parts.push(scenes.tech.join(", "));
    }

    if (scenes.functional.length > 0) {
      parts.push(scenes.functional.join(", "));
    }

    if (scenes.business.length > 0) {
      parts.push(scenes.business.join(", "));
    }

    return parts.join(" + ");
  }

  /**
   * Extract summary from content
   */
  private extractSummary(content: string): string {
    // Remove markdown formatting
    let text = content.replace(/[#*`]/g, "");

    // Take first sentence or 150 chars
    const sentences = text.split(/[.!?。！？]/);
    if (sentences.length > 0 && sentences[0].length <= 150) {
      return sentences[0].trim();
    }

    // Fallback to first 150 chars
    if (text.length > 150) {
      return text.substring(0, 147).trim() + "...";
    }

    return text.trim();
  }
}
