/**
 * MemoryDecayService — 长期记忆「衰减淘汰」服务（五道关卡·关卡4）
 *
 * 对应课程记忆提取框架的「衰减淘汰」关卡。目标：让长期记忆库保持高信噪比，
 * 避免“写得多≠记得好”——大量低频、过期或被否定的记忆持续污染召回与规则。
 *
 * 四类淘汰逻辑（均可通过 options 调整阈值，便于测试与灰度）：
 *   1. TTL 过期归档：expires_at 早于 now → 归档（status=archived）。
 *   2. 频次衰减：经验类记忆若长期（>staleDays）零召回 → 软淘汰（state=deprecated）。
 *      - 偏好/事实视为稳定知识，默认不因低频而自动消失（仅 TTL/显式废弃可移除），
 *        避免用户的长期约定被悄悄抹掉。
 *   3. deprecated 标记：state 已被置为 deprecated → 归档。
 *   4. 被否定优先淘汰：metadata.conflict_with / deprecated_by 存在 → 优先归档。
 *
 * 规则联动降级：记忆归档或淘汰后，通过注入的 getRuleIdsForMemory 回调收集其派生规则，
 * 交由调用方（MCP 工具 / index.ts）重新计算规则状态（支撑不足则降为 candidate）。
 *
 * 设计：纯逻辑、存储无关（只依赖 MemoryRepository 接口），便于单元测试用内存桩验证。
 */

import { MemoryRecord, MemoryRepository } from "./memory-models.js";

export interface DecayDetail {
  memory_id: string;
  info_class?: string;
  action: "archived" | "deprecated";
  reason: string;
}

export interface DecayResult {
  scanned: number;
  archived: number;
  deprecated: number;
  rules_to_demote: string[];
  details: DecayDetail[];
}

export interface MemoryDecayOptions {
  /** 覆盖“当前时间”，便于测试。默认 Date.now()。 */
  now?: number;
  /** 未显式设置 expires_at 时的兜底 TTL（天）。默认 365。 */
  ttlFallbackDays?: number;
  /** recall_count 低于该值视为低频。默认 1。 */
  lowRecallThreshold?: number;
  /** 自创建或上次召回起超过该天数且低频 → 触发衰减。默认 180。 */
  staleDays?: number;
  /** 仅评估不打标（不写库）。默认 false。 */
  dryRun?: boolean;
}

export type RuleIdsForMemory = (memoryId: string) => string[];

export class MemoryDecayService {
  constructor(
    private readonly repo: MemoryRepository,
    /** 取某记忆派生/支撑的规则 id 列表（用于规则联动降级）。测试可传桩。 */
    private readonly getRuleIdsForMemory?: RuleIdsForMemory
  ) {}

  /** 运行一轮衰减淘汰。返回统计与受影响规则。 */
  runDecay(options: MemoryDecayOptions = {}): DecayResult {
    const now = options.now ?? Date.now();
    const ttlFallbackDays = options.ttlFallbackDays ?? 365;
    const lowRecallThreshold = options.lowRecallThreshold ?? 1;
    const staleDays = options.staleDays ?? 180;
    const dryRun = options.dryRun ?? false;

    const all = this.repo.list({ activeOnly: false });
    const details: DecayDetail[] = [];
    const ruleSet = new Set<string>();
    let archived = 0;
    let deprecated = 0;

    for (const memory of all) {
      if (memory.status === "archived") continue;

      const decision = this.evaluate(memory, now, ttlFallbackDays, lowRecallThreshold, staleDays);
      if (!decision) continue;

      if (decision.action === "archived") archived++;
      else deprecated++;

      details.push({
        memory_id: memory.id,
        info_class: memory.info_class,
        action: decision.action,
        reason: decision.reason
      });

      // 规则联动：收集受影响规则
      if (this.getRuleIdsForMemory) {
        for (const ruleId of this.getRuleIdsForMemory(memory.id)) ruleSet.add(ruleId);
      }

      if (!dryRun) this.applyOutcome(memory, decision.action, now, decision.reason);
    }

    return {
      scanned: all.length,
      archived,
      deprecated,
      rules_to_demote: [...ruleSet],
      details
    };
  }

