/**
 * Rule usage statistics analyzer for AutoImprove.
 *
 * Provides multi-dimensional analysis of rule usage patterns.
 */

import { RuleIndexManager } from "../storage/rule-index.js";
import { RuleContentManager } from "../storage/rule-content.js";
import { AdaptiveConfidenceCalculator, RuleFeedback } from "./adaptive-confidence.js";
import { RuleIndexEntry, PatternType } from "./models.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ============================================================================
// Types
// ============================================================================

export interface UsageCount {
  used: number;
  ignored: number;
  corrected: number;
  disabled: number;
  total: number;
}

export interface CategoryStats extends UsageCount {
  rules_count: number;
  avg_confidence: number;
  avg_rating?: number;
}

export interface PriorityStats extends UsageCount {
  rules_count: number;
  avg_confidence: number;
}

export interface TimeSeriesData {
  date: string;
  used: number;
  ignored: number;
  corrected: number;
  total: number;
}

export interface TopRule {
  rule_id: string;
  category: string;
  priority: string;
  usage_count: number;
  ignored_count: number;
  avg_rating?: number;
  confidence: number;
}

export interface ProblematicRule {
  rule_id: string;
  category: string;
  total_feedbacks: number;
  ignored_rate: number;
  corrected_rate: number;
  disabled_rate: number;
}

export interface RuleUsageStats {
  overview: {
    total_rules: number;
    rules_with_usage: number;
    total_feedbacks: number;
    avg_usage_per_rule: number;
    time_range: {
      start: string;
      end: string;
    };
  };
  by_category: {
    [category: string]: CategoryStats;
  };
  by_scene: {
    tech: { [tech: string]: UsageCount };
    functional: { [func: string]: UsageCount };
    business: { [biz: string]: UsageCount };
  };
  by_priority: {
    [priority: string]: PriorityStats;
  };
  by_time: {
    daily: TimeSeriesData[];
    weekly: TimeSeriesData[];
  };
  top_used_rules: TopRule[];
  problematic_rules: ProblematicRule[];
}

export interface StatsOptions {
  startDate?: Date;
  endDate?: Date;
  categories?: string[];
  minFeedbacks?: number;
  topN?: number;
}

// ============================================================================
// RuleUsageStatsAnalyzer
// ============================================================================

export class RuleUsageStatsAnalyzer {
  private feedbackHistory: RuleFeedback[] = [];

  constructor(
    private indexManager: RuleIndexManager,
    private contentManager: RuleContentManager,
    _adaptiveConfidence: AdaptiveConfidenceCalculator
  ) {
    this.loadFeedbackHistory();
  }

  /**
   * Get multi-dimensional statistics
   */
  getMultiDimensionalStats(options: StatsOptions = {}): RuleUsageStats {
    const { startDate, endDate, categories, minFeedbacks = 0, topN = 10 } = options;

    // Filter feedbacks by time range
    const filteredFeedbacks = this.filterFeedbacksByTimeRange(
      this.feedbackHistory,
      startDate,
      endDate
    );

    // Load all rules
    const allRules = this.indexManager.listRules();

    // Filter by categories if specified
    const rules = categories
      ? allRules.filter((r) => {
          const content = this.contentManager.loadContent(r.id);
          return content && categories.includes(this.getRuleCategory(r, content));
        })
      : allRules;

    // Calculate time range
    const timeRange = this.calculateTimeRange(filteredFeedbacks);

    // Overview statistics
    const overview = this.calculateOverview(rules, filteredFeedbacks, timeRange);

    // By category
    const byCategory = this.calculateByCategory(rules, filteredFeedbacks);

    // By scene
    const byScene = this.calculateByScene(rules, filteredFeedbacks);

    // By priority
    const byPriority = this.calculateByPriority(rules, filteredFeedbacks);

    // Time series
    const byTime = this.calculateTimeSeries(filteredFeedbacks);

    // Top rules
    const topUsedRules = this.calculateTopRules(rules, filteredFeedbacks, topN);

    // Problematic rules
    const problematicRules = this.calculateProblematicRules(
      rules,
      filteredFeedbacks,
      minFeedbacks
    );

    return {
      overview,
      by_category: byCategory,
      by_scene: byScene,
      by_priority: byPriority,
      by_time: byTime,
      top_used_rules: topUsedRules,
      problematic_rules: problematicRules,
    };
  }

