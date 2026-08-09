/**
 * InfoClassifier — 长期记忆「认知类别」判定器（五道关卡·三分类基础）
 *
 * 把候选信息归类为偏好(preference) / 事实(fact) / 经验(experience) 三类，
 * 或判定为一次性(one-time)信息（不进长期库）。
 *
 * 设计原则（见 docs/AUTOIMPROVE_MEMORY_GATE_OPTIMIZATION.md）：
 * - preference / experience 才可能成为规则；fact 只作上下文；one-time 不落库。
 * - 启发式先行，低置信时可通过 classifyWithLLM 升级（注入 LLMConfigManager.callWithFallback）。
 *
 * 本模块自包含，不依赖 session-analyzer 的私有方法；正则判定与 session-analyzer
 * 中的 hasCorrectiveLanguage / hasTechnicalDetail 等价，但集中到此便于复用与测试。
 */

import { InfoClass } from "./memory-models.js";

export type Sensitivity = "public" | "sensitive";

export interface InfoClassInput {
  content: string;
  patternType?: string;
  hasCorrective?: boolean;
  hasTechnicalDetail?: boolean;
}

export interface InfoClassResult {
  /** 归类结果；one-time 时为 undefined（交给关卡1 拦截） */
  info_class?: InfoClass;
  /** 判定置信度 0~1 */
  confidence: number;
  /** 是否一次性信息（不落库） */
  is_one_time: boolean;
  /** 人类可读的判定理由 */
  reason: string;
}

/** 一次性 / 请求 / 疑问 / 上下文延续 / 临时值 特征 */
const ONE_TIME_PATTERNS: RegExp[] = [
  /^(请|能不能|帮我|可以吗|麻烦|帮忙)/i,
  /^(can you|could you|please|help me|would you)/i,
  /^(how do|how to|how can|what should|should i)/i,
  /^(给我|看看|检查|分析一下)/i,
  /(能不能|可以吗|好吗|行吗)\s*[?？]?\s*$/i,
  /this session is being continued from/i,
  /summary below covers the earlier portion/i,
  /^(为什么|怎么|如何|what|why|how)\s/i,
  /^(帮我看看|帮忙梳理|请帮我)/i,
  /^(ok|okay|好的|收到|明白|明白|got it|thanks|thank you)/i,
];

/** 明确意愿 / 约定 / 规范 信号（偏好） */
const PREFERENCE_PATTERNS: RegExp[] = [
  /(我们团队|团队习惯|我更喜欢|我们约定|约定|规范|习惯|我们一般用|我们总是|以后都)/,
  /(we prefer|our team|we use|convention|we always|our practice|our convention)/i,
];