  /**
   * 记录一次记忆召回/使用，刷新频次衰减信号。
   * 更新 recall_count++ 与 last_recalled_at，并通过 repository.apply 持久化
   * （存储层已在 P1-5 同步新增字段，JSONL 路径自动落库）。
   */
  recordUsage(memoryId: string, now: number = Date.now()): void {
    const memory = this.repo.list({ activeOnly: false }).find(m => m.id === memoryId);
    if (!memory) return;
    const updated: MemoryRecord = {
      ...memory,
      recall_count: (memory.recall_count ?? 0) + 1,
      last_recalled_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString()
    };
    this.repo.apply({ decision: "UPDATE", memory: updated, previous_id: memory.id });
  }

  // --- 内部 ---

  private evaluate(
    memory: MemoryRecord,
    now: number,
    ttlFallbackDays: number,
    lowRecallThreshold: number,
    staleDays: number
  ): { action: "archived" | "deprecated"; reason: string } | null {
    // 1) 显式 deprecated → 归档
    if (memory.state === "deprecated") {
      return { action: "archived", reason: "state 已标记为 deprecated（显式废弃）" };
    }

    // 2) 被否定 / 冲突 → 优先归档
    const meta = (memory.metadata || {}) as Record<string, unknown>;
    if (meta.conflict_with || meta.deprecated_by) {
      return { action: "archived", reason: "记忆已被否定/冲突（conflict_with/deprecated_by），优先淘汰" };
    }

    // 3) TTL 过期 → 归档
    const expiry = this.expiryOf(memory, ttlFallbackDays);
    if (expiry !== null && expiry < now) {
      return { action: "archived", reason: `TTL 已过期（expires_at=${new Date(expiry).toISOString()}）` };
    }

    // 4) 频次衰减（仅针对经验类；偏好/事实视为稳定知识，不自动淘汰）
    if (memory.info_class === "experience") {
      const recall = memory.recall_count ?? 0;
      const lastRecall = memory.last_recalled_at ? Date.parse(memory.last_recalled_at) : null;
      const anchor = lastRecall ?? Date.parse(memory.created_at);
      const staleMs = staleDays * 24 * 60 * 60 * 1000;
      if (recall < lowRecallThreshold && now - anchor > staleMs) {
        return { action: "deprecated", reason: `经验类记忆低频（recall=${recall}）且超过 ${staleDays} 天未召回，软淘汰` };
      }
    }

    return null;
  }

  private expiryOf(memory: MemoryRecord, ttlFallbackDays: number): number | null {
    if (memory.expires_at) {
      const t = Date.parse(memory.expires_at);
      if (!Number.isNaN(t)) return t;
    }
    if (typeof memory.ttl_days === "number") {
      const base = Date.parse(memory.created_at);
      if (!Number.isNaN(base)) return base + memory.ttl_days * 24 * 60 * 60 * 1000;
    }
    // 无显式 TTL 配置 → 不自动过期。TTL 是 opt-in：避免悄悄清掉所有旧记忆
    // （含稳定知识 偏好/事实），真正的低频淘汰交给频次衰减分支处理。
    void ttlFallbackDays;
    return null;
  }

  private applyOutcome(
    memory: MemoryRecord,
    action: "archived" | "deprecated",
    now: number,
    reason: string
  ): void {
    const nowISO = new Date(now).toISOString();
    const meta = { ...(memory.metadata || {}) };
    if (action === "archived") {
      meta.decay_archived_at = nowISO;
      meta.decay_reason = reason;
      this.repo.apply({
        decision: "UPDATE",
        memory: { ...memory, status: "archived", valid_to: nowISO, updated_at: nowISO, metadata: meta },
        previous_id: memory.id
      });
    } else {
      meta.decay_deprecated_at = nowISO;
      meta.decay_reason = reason;
      this.repo.apply({
        decision: "UPDATE",
        memory: { ...memory, state: "deprecated", updated_at: nowISO, metadata: meta },
        previous_id: memory.id
      });
    }
  }
}
