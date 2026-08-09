/**
 * ScopeResolver — 统一仲裁规则 scope（方向4）
 *
 * 整合三条独立路径的 scope 判断结果，按优先级加权投票：
 *   - promotion (基于跨项目统计 + LLM 泛化)：权重 0.50
 *   - llm_suggestion (规则生成阶段 LLM 判断)：权重 0.30
 *   - heuristic (关键词匹配 ScopeDetector)：权重 0.20
 *
 * 安全护栏：
 *   - promotion 判为非 global 时，LLM 不能单独推到 global
 *   - heuristic 默认 GLOBAL 且置信度低时权重减半
 *   - 所有来源缺失时默认 PROJECT（最安全）
 */

import { RuleScope, Pattern } from "./models.js";
import { MemoryRecord } from "./memory-models.js";

export interface ScopeHeuristicInput {
  scope: RuleScope;
  confidence: number;
  reason: string;
}

export interface ScopePromotionInput {
  scope: "project" | "organization" | "global";
  confidence: number;
  reason: string;
  project_count: number;
  organization_count: number;
}

export interface ScopeLLMSuggestion {
  scope: "project" | "organization" | "global";
  confidence: number;
  reason: string;
}

export interface ScopeContextInput {
  project_path?: string;
  organization_id?: string;
  repository?: string;
  branch?: string;
}

export interface ScopeInput {
  heuristic?: ScopeHeuristicInput;
  promotion?: ScopePromotionInput;
  llm_suggestion?: ScopeLLMSuggestion;
  context?: ScopeContextInput;
}

export interface ScopeContribution {
  source: "heuristic" | "promotion" | "llm";
  scope: string;
  weight: number;
  contribution: number;
}

export interface ScopeResult {
  scope: RuleScope;
  confidence: number;
  reason: string;
  contributions: ScopeContribution[];
}

export class ScopeResolver {
  resolve(input: ScopeInput): ScopeResult {
    const votes = new Map<string, number>();
    const contributions: ScopeContribution[] = [];

    // 1. promotion 投票（权重 0.50）—— 最可靠
    if (input.promotion) {
      const weight = 0.50;
      votes.set(input.promotion.scope, (votes.get(input.promotion.scope) || 0) + weight);
      contributions.push({
        source: "promotion",
        scope: input.promotion.scope,
        weight,
        contribution: weight,
      });
    }

    // 2. llm_suggestion 投票（权重 0.30，但受 promotion 约束）
    if (input.llm_suggestion) {
      let weight = 0.30;
      // 安全护栏：promotion 判为非 global 时，LLM 的 global 建议降权
      if (
        input.promotion &&
        input.promotion.scope !== "global" &&
        input.llm_suggestion.scope === "global"
      ) {
        weight = 0.10;
      }
      votes.set(
        input.llm_suggestion.scope,
        (votes.get(input.llm_suggestion.scope) || 0) + weight
      );
      contributions.push({
        source: "llm",
        scope: input.llm_suggestion.scope,
        weight,
        contribution: weight,
      });
    }

    // 3. heuristic 投票（权重 0.20，但默认 GLOBAL 且低置信度时降权）
    if (input.heuristic) {
      let weight = 0.20;
      if (input.heuristic.scope === "global" && input.heuristic.confidence < 0.7) {
        weight = 0.10;
      }
      votes.set(
        input.heuristic.scope,
        (votes.get(input.heuristic.scope) || 0) + weight
      );
      contributions.push({
        source: "heuristic",
        scope: input.heuristic.scope,
        weight,
        contribution: weight,
      });
    }

    // 计算最终结果
    let finalScope: RuleScope = RuleScope.PROJECT; // 默认最安全
    let maxVote = 0;
    for (const [scope, vote] of votes) {
      if (vote > maxVote || (vote === maxVote && scope === "organization")) {
        maxVote = vote;
        finalScope = scope as RuleScope;
      }
    }

    // 归一化置信度
    const confidence = Math.min(1, maxVote / 0.80);

    const reason =
      `Weighted vote: ${Array.from(votes.entries())
        .map(([s, v]) => `${s}=${v.toFixed(2)}`)
        .join(", ")} → ${finalScope} (confidence ${confidence.toFixed(2)})`;

    return { scope: finalScope, confidence, reason, contributions };
  }

  /**
   * 从 MemoryRuleInput 风格数据 + Pattern 快捷构建 ScopeInput
   */
  static buildFromMemory(
    promotionMeta?: { scope?: string; confidence?: number; reason?: string },
    context?: ScopeContextInput,
    pattern?: Pattern
  ): ScopeInput {
    const input: ScopeInput = { context };

    if (promotionMeta?.scope) {
      input.promotion = {
        scope: promotionMeta.scope as "project" | "organization" | "global",
        confidence: promotionMeta.confidence ?? 0.5,
        reason: promotionMeta.reason ?? "",
        project_count: 0,
        organization_count: 0,
      };
    }

    if (pattern?.project_paths) {
      // 从 pattern 推断 heuristic scope
      const projectPaths = pattern.project_paths;
      input.heuristic = {
        scope:
          projectPaths.length >= 3
            ? RuleScope.ORGANIZATION
            : projectPaths.length >= 1
            ? RuleScope.PROJECT
            : RuleScope.GLOBAL,
        confidence: Math.min(1, projectPaths.length / 3 + 0.3),
        reason: `Based on ${projectPaths.length} project context(s)`,
      };
    }

    return input;
  }
}

export const scopeResolver = new ScopeResolver();