  /**
   * Generate markdown report
   */
  generateReport(stats: RuleUsageStats, options: { title?: string } = {}): string {
    const title = options.title || "AutoImprove 规则使用统计报告";
    const lines: string[] = [];

    // Header
    lines.push(`# 📊 ${title}`);
    lines.push("");
    lines.push(`**生成时间**: ${new Date().toISOString()}`);
    lines.push(
      `**统计周期**: ${stats.overview.time_range.start} 至 ${stats.overview.time_range.end}`
    );
    lines.push("");

    // Overview
    lines.push("## 📈 总体概览");
    lines.push("");
    lines.push(`- 总规则数: ${stats.overview.total_rules}`);
    lines.push(
      `- 有使用记录的规则: ${stats.overview.rules_with_usage} (${((stats.overview.rules_with_usage / stats.overview.total_rules) * 100).toFixed(1)}%)`
    );
    lines.push(`- 总反馈数: ${stats.overview.total_feedbacks}`);
    lines.push(
      `- 平均每规则使用次数: ${stats.overview.avg_usage_per_rule.toFixed(1)}`
    );
    lines.push("");

    // By category
    lines.push("## 🏷️ 按类别统计");
    lines.push("");
    lines.push("| 类别 | 规则数 | 使用次数 | 忽略次数 | 修正次数 | 平均置信度 | 平均评分 |");
    lines.push("|------|--------|----------|----------|----------|------------|----------|");
    const sortedCategories = Object.entries(stats.by_category).sort(
      ([, a], [, b]) => b.used - a.used
    );
    for (const [category, data] of sortedCategories) {
      const avgRating = data.avg_rating ? data.avg_rating.toFixed(1) : "N/A";
      lines.push(
        `| ${category} | ${data.rules_count} | ${data.used} | ${data.ignored} | ${data.corrected} | ${data.avg_confidence.toFixed(2)} | ${avgRating} |`
      );
    }
    lines.push("");

    // By priority
    lines.push("## ⚡ 按优先级统计");
    lines.push("");
    lines.push("| 优先级 | 规则数 | 使用次数 | 忽略次数 | 平均置信度 |");
    lines.push("|--------|--------|----------|----------|------------|");
    const priorityOrder = ["critical", "high", "medium", "low"];
    for (const priority of priorityOrder) {
      const data = stats.by_priority[priority];
      if (data) {
        lines.push(
          `| ${priority} | ${data.rules_count} | ${data.used} | ${data.ignored} | ${data.avg_confidence.toFixed(2)} |`
        );
      }
    }
    lines.push("");

    // By scene - tech
    lines.push("## 🎯 按场景统计");
    lines.push("");
    lines.push("### 技术栈（Tech）");
    lines.push("");
    const topTechs = Object.entries(stats.by_scene.tech)
      .sort(([, a], [, b]) => b.used - a.used)
      .slice(0, 10);
    if (topTechs.length > 0) {
      for (const [tech, data] of topTechs) {
        lines.push(`- **${tech}**: ${data.used}次使用, ${data.ignored}次忽略`);
      }
    } else {
      lines.push("_无数据_");
    }
    lines.push("");

    // By scene - functional
    lines.push("### 功能领域（Functional）");
    lines.push("");
    const topFuncs = Object.entries(stats.by_scene.functional)
      .sort(([, a], [, b]) => b.used - a.used)
      .slice(0, 10);
    if (topFuncs.length > 0) {
      for (const [func, data] of topFuncs) {
        lines.push(`- **${func}**: ${data.used}次使用, ${data.ignored}次忽略`);
      }
    } else {
      lines.push("_无数据_");
    }
    lines.push("");

    // Top rules
    lines.push(`## ⭐ Top ${stats.top_used_rules.length} 最常使用的规则`);
    lines.push("");
    if (stats.top_used_rules.length > 0) {
      for (let i = 0; i < stats.top_used_rules.length; i++) {
        const rule = stats.top_used_rules[i];
        const rating = rule.avg_rating ? ` ⭐️${rule.avg_rating.toFixed(1)}` : "";
        const ignoreInfo =
          rule.ignored_count > 0 ? ` (忽略${rule.ignored_count}次)` : "";
        lines.push(
          `${i + 1}. **${rule.rule_id}** (${rule.category}/${rule.priority}) - ${rule.usage_count}次${rating}${ignoreInfo}`
        );
      }
    } else {
      lines.push("_无数据_");
    }
    lines.push("");

    // Problematic rules
    if (stats.problematic_rules.length > 0) {
      lines.push("## ⚠️ 需要关注的规则");
      lines.push("");
      lines.push("| 规则ID | 类别 | 总反馈 | 忽略率 | 修正率 | 禁用率 |");
      lines.push("|--------|------|--------|--------|--------|--------|");
      for (const rule of stats.problematic_rules) {
        lines.push(
          `| ${rule.rule_id} | ${rule.category} | ${rule.total_feedbacks} | ${(rule.ignored_rate * 100).toFixed(1)}% | ${(rule.corrected_rate * 100).toFixed(1)}% | ${(rule.disabled_rate * 100).toFixed(1)}% |`
        );
      }
      lines.push("");
    }

    // Time series - weekly
    if (stats.by_time.weekly.length > 0) {
      lines.push("## 📅 使用趋势（按周）");
      lines.push("");
      lines.push("```");
      lines.push("周次         使用  忽略  修正");
      for (const data of stats.by_time.weekly.slice(-8)) {
        const week = data.date.padEnd(12);
        const used = String(data.used).padStart(4);
        const ignored = String(data.ignored).padStart(4);
        const corrected = String(data.corrected).padStart(4);
        lines.push(`${week} ${used} ${ignored} ${corrected}`);
      }
      lines.push("```");
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Generate summary text
   */
  generateSummary(stats: RuleUsageStats): string {
    const lines: string[] = [];

    lines.push("📊 规则使用统计概要");
    lines.push("");
    lines.push(
      `总规则: ${stats.overview.total_rules} | 有使用记录: ${stats.overview.rules_with_usage} | 总反馈: ${stats.overview.total_feedbacks}`
    );
    lines.push("");

    // Top category
    const topCategory = Object.entries(stats.by_category).sort(
      ([, a], [, b]) => b.used - a.used
    )[0];
    if (topCategory) {
      lines.push(`使用最多的类别: ${topCategory[0]} (${topCategory[1].used}次)`);
    }

    // Top rule
    if (stats.top_used_rules.length > 0) {
      const top = stats.top_used_rules[0];
      lines.push(`使用最多的规则: ${top.rule_id} (${top.usage_count}次)`);
    }

    // Problematic count
    if (stats.problematic_rules.length > 0) {
      lines.push(`需要关注的规则: ${stats.problematic_rules.length}个`);
    }

    return lines.join("\n");
  }

  // ============================================================================
  // Private helper methods
  // ============================================================================

  private loadFeedbackHistory(): void {
    const feedbackFile = join(
      process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove"),
      "feedback_history.jsonl"
    );

    if (!existsSync(feedbackFile)) {
      this.feedbackHistory = [];
      return;
    }

    try {
      const data = readFileSync(feedbackFile, "utf-8");
      const lines = data.trim().split("\n");
      this.feedbackHistory = lines
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as RuleFeedback);
    } catch (error) {
      console.error("Failed to load feedback history:", error);
      this.feedbackHistory = [];
    }
  }

  private filterFeedbacksByTimeRange(
    feedbacks: RuleFeedback[],
    startDate?: Date,
    endDate?: Date
  ): RuleFeedback[] {
    return feedbacks.filter((f) => {
      const timestamp = new Date(f.timestamp);
      if (startDate && timestamp < startDate) return false;
      if (endDate && timestamp > endDate) return false;
      return true;
    });
  }

  private calculateTimeRange(feedbacks: RuleFeedback[]): {
    start: string;
    end: string;
  } {
    if (feedbacks.length === 0) {
      return {
        start: "N/A",
        end: "N/A",
      };
    }

    const timestamps = feedbacks.map((f) => new Date(f.timestamp).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);

    return {
      start: new Date(minTime).toISOString().split("T")[0],
      end: new Date(maxTime).toISOString().split("T")[0],
    };
  }

  private calculateOverview(
    rules: RuleIndexEntry[],
    feedbacks: RuleFeedback[],
    timeRange: { start: string; end: string }
  ) {
    const rulesWithUsage = new Set(feedbacks.map((f) => f.rule_id));

    return {
      total_rules: rules.length,
      rules_with_usage: rulesWithUsage.size,
      total_feedbacks: feedbacks.length,
      avg_usage_per_rule: rules.length > 0 ? feedbacks.length / rules.length : 0,
      time_range: timeRange,
    };
  }

  private calculateByCategory(
    rules: RuleIndexEntry[],
    feedbacks: RuleFeedback[]
  ): { [category: string]: CategoryStats } {
    const categoryMap = new Map<string, CategoryStats>();

    // Initialize categories from rules
    for (const rule of rules) {
      const content = this.contentManager.loadContent(rule.id);
      const category = this.getRuleCategory(rule, content);

      if (!categoryMap.has(category)) {
        categoryMap.set(category, {
          rules_count: 0,
          used: 0,
          ignored: 0,
          corrected: 0,
          disabled: 0,
          total: 0,
          avg_confidence: 0,
        });
      }

      const stats = categoryMap.get(category)!;
      stats.rules_count++;
      stats.avg_confidence += rule.confidence;
    }

    // Calculate average confidence
    for (const stats of categoryMap.values()) {
      stats.avg_confidence = stats.avg_confidence / stats.rules_count;
    }

    // Aggregate feedbacks
    for (const feedback of feedbacks) {
      const rule = rules.find((r) => r.id === feedback.rule_id);
      if (!rule) continue;

      const content = this.contentManager.loadContent(rule.id);
      const category = this.getRuleCategory(rule, content);
      const stats = categoryMap.get(category);
      if (!stats) continue;

      this.incrementUsageCount(stats, feedback.feedback_type);
    }

    // Calculate average ratings
    for (const [category, stats] of categoryMap.entries()) {
      const categoryFeedbacks = feedbacks.filter((f) => {
        const rule = rules.find((r) => r.id === f.rule_id);
        if (!rule) return false;
        const content = this.contentManager.loadContent(rule.id);
        return this.getRuleCategory(rule, content) === category;
      });

      const ratings = categoryFeedbacks
        .filter((f) => f.user_rating !== undefined)
        .map((f) => f.user_rating!);

      if (ratings.length > 0) {
        stats.avg_rating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      }
    }

    return Object.fromEntries(categoryMap);
  }

  private calculateByScene(
    rules: RuleIndexEntry[],
    feedbacks: RuleFeedback[]
  ): {
    tech: { [tech: string]: UsageCount };
    functional: { [func: string]: UsageCount };
    business: { [biz: string]: UsageCount };
  } {
    const techMap = new Map<string, UsageCount>();
    const funcMap = new Map<string, UsageCount>();
    const bizMap = new Map<string, UsageCount>();

    for (const feedback of feedbacks) {
      const rule = rules.find((r) => r.id === feedback.rule_id);
      if (!rule || !rule.scenes) continue;

      // Tech
      for (const tech of rule.scenes.tech) {
        if (!techMap.has(tech)) {
          techMap.set(tech, this.createEmptyUsageCount());
        }
        this.incrementUsageCount(techMap.get(tech)!, feedback.feedback_type);
      }

      // Functional
      for (const func of rule.scenes.functional) {
        if (!funcMap.has(func)) {
          funcMap.set(func, this.createEmptyUsageCount());
        }
        this.incrementUsageCount(funcMap.get(func)!, feedback.feedback_type);
      }

      // Business
      for (const biz of rule.scenes.business) {
        if (!bizMap.has(biz)) {
          bizMap.set(biz, this.createEmptyUsageCount());
        }
        this.incrementUsageCount(bizMap.get(biz)!, feedback.feedback_type);
      }
    }

    return {
      tech: Object.fromEntries(techMap),
      functional: Object.fromEntries(funcMap),
      business: Object.fromEntries(bizMap),
    };
  }

  private calculateByPriority(
    rules: RuleIndexEntry[],
    feedbacks: RuleFeedback[]
  ): { [priority: string]: PriorityStats } {
    const priorityMap = new Map<string, PriorityStats>();

    // Initialize from rules
    for (const rule of rules) {
      const priority = rule.priority;
      if (!priorityMap.has(priority)) {
        priorityMap.set(priority, {
          rules_count: 0,
          used: 0,
          ignored: 0,
          corrected: 0,
          disabled: 0,
          total: 0,
          avg_confidence: 0,
        });
      }

      const stats = priorityMap.get(priority)!;
      stats.rules_count++;
      stats.avg_confidence += rule.confidence;
    }

    // Calculate average confidence
    for (const stats of priorityMap.values()) {
      stats.avg_confidence = stats.avg_confidence / stats.rules_count;
    }

    // Aggregate feedbacks
    for (const feedback of feedbacks) {
      const rule = rules.find((r) => r.id === feedback.rule_id);
      if (!rule) continue;

      const stats = priorityMap.get(rule.priority);
      if (!stats) continue;

      this.incrementUsageCount(stats, feedback.feedback_type);
    }

    return Object.fromEntries(priorityMap);
  }

  private calculateTimeSeries(
    feedbacks: RuleFeedback[]
  ): {
    daily: TimeSeriesData[];
    weekly: TimeSeriesData[];
  } {
    if (feedbacks.length === 0) {
      return { daily: [], weekly: [] };
    }

    // Group by date
    const dailyMap = new Map<string, TimeSeriesData>();
    const weeklyMap = new Map<string, TimeSeriesData>();

    for (const feedback of feedbacks) {
      const date = new Date(feedback.timestamp);
      const dateStr = date.toISOString().split("T")[0];

      // Daily
      if (!dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, {
          date: dateStr,
          used: 0,
          ignored: 0,
          corrected: 0,
          total: 0,
        });
      }
      this.incrementTimeSeriesData(dailyMap.get(dateStr)!, feedback.feedback_type);

      // Weekly (ISO week)
      const weekStr = this.getISOWeek(date);
      if (!weeklyMap.has(weekStr)) {
        weeklyMap.set(weekStr, {
          date: weekStr,
          used: 0,
          ignored: 0,
          corrected: 0,
          total: 0,
        });
      }
      this.incrementTimeSeriesData(weeklyMap.get(weekStr)!, feedback.feedback_type);
    }

    return {
      daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      weekly: Array.from(weeklyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  private calculateTopRules(
    rules: RuleIndexEntry[],
    feedbacks: RuleFeedback[],
    topN: number
  ): TopRule[] {
    const ruleStatsMap = new Map<
      string,
      {
        used: number;
        ignored: number;
        ratings: number[];
      }
    >();

    // Aggregate feedbacks
    for (const feedback of feedbacks) {
      if (!ruleStatsMap.has(feedback.rule_id)) {
        ruleStatsMap.set(feedback.rule_id, { used: 0, ignored: 0, ratings: [] });
      }

      const stats = ruleStatsMap.get(feedback.rule_id)!;
      if (feedback.feedback_type === "used") {
        stats.used++;
      } else if (feedback.feedback_type === "ignored") {
        stats.ignored++;
      }

      if (feedback.user_rating !== undefined) {
        stats.ratings.push(feedback.user_rating);
      }
    }

    // Build top rules
    const topRules: TopRule[] = [];
    for (const [ruleId, stats] of ruleStatsMap.entries()) {
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) continue;

      const content = this.contentManager.loadContent(rule.id);
      const category = this.getRuleCategory(rule, content);

      topRules.push({
        rule_id: ruleId,
        category,
        priority: rule.priority,
        usage_count: stats.used,
        ignored_count: stats.ignored,
        avg_rating:
          stats.ratings.length > 0
            ? stats.ratings.reduce((a, b) => a + b, 0) / stats.ratings.length
            : undefined,
        confidence: rule.confidence,
      });
    }

    // Sort by usage count and return top N
    return topRules.sort((a, b) => b.usage_count - a.usage_count).slice(0, topN);
  }

  private calculateProblematicRules(
    rules: RuleIndexEntry[],
    feedbacks: RuleFeedback[],
    minFeedbacks: number
  ): ProblematicRule[] {
    const ruleStatsMap = new Map<
      string,
      {
        total: number;
        ignored: number;
        corrected: number;
        disabled: number;
      }
    >();

    // Aggregate feedbacks
    for (const feedback of feedbacks) {
      if (!ruleStatsMap.has(feedback.rule_id)) {
        ruleStatsMap.set(feedback.rule_id, {
          total: 0,
          ignored: 0,
          corrected: 0,
          disabled: 0,
        });
      }

      const stats = ruleStatsMap.get(feedback.rule_id)!;
      stats.total++;

      if (feedback.feedback_type === "ignored") {
        stats.ignored++;
      } else if (feedback.feedback_type === "corrected") {
        stats.corrected++;
      } else if (feedback.feedback_type === "disabled") {
        stats.disabled++;
      }
    }

    // Find problematic rules (high ignore/correct/disable rate)
    const problematicRules: ProblematicRule[] = [];
    const IGNORE_THRESHOLD = 0.5; // 50% ignored
    const CORRECT_THRESHOLD = 0.3; // 30% corrected
    const DISABLE_THRESHOLD = 0.1; // 10% disabled

    for (const [ruleId, stats] of ruleStatsMap.entries()) {
      if (stats.total < minFeedbacks) continue;

      const ignoredRate = stats.ignored / stats.total;
      const correctedRate = stats.corrected / stats.total;
      const disabledRate = stats.disabled / stats.total;

      if (
        ignoredRate >= IGNORE_THRESHOLD ||
        correctedRate >= CORRECT_THRESHOLD ||
        disabledRate >= DISABLE_THRESHOLD
      ) {
        const rule = rules.find((r) => r.id === ruleId);
        if (!rule) continue;

        const content = this.contentManager.loadContent(rule.id);
        const category = this.getRuleCategory(rule, content);

        problematicRules.push({
          rule_id: ruleId,
          category,
          total_feedbacks: stats.total,
          ignored_rate: ignoredRate,
          corrected_rate: correctedRate,
          disabled_rate: disabledRate,
        });
      }
    }

    // Sort by ignored rate (descending)
    return problematicRules.sort((a, b) => b.ignored_rate - a.ignored_rate);
  }

  private getRuleCategory(rule: RuleIndexEntry, content: any): string {
    // Try to get from content metadata first
    if (content?.metadata?.category) {
      return content.metadata.category;
    }

    // Fall back to pattern type
    return this.patternTypeToCategory(rule.type);
  }

  private patternTypeToCategory(type: PatternType): string {
    const categoryMap: Record<string, string> = {
      "security": "Security",
      "performance": "Performance",
      "anti-pattern": "Best Practice",
      "preference": "Preference",
      "repeated-correction": "Style",
    };

    return categoryMap[type] || "Other";
  }

  private createEmptyUsageCount(): UsageCount {
    return {
      used: 0,
      ignored: 0,
      corrected: 0,
      disabled: 0,
      total: 0,
    };
  }

  private incrementUsageCount(
    count: UsageCount,
    feedbackType: "used" | "ignored" | "corrected" | "disabled"
  ): void {
    count.total++;
    if (feedbackType === "used") {
      count.used++;
    } else if (feedbackType === "ignored") {
      count.ignored++;
    } else if (feedbackType === "corrected") {
      count.corrected++;
    } else if (feedbackType === "disabled") {
      count.disabled++;
    }
  }

  private incrementTimeSeriesData(
    data: TimeSeriesData,
    feedbackType: "used" | "ignored" | "corrected" | "disabled"
  ): void {
    data.total++;
    if (feedbackType === "used") {
      data.used++;
    } else if (feedbackType === "ignored") {
      data.ignored++;
    } else if (feedbackType === "corrected") {
      data.corrected++;
    }
  }

  private getISOWeek(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }
}
