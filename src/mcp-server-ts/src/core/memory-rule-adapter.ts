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
  // info_class 可能缺失（历史数据 / 未分类），此时也按内容关键词推断，
  // 避免所有规则都退化为 repeated-correction 导致 type 无区分度。
  const content = (memory.content + " " + (memory.summary || "") + " " + (memory.keywords || []).join(" ")).toLowerCase();
  if (/security|注入|injection|vulnerability|exploit|cve|xss|csrf|密码|哈希|认证|授权|权限|token|auth|安全|泄露|敏感/i.test(content))
    return PatternType.SECURITY;
  if (/performance|性能|slow|optimize|优化|useMemo|useCallback|缓存|cache|瓶颈|耗时|延迟|加速|memory leak|内存泄露/i.test(content))
    return PatternType.PERFORMANCE;
  if (/bug|error|wrong|broken|fail|错误|问题|失败|异常|崩溃|报错|修复|死循环|空指针|race condition/i.test(content))
    return PatternType.ANTI_PATTERN;
  if (memory.info_class === "experience") return PatternType.REPEATED_CORRECTION;
  // info_class 缺失：若内容含明确偏好/约定信号则视为 preference，否则经验默认
  if (/^(always|never|must|should|prefer|recommend|避免|不要|必须|总是|统一|约定|建议)/i.test(content.trim()))
    return PatternType.PREFERENCE;
  return PatternType.REPEATED_CORRECTION;
}
