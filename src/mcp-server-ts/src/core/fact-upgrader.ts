/**
 * FactUpgrader — Fact 升级路径（方向3）
 *
 * 将满足条件的 fact 记忆升级为 experience，使其可被 memory-promotion 评估为规则候选。
 *
 * 升级条件（满足至少 2 个或总分 ≥ 0.5）：
 *   - 高召回率 (recall_count ≥ 3)       权重 0.4
 *   - 用户显式确认 (user_confirmed)      权重 0.3
 *   - 跨会话复用 (sessions ≥ 2)          权重 0.2
 *   - 关联到经验证据链                    权重 0.1
 */

import { MemoryRecord, MemoryKind, InfoClass } from "./memory-models.js";

export interface UpgradeDecision {
  should_upgrade: boolean;
  upgraded_kind: MemoryKind;
  upgraded_class: InfoClass;
  reason: string;
  confidence: number;
}

export class FactUpgrader {
  evaluate(memory: MemoryRecord): UpgradeDecision {
    if (memory.info_class !== "fact") {
      return {
        should_upgrade: false,
        upgraded_kind: memory.kind,
        upgraded_class: "fact",
        reason: "not a fact — no upgrade needed",
        confidence: 0,
      };
    }

    const checks: Array<{ name: string; passed: boolean; weight: number }> = [
      {
        name: "high_recall",
        passed: (memory.recall_count || 0) >= 3,
        weight: 0.4,
      },
      {
        name: "user_confirmed",
        passed: memory.outcome?.user_confirmed === true,
        weight: 0.3,
      },
      {
        name: "cross_session",
        passed: (memory.independent_session_count || 0) >= 2,
        weight: 0.2,
      },
      {
        name: "experience_link",
        passed: this.hasExperienceLink(memory),
        weight: 0.1,
      },
    ];

    const passedChecks = checks.filter((c) => c.passed);
    const score = passedChecks.reduce((sum, c) => sum + c.weight, 0);

    const shouldUpgrade = passedChecks.length >= 2 || score >= 0.5;

    return {
      should_upgrade: shouldUpgrade,
      upgraded_kind: "procedural",
      upgraded_class: "experience",
      reason: shouldUpgrade
        ? `satisfies ${passedChecks.length} upgrade conditions (${passedChecks.map((c) => c.name).join(", ")}), score ${score.toFixed(2)}`
        : `only ${passedChecks.length} conditions met, below upgrade threshold`,
      confidence: score,
    };
  }

  /**
   * 执行升级：修改 kind 和 info_class，记录元数据，重置 state 以便 promotion 重新评估
   */
  upgrade(memory: MemoryRecord, decision: UpgradeDecision): MemoryRecord {
    return {
      ...memory,
      kind: decision.upgraded_kind,
      info_class: decision.upgraded_class,
      state: "observed",
      updated_at: new Date().toISOString(),
      metadata: {
        ...(memory.metadata || {}),
        upgraded_from: "fact",
        upgrade_reason: decision.reason,
        upgrade_confidence: decision.confidence,
        upgrade_timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * 检查是否关联到已有的经验证据链
   * 判断标准：evidence 中有 source_excerpt 包含 纠正性关键词
   */
  private hasExperienceLink(memory: MemoryRecord): boolean {
    const correctiveKeywords = [
      "应该", "必须", "need to", "should", "must",
      "不要", "避免", "avoid", "don't", "修正", "fix",
    ];
    return memory.evidence.some((e) => {
      const excerpt = (e.source_excerpt || "").toLowerCase();
      return correctiveKeywords.some((kw) => excerpt.includes(kw));
    });
  }
}

export const factUpgrader = new FactUpgrader();
