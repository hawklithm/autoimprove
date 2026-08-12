/**
 * MemoryWriteGate — 关卡1：写入准则硬筛选（五道关卡最高优先级）
 *
 * 在记忆落库前做统一的「三问」拦截，替代原本散落在 rule-quality /
 * hybrid-rule-generator 的事后正则打补丁（那些保留为纵深防御）。
 *
 * 三问（任一为否则拒）：
 *   Q1 一次性？  → 分类器判 is_one_time → 拒（reject_reason="one-time"）
 *   Q2 跨会话复用？→ 仅当前任务/会话有效的临时上下文 → 拒（"not-reusable"）
 *   Q3 可归类？  → 无法归类到 偏好/事实/经验 → 拒（"not-classifiable"）
 *
 * 联动：候选记忆已带 info_class 时直接用；否则由 InfoClassifier 补判。
 */

import { MemoryRecord, InfoClass } from "./memory-models.js";
import { InfoClassifier, InfoClassResult, Sensitivity } from "./info-classifier.js";
import {
  PatternContentFilter,
  CODE_KEYWORDS,
  BUSINESS_KEYWORDS,
} from "./pattern-content-filter.js";
import { qualityMetrics } from "./quality-metrics.js";

export interface WriteDecision {
  persist: boolean;
  info_class?: InfoClass;
  reject_reason?: string;
}

/**
 * Phase 2 / P1: representative keyword sets reused by the fourth gate question
 * ("编程相关？"). They mirror `CODE_KEYWORDS` / `BUSINESS_KEYWORDS` from
 * `pattern-content-filter` so the whole system shares one dictionary source.
 */
export const CODE_PATTERNS: string[] = CODE_KEYWORDS;
export const BUSINESS_PATTERNS: string[] = BUSINESS_KEYWORDS;

/** 临时/一次性上下文特征（Q2） */
const EPHEMERAL_PATTERNS: RegExp[] = [
  /(build failed|编译失败|构建失败|临时|temporary|for now|目前|本次|this time|一次性的)/i,
  /(端口|port)\s*\d+/i,
  /(今天|today|刚才|just now)/i,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some(p => p.test(text));
}

export class MemoryWriteGate {
  private readonly contentFilter: PatternContentFilter;
  constructor(private readonly classifier: InfoClassifier) {
    this.contentFilter = new PatternContentFilter({
      codeKeywords: CODE_PATTERNS,
      businessKeywords: BUSINESS_PATTERNS,
    });
  }

  shouldPersist(candidate: MemoryRecord): WriteDecision {
    const cls = this.resolveClass(candidate);

    // Q1 / Q3：一次性或无法归类 → 拒
    if (cls.is_one_time || cls.info_class === undefined) {
      return {
        persist: false,
        info_class: undefined,
        reject_reason: cls.is_one_time ? "one-time" : "not-classifiable"
      };
    }

    // Q4：编程相关？ 非代码内容（业务/产品/营销）一律拒绝，避免 rule-001 类问题
    if (this.isBusinessContent(candidate.content)) {
      qualityMetrics.recordMemoryRejection("non-code-content");
      return { persist: false, info_class: cls.info_class, reject_reason: "non-code-content" };
    }

    // Q2：跨会话 / 跨任务可复用？
    if (this.isEphemeral(candidate)) {
      return { persist: false, info_class: cls.info_class, reject_reason: "not-reusable" };
    }

    return { persist: true, info_class: cls.info_class };
  }

  /** Q4：内容是否为非编程（业务）内容 —— 由共享的内容过滤器判定 */
  isBusinessContent(content: string): boolean {
    return !this.contentFilter.isCodeRelated(content).allowed;
  }

  /** 候选已带 info_class 直接用，否则由分类器补判 */
  private resolveClass(candidate: MemoryRecord): InfoClassResult {
    if (candidate.info_class) {
      return {
        info_class: candidate.info_class,
        confidence: 1,
        is_one_time: false,
        reason: "候选已携带 info_class"
      };
    }
    return this.classifier.classify({ content: candidate.content });
  }

  /** Q2：仅当前任务/会话有效的临时上下文 */
  private isEphemeral(candidate: MemoryRecord): boolean {
    return matchesAny(EPHEMERAL_PATTERNS, candidate.content);
  }

  /** 复用于 pattern 级别的认知类别判定（供事件驱动触发 / 关卡2 使用） */
  classifyContent(content: string): InfoClassResult {
    return this.classifier.classify({ content });
  }

  /** 关卡5·隐私可控：对候选内容做敏感信息打标（密钥/路径/内网地址等）。 */
  classifySensitivity(content: string): Sensitivity {
    return this.classifier.detectSensitivity(content);
  }
}