/** 纠正性语气（问题→纠正→更好做法） */
const CORRECTIVE_PATTERNS: RegExp[] = [
  /(需要|应该|必须|改成|修改|添加|使用|不要|避免|别用|记得|务必)/,
  /(need to|should|must|change to|modify|add|use|fix|prevent|don't|avoid|never|remove|remember to|always)/i,
];

/** 技术细节特征（代码片段 / 文件 / 技术术语，含中文领域词） */
const TECHNICAL_DETAIL_PATTERNS: RegExp[] = [
  /[\w]+\(.*\)/,
  /[\w]+\.\w+/,
  /`[^`]+`/,
  /\w+\.(ts|js|tsx|jsx|py|java|go|rs|c|cpp|h|css|html|json|yaml|yml|md|sql)/i,
  /(function|method|class|interface|type|const|let|var|import|export|async|await|return|useState|useEffect|def|public|private|static)/i,
  /(query|mutation|endpoint|route|handler|middleware|schema|component|service|module)/i,
  /(循环|对象|实例|函数|方法|接口|类|模块|组件|缓存|数据库|数据表|索引|线程|进程|内存|堆|栈|队列|锁|并发|异步|同步|请求|响应|服务|部署|构建|编译|测试|配置|日志|异常|错误|性能|优化|路由|中间件|消息|事件|状态|参数|变量|类型|泛型|正则|协议|端口|域名|证书|密钥|令牌|算法|编码|解码|序列化)/,
  /(GC|CPU|GPU|I\/O|IO|SQL|API|JSON|XML|HTTP|HTTPS|TCP|UDP|RPC|REST|GraphQL|OAuth|JWT)/i,
];

/** 敏感信息特征（密钥 / 路径 / 内网地址）。
 *  关键词类（api_key/secret/token/password 等）必须与赋值符 `:`/`=` 连用且后接
 *  疑似密文（≥4 个非空白字符），避免把 "refreshToken helper" 这类普通称呼误判为密钥。
 *  显式密钥格式（sk-/AKIA/ghp_ 等）则直接命中。 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/i,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /(api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key|私钥|密钥)\s*[:=]\s*["']?[^\s"']{4,}/i,
  /(?:https?|postgres|postgresql|mysql|mongodb|mongodb\+srv|redis|ftp|amqp):\/\/[^\s:@]+:[^\s:@]+@/i,
  /(C:\\[^\s]+|\/home\/[^\s]+|\/Users\/[^\s]+)/,
  /(192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\.)/,
  /(localhost|127\.0\.0\.1)/i,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some(p => p.test(text));
}

export class InfoClassifier {
  /** 启发式判定认知类别 */
  classify(input: InfoClassInput): InfoClassResult {
    const content = (input.content || "").trim();
    const lower = content.toLowerCase();

    // Q0: 一次性优先（请求 / 疑问 / 上下文延续 / 临时确认）
    if (matchesAny(ONE_TIME_PATTERNS, content)) {
      return {
        info_class: undefined,
        confidence: 0.9,
        is_one_time: true,
        reason: "命中一次性/请求/上下文延续特征，不进入长期库"
      };
    }

    const hasCorrective =
      input.hasCorrective === true || matchesAny(CORRECTIVE_PATTERNS, content);
    const hasTech =
      input.hasTechnicalDetail === true || matchesAny(TECHNICAL_DETAIL_PATTERNS, content);

    // 偏好：明确意愿/约定信号，且非单次任务上下文
    if (matchesAny(PREFERENCE_PATTERNS, content)) {
      return {
        info_class: "preference",
        confidence: 0.85,
        is_one_time: false,
        reason: "命中偏好/约定信号（we use / 我们约定 / convention 等）"
      };
    }

    // 经验：问题→纠正→更好做法（纠正语气 + 技术细节），可抽象为 do/avoid
    if (hasCorrective && hasTech) {
      return {
        info_class: "experience",
        confidence: 0.8,
        is_one_time: false,
        reason: "含纠正性语气且具技术细节，可抽象为经验规则"
      };
    }

    // 事实：陈述客观环境/结构，无纠正、无偏好语气，但具技术细节
    if (hasTech && !hasCorrective) {
      return {
        info_class: "fact",
        confidence: 0.7,
        is_one_time: false,
        reason: "陈述客观技术环境/结构，无纠正与偏好语气，仅作上下文"
      };
    }

    // 兜底：无法归类 → 默认拒绝（一次性）
    return {
      info_class: undefined,
      confidence: 0.5,
      is_one_time: true,
      reason: "无法归类到 偏好/事实/经验，默认视为一次性信息不落库"
    };
  }

  /**
   * 低置信时升级为 LLM 判定。llmCall 由调用方注入（建议接入 LLMConfigManager.callWithFallback）。
   * 未提供 llmCall 时回退到启发式结果，保证可用性。
   */
  async classifyWithLLM(
    input: InfoClassInput,
    llmCall?: (prompt: string) => Promise<string>
  ): Promise<InfoClassResult> {
    const heuristic = this.classify(input);
    if (heuristic.confidence >= 0.8 && !heuristic.is_one_time) {
      return heuristic;
    }
    if (!llmCall) return heuristic;

    const prompt =
      `请将以下用户陈述归类为长期记忆的认知类别，仅回复 preference / fact / experience / one-time 之一，并给出一句话理由。\n` +
      `陈述：${input.content}`;
    try {
      const raw = (await llmCall(prompt)).trim().toLowerCase();
      if (raw.startsWith("preference")) return { ...heuristic, info_class: "preference", confidence: 0.9, reason: "LLM 判定为偏好" };
      if (raw.startsWith("fact")) return { ...heuristic, info_class: "fact", confidence: 0.9, reason: "LLM 判定为事实" };
      if (raw.startsWith("experience")) return { ...heuristic, info_class: "experience", confidence: 0.9, reason: "LLM 判定为经验" };
      if (raw.startsWith("one-time")) return { ...heuristic, info_class: undefined, is_one_time: true, confidence: 0.9, reason: "LLM 判定为一次性" };
    } catch {
      // LLM 失败 → 回退启发式
    }
    return heuristic;
  }

  /** 敏感信息打标（关卡5：隐私可控）。命中密钥/路径/内网地址 → sensitive */
  detectSensitivity(content: string): Sensitivity {
    if (matchesAny(SENSITIVE_PATTERNS, content || "")) return "sensitive";
    return "public";
  }
}

export const infoClassifier = new InfoClassifier();
