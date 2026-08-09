/**
 * MemoryRuleAdapter — 将 MemoryRecord 转换为规则生成器可消费的富输入（方向2）
 *
 * 统一 Pattern 和 Memory 双轨，让 MemoryPromotion 的产出成为规则生成的主驱动。
 */

import { MemoryRecord, MemoryEvidence } from "./memory-models.js";
import { Pattern, PatternType, Scene, RuleScope } from "./models.js";

export interface MemoryRuleInput {
  /** 记忆完整内容（优先于 Pattern.description） */
  content: string;
  /** 摘要 */
  summary: string;
  /** 三分类 */
  info_class: "preference" | "fact" | "experience";
  /** 认知类型映射到的 PatternType */
  pattern_type: PatternType;
  /** 原始证据链（完整消息内容） */
  evidence: MemoryEvidence[];
  /** 证据摘录文本 */
  evidence_excerpts: string[];
  /** 跨会话统计 */
  stats: {
    independent_sessions: number;
    independent_projects: number;
    validation_count: number;
    contradiction_count: number;
  };
  /** MemoryPromotion 结果 */
  promotion: {
    score: number;
    scope: "project" | "organization" | "global";
    confidence: number;
    reason: string;
  };
  /** scope context */
  scope_context?: {
    project_path?: string;
    organization_id?: string;
    repository?: string;
    branch?: string;
  };
  /** 关联的 Pattern（如有） */
  source_pattern?: Pattern;
  /** 场景 */
  scene?: Scene;
  /** 记忆唯一 ID */
  memory_id: string;
}

export class MemoryRuleAdapter {
  /**
   * 将 promoted MemoryRecord 转换为 MemoryRuleInput
   */
  static fromPromotedMemory(memory: MemoryRecord): MemoryRuleInput {
    const evidence_excerpts = memory.evidence
      .filter((e) => e.source_excerpt && e.source_excerpt.length > 10)
      .map((e) => e.source_excerpt!);

    return {
      content: memory.content,
      summary: memory.summary,
      info_class: memory.info_class || "experience",
      pattern_type: memoryToPatternType(memory),
      evidence: memory.evidence,
      evidence_excerpts,
      stats: {
        independent_sessions: memory.independent_session_count || 1,
        independent_projects: memory.independent_project_count || 0,
        validation_count: memory.validation_count || 0,
        contradiction_count: memory.contradiction_count || 0,
      },
      promotion: {
        score: (memory.metadata?.promotion_score as number) ?? memory.confidence,
        scope: ((memory.metadata?.promotion_scope as string) ?? "project") as "project" | "organization" | "global",
        confidence: (memory.metadata?.generalization_confidence as number) ?? 0.5,
        reason: (memory.metadata?.promotion_reason as string) ?? "",
      },
      scope_context: {
        project_path: memory.namespace?.project_path,
        organization_id: memory.namespace?.organization_id,
        repository: memory.namespace?.repository,
        branch: memory.namespace?.branch,
      },
      memory_id: memory.id,
    };
  }

  /**
   * 将 memories 按 scope 分组，便于分组建模
   */
  static groupByScope(
    inputs: MemoryRuleInput[]
  ): Map<string, MemoryRuleInput[]> {
    const groups = new Map<string, MemoryRuleInput[]>();
    for (const input of inputs) {
      const key = input.promotion.scope;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(input);
    }
    return groups;
  }
}

/** 将 info_class + kind 映射到 PatternType */
function memoryToPatternType(memory: MemoryRecord): PatternType {
  if (memory.info_class === "preference") return PatternType.PREFERENCE;
  if (memory.info_class === "experience") {
    // 根据关键词推断具体类型
    const content = (memory.content + " " + (memory.summary || "")).toLowerCase();
    if (/security|security|注入|vulnerability|xss|csrf/i.test(content))
      return PatternType.SECURITY;
    if (/performance|性能|slow|optimize|优化|useMemo|useCallback/i.test(content))
      return PatternType.PERFORMANCE;
    if (/bug|error|wrong|broken|fail|错误|问题/i.test(content))
      return PatternType.ANTI_PATTERN;
    return PatternType.REPEATED_CORRECTION;
  }
  return PatternType.REPEATED_CORRECTION;
}
