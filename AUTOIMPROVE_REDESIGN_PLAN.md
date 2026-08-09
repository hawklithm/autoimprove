# AutoImprove 规则质量提升改造方案

> 基于 2026-08-09 全链路分析诊断，解决"规则鸡肋"的四大根因，按优先级排序实施。

---

## 现状诊断回顾

| 根因 | 症状 | 影响 |
|------|------|------|
| Pattern 信息密度低 | `description` 只有一句摘要，缺原始上下文 | LLM 扩写规则时凭空脑补细节 |
| Pattern / Memory 双轨脱节 | Pattern 驱动规则生成，Memory 只作追溯 | MemoryPromotion 算出的 scope 不被消费 |
| Fact 无升级路径 | `fact` 被硬拦截，永不成规则 | "用 PgBouncer transaction pooling" 这类有价值经验被丢弃 |
| Scope 无统一仲裁 | 3 条独立路径各自写 scope，互相覆盖 | 最后写入的值决定 scope，无优先级逻辑 |

---

## 方向 1：Pattern 携带原始上下文

### 目标

让规则生成器能拿到 Pattern 对应的**原始用户消息**（不是 150 字截取摘要），LLM 据此推理出有血有肉的规则。

### 现状

- `MessageCluster.candidates[].message.content` 已有完整原始消息
- `PatternOccurrence.user_input` 已保存截断版（前 200 字符）
- `hybrid-rule-generator` 已从 `occurrences[].user_input` 提取证据片段（最后 5 条），但限 20 字符以上
- **问题**：200 字符对于技术对话仍不够——一条修正消息可能是："不对，useEffect 里面不能直接 setState，会触发无限重渲染。应该用 useMemo 或者把状态提升到父组件。如果非要在 effect 里操作，至少加个条件判断或者用 ref 标记"

### 改动方案

#### 1.1 扩展 Pattern 模型

**文件**: `src/mcp-server-ts/src/core/models.ts`

```diff
 export interface Pattern {
   type: PatternType;
   description: string;
   occurrences: PatternOccurrence[];
   first_seen: string;
   last_seen: string;
   confidence: number;
   category?: string;
   priority?: Priority;
   keywords: string[];
   project_paths?: string[];
   info_class?: InfoClass;
+  /** 原始消息摘录（3-5 条），供规则生成器 LLM 直接引用 */
+  evidence_excerpts?: string[];
 }
```

#### 1.2 在检测器中捕获原始消息

**文件**: `src/mcp-server-ts/src/core/session-analyzer.ts`

修改 `detectRepeatedCorrections`（第 620-629 行），在创建 Pattern 时追加 evidence_excerpts：

```typescript
// 现有代码（第 620 行附近）：
const pattern = createPattern({
  type: PatternType.REPEATED_CORRECTION,
  description: this.generateClusterDescription(cluster),
  occurrences: cluster.candidates.map(c => c.occurrence),
  first_seen: cluster.candidates[0].occurrence.timestamp,
  last_seen: cluster.candidates[cluster.candidates.length - 1].occurrence.timestamp,
  keywords: cluster.keywords
});

// 改为：
const evidence_excerpts = cluster.candidates
  .slice(0, 5)  // 最多 5 条
  .map(c => c.message.content.trim())
  .filter(c => c.length > 10);

const pattern = createPattern({
  ...existing,
  evidence_excerpts
});
```

需要在 `createPattern` 调用中传入该字段。同样修改其他 4 个检测器（`detectAntiPatterns`、`detectPreferences`、`detectPerformancePatterns`、`detectSecurityPatterns`）。

#### 1.3 RuleGenerator 消费 evidence_excerpts

**文件**: `src/mcp-server-ts/src/core/hybrid-rule-generator.ts`

在 `buildEnhancementPrompt` 中（第 553 行附近），将 evidence 提取源从 `occurrences[].user_input`（截断版）改为优先使用 `pattern.evidence_excerpts`：

```typescript
// 现有：
const contextExamples = pattern.occurrences
  .filter(o => o.user_input && o.user_input.length > 20)
  .slice(-5)

// 改为：
const evidenceSource = (pattern.evidence_excerpts?.length ?? 0) > 0
  ? pattern.evidence_excerpts
  : pattern.occurrences.map(o => o.user_input).filter(Boolean);

const contextExamples = evidenceSource
  .filter(t => t && t.length > 20)
  .slice(-5)
  .map((text, i) => `${i + 1}. User: ${text}`)
  .join('\n\n');
```

#### 1.4 同步到 basic-rule-generator

**文件**: `src/mcp-server-ts/src/core/rule-generator.ts`

在 `generateContent` 中，当 pattern.evidence_excerpts 存在时，附加到生成的 content 中作为 "原始上下文" 字段。

### 影响范围

| 文件 | 改动类型 |
|------|---------|
| `models.ts` | 新增字段 |
| `session-analyzer.ts` (5 个检测器) | 捕获原始消息 |
| `hybrid-rule-generator.ts` | 使用新字段 |
| `rule-generator.ts` | 使用新字段 |
| `batch-llm-rule-generator.ts` | 使用新字段（如有 evidence 提取） |

---

## 方向 2：统一 Pattern / Memory 双轨

### 目标

让 Memory（携带完整证据链 + 跨会话统计 + LLM 泛化结果）成为规则生成的主驱动，Pattern 降级为快速信号。MemoryPromotion 的产出被 generate_rules 完整消费。

### 现状分析

```
当前流程：
  JSONL → Pattern[] (5 个检测器)
               ↓
       generate_rules(pattern_json)
               ↓
       promoteEligibleWithLLM()  ← 只影响 memory state，不影响规则内容
               ↓
       hybrid/basic/template generator ← 只用 Pattern.description 生成内容
               ↓
       findSupportingMemoryIds()  ← 事后追溯，不影响生成
```

MemoryPromotion 的产出（`promotion_score`, `promotion_scope`, `generalization_confidence`）存在 `metadata` 里，但规则生成阶段**完全不读**。Pattern 到 Rule 走的是独立路径。

### 改动方案

#### 2.1 新增 `MemoryRuleInput` 适配层

**新建文件**: `src/mcp-server-ts/src/core/memory-rule-adapter.ts`

将 promoted Memory 转换为规则生成器可消费的富输入格式：

```typescript
import { MemoryRecord, MemoryEvidence } from "./memory-models.js";
import { Pattern, PatternOccurrence } from "./models.js";

export interface MemoryRuleInput {
  /** 记忆完整内容（优先于 Pattern.description） */
  content: string;
  /** 摘要 */
  summary: string;
  /** 三分类 */
  info_class: "preference" | "fact" | "experience";
  /** 认知类型映射到的 PatternType */
  pattern_type: string;
  /** 原始证据链（完整消息内容） */
  evidence: MemoryEvidence[];
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
  /** 关联的 Pattern（如有） */
  source_pattern?: Pattern;
  /** 关联的 scope context */
  scope_context?: {
    project_path?: string;
    organization_id?: string;
    repository?: string;
    branch?: string;
  };
  /** 场景 */
  scene?: { tech: string[]; functional: string[]; business: string[] };
}
```

核心方法：

```typescript
export class MemoryRuleAdapter {
  /**
   * 将 promoted MemoryRecord 转换为 MemoryRuleInput
   */
  static fromPromotedMemory(memory: MemoryRecord): MemoryRuleInput {
    const evidence_excerpts = memory.evidence
      .filter(e => e.source_excerpt && e.source_excerpt.length > 10)
      .map(e => e.source_excerpt!);

    return {
      content: memory.content,
      summary: memory.summary,
      info_class: memory.info_class || "experience",
      pattern_type: memoryToPatternType(memory),
      evidence: memory.evidence,
      stats: {
        independent_sessions: memory.independent_session_count || 1,
        independent_projects: memory.independent_project_count || 0,
        validation_count: memory.validation_count || 0,
        contradiction_count: memory.contradiction_count || 0,
      },
      promotion: {
        score: memory.metadata?.promotion_score ?? memory.confidence,
        scope: memory.metadata?.promotion_scope ?? "project",
        confidence: memory.metadata?.generalization_confidence ?? 0.5,
        reason: memory.metadata?.promotion_reason ?? "",
      },
      scope_context: {
        project_path: memory.namespace?.project_path,
        organization_id: memory.namespace?.organization_id,
        repository: memory.namespace?.repository,
        branch: memory.namespace?.branch,
      },
      evidence_excerpts,
    };
  }
}
```

#### 2.2 handleGenerateRules 改用 Memory 作为主输入

**文件**: `src/mcp-server-ts/src/index.ts` (第 1687 行附近)

新增参数 `use_memory_driven: boolean`（默认 true，渐进迁移）。当 `use_memory_driven=true` 时：

```typescript
async function handleGenerateRules(args: any) {
  const patternsJson = args.patterns_json as string;
  const useMemoryDriven = args.use_memory_driven !== false; // 默认 true
  // ... existing params ...

  // ---- 新增：Memory 驱动路径 ----
  if (useMemoryDriven) {
    // 1. 先跑 MemoryPromotion（原有逻辑）
    const promotedMemories = await memoryPromotion.promoteEligibleWithLLM();
    
    // 2. 将 promoted memories 转为规则生成输入
    const memoryInputs = promotedMemories.map(m => 
      MemoryRuleAdapter.fromPromotedMemory(m)
    );
    
    // 3. 调用新的 memory-driven 规则生成器
    rules = await generateRulesFromMemories(memoryInputs, nextIdNum, scene, {
      useLLMEnhancement,
      extractCodeExamples,
      sessionDir,
      maxExamples,
    });
    
    // 4. 对 patterns 也走一遍（作为补充信号），但 priority 降低
    if (patterns.length > 0) {
      const patternRules = await hybridGenerator.batchGenerateEnhancedRules(
        patterns, nextIdNum + rules.length, scene, { ... }
      );
      rules = rules.concat(patternRules);
    }
    
    // 跳过原有的 pattern-only 生成路径
  } else {
    // ... 原有逻辑 ...
  }
}
```

#### 2.3 新增 Memory-driven 规则内容生成

**文件**: `src/mcp-server-ts/src/core/hybrid-rule-generator.ts`

新增方法 `generateRuleFromMemory(memoryInput: MemoryRuleInput, ruleId: string, scene?: Scene)`:

1. 构建 LLM prompt——**比 Pattern 版本丰富得多**：
   - 完整 `content`（不是截断摘要）
   - 原始证据链（完整消息内容，不是 user_input 截断）
   - 跨会话统计（`sessions: 3, projects: 2, validations: 1`）
   - 已有 scope 判断（`promotion.scope: organization, confidence: 0.85`）
   
2. LLM 只需做：扩写内容、生成代码示例、确认异常条件、关联规则——**不需要凭空泛化**，因为 scope 已经有了。

```
Prompt 模板：

基于以下「已验证的程序性记忆」生成一条编码规则：

【记忆内容】
${memory.content}

【原始证据】（来自 ${stats.sessions} 个会话）
${evidence_excerpts}

【统计信息】
- 跨 ${stats.independent_sessions} 个独立会话复发
- 跨 ${stats.independent_projects} 个项目出现
- 验证次数：${stats.validation_count}
- 冲突次数：${stats.contradiction_count}

【范围判断】
已通过 LLM 泛化评估，建议 scope = ${promotion.scope}（置信度 ${promotion.confidence}）

请生成包含以下字段的规则 JSON：
- title, description, reason, how_to_apply[], examples[], when_to_use[], exceptions[]
- scope 请以建议值为准（不要擅自改为 global）
```

#### 2.4 保留 Pattern 路径作为降级

当 `use_memory_driven=false` 或没有 promoted memories 时，回退到原有的 Pattern-only 生成路径。这样保证向后兼容，渐进迁移。

### 影响范围

| 文件 | 改动类型 |
|------|---------|
| **新建** `memory-rule-adapter.ts` | 适配层 |
| `index.ts` (handleGenerateRules) | 新增 memory-driven 分支 |
| `hybrid-rule-generator.ts` | 新增 `generateRuleFromMemory` |
| `MCP_TOOLS_API.md` | 文档更新 |

---

## 方向 3：Fact 升级路径

### 目标

`fact` 分类的记忆（客观环境/技术知识）在满足条件时可以被升级为 `experience`（可成规则），而不是被永久硬拦截。

### 现状

在 `info-classifier.ts` 中，fact 的判定条件：含技术细节 + 无纠正语气。在 `memory-promotion.ts` 中：

```typescript
if (memory.info_class === "fact") {
  return { eligible: false, score: 0, reason: "fact 只作上下文，不成规则" };
}
```

这意味着：用户说了 "PgBouncer transaction pooling 模式能显著提升性能" → fact → 永不升为规则。

### 改动方案

#### 3.1 新建 FactUpgrader

**新建文件**: `src/mcp-server-ts/src/core/fact-upgrader.ts`

```typescript
import { MemoryRecord } from "./memory-models.js";

export interface UpgradeDecision {
  should_upgrade: boolean;
  upgraded_kind: "semantic" | "procedural";
  upgraded_class: "fact" | "experience";
  reason: string;
  confidence: number;
}

export class FactUpgrader {
  /** 评估是否应该将 fact 升级为可成规则的 experience */
  evaluate(memory: MemoryRecord): UpgradeDecision {
    if (memory.info_class !== "fact") {
      return { should_upgrade: false, upgraded_kind: memory.kind, 
               upgraded_class: "fact", reason: "not a fact", confidence: 0 };
    }

    const checks: Array<{ name: string; passed: boolean; weight: number }> = [
      {
        name: "高召回率",
        passed: (memory.recall_count || 0) >= 3,
        weight: 0.4,
      },
      {
        name: "用户显式确认",
        passed: memory.outcome?.user_confirmed === true,
        weight: 0.3,
      },
      {
        name: "跨会话复用",
        passed: (memory.independent_session_count || 0) >= 2,
        weight: 0.2,
      },
      {
        name: "关联到经验证据链",
        passed: this.hasExperienceLink(memory),
        weight: 0.1,
      },
    ];

    const passedChecks = checks.filter(c => c.passed);
    const score = passedChecks.reduce((sum, c) => sum + c.weight, 0);

    // 至少满足两个条件或总分 >= 0.5
    const shouldUpgrade = passedChecks.length >= 2 || score >= 0.5;

    return {
      should_upgrade: shouldUpgrade,
      upgraded_kind: "procedural",
      upgraded_class: "experience",
      reason: shouldUpgrade
        ? `满足 ${passedChecks.length} 个升级条件 (${passedChecks.map(c => c.name).join(", ")})，总分 ${score.toFixed(2)}`
        : `仅满足 ${passedChecks.length} 个条件，不满足升级阈值`,
      confidence: score,
    };
  }

  /** 执行升级：修改 kind 和 info_class，记录元数据 */
  upgrade(memory: MemoryRecord, decision: UpgradeDecision): MemoryRecord {
    return {
      ...memory,
      kind: decision.upgraded_kind,
      info_class: decision.upgraded_class,
      state: "observed",  // 重置状态，让 promotion 重新评估
      metadata: {
        ...(memory.metadata || {}),
        upgraded_from: "fact",
        upgrade_reason: decision.reason,
        upgrade_confidence: decision.confidence,
        upgrade_timestamp: new Date().toISOString(),
      },
    };
  }
}
```

#### 3.2 集成到 MemoryPromotion

**文件**: `src/mcp-server-ts/src/core/memory-promotion.ts`

在 `evaluate()` 的 fact 拦截之前，调用 FactUpgrader：

```typescript
evaluate(memory: MemoryRecord): PromotionDecision {
  // ---- 新增：Fact 升级检查 ----
  if (memory.info_class === "fact") {
    const upgradeDecision = this.factUpgrader.evaluate(memory);
    if (upgradeDecision.should_upgrade) {
      const upgraded = this.factUpgrader.upgrade(memory, upgradeDecision);
      this.store.apply({ decision: "UPDATE", memory: upgraded, previous_id: memory.id });
      // 用升级后的记忆继续评估
      return this.evaluate(upgraded); // 递归（注意防无限：升级后的 info_class 已变为 "experience"）
    }
    return { eligible: false, score: 0, reason: "fact 只作上下文，不成规则" };
  }
  // ... 原有逻辑 ...
}
```

或者在 `handleGenerateRules` 中，在 `promoteEligibleWithLLM()` 调用之前执行全局 fact 升级：

```typescript
// 在 handleGenerateRules 中（第 1754 行之前）：
const factUpgrader = new FactUpgrader();
const facts = memoryStore.list({ activeOnly: true, info_class: "fact" });
let upgradedCount = 0;
for (const fact of facts) {
  const decision = factUpgrader.evaluate(fact);
  if (decision.should_upgrade) {
    const upgraded = factUpgrader.upgrade(fact, decision);
    memoryStore.apply({ decision: "UPDATE", memory: upgraded, previous_id: fact.id });
    upgradedCount++;
  }
}
if (upgradedCount > 0) {
  logger.info("fact-upgrade", `Upgraded ${upgradedCount} facts to experience`);
}

// 然后继续 promotion
const promotedMemories = await memoryPromotion.promoteEligibleWithLLM();
```

#### 3.3 升级条件触发

在以下时机调用 FactUpgrader：

| 时机 | 位置 | 说明 |
|------|------|------|
| `generate_rules` 调用前 | `handleGenerateRules` 第 1754 行前 | 每条规则生成前先检查是否有可升级 fact |
| `search_memory` 调用后 | 相关 handler | 召回时增加 `recall_count`，触发下次升级检查 |
| `record_feedback` 后 | 相关 handler | 用户确认后可升级关联 fact |

### 影响范围

| 文件 | 改动类型 |
|------|---------|
| **新建** `fact-upgrader.ts` | 升级器 |
| `memory-promotion.ts` | 集成调用 |
| `index.ts` (handleGenerateRules) | 全局升级检查 |
| `index.ts` (search/feedback handlers) | 触发条件 |

---

## 方向 4：Scope 统一仲裁器

### 目标

Scope 分配集中在一个 `ScopeResolver` 中，整合三条独立路径的结果，按优先级加权仲裁，输出最终 scope。

### 现状

三条路径各自写 scope：

```
路径1: ScopeDetector.detectScope(pattern)      → heuristic scope
路径2: MemoryPromotion.evaluateGeneralization() → promotion_scope (metadata)
路径3: hybrid-rule-generator LLM CC-scope       → 直接覆盖 RuleIndexEntry.scope
       Phase4 RAG-scope                         → 再次覆盖

结果：最后写入的值决定 scope，无优先级，MemoryPromotion 的统计结果被丢弃
```

### 改动方案

#### 4.1 新建 ScopeResolver

**新建文件**: `src/mcp-server-ts/src/core/scope-resolver.ts`

```typescript
import { RuleScope, Pattern } from "./models.js";
import { MemoryRecord } from "./memory-models.js";

export interface ScopeInput {
  /** ScopeDetector 的启发式结果 */
  heuristic?: {
    scope: RuleScope;
    confidence: number;
    reason: string;
  };
  /** MemoryPromotion 的泛化结果（跨项目统计 + LLM 泛化） */
  promotion?: {
    scope: "project" | "organization" | "global";
    confidence: number;
    reason: string;
    project_count: number;
    organization_count: number;
  };
  /** LLM 在规则生成阶段的 scope 建议 */
  llm_suggestion?: {
    scope: "project" | "organization" | "global";
    confidence: number;
    reason: string;
  };
  /** 项目上下文 */
  context?: {
    project_path?: string;
    organization_id?: string;
    repository?: string;
    branch?: string;
  };
}

export interface ScopeResult {
  scope: RuleScope;
  confidence: number;
  reason: string;
  /** 各来源的权重贡献 */
  contributions: Array<{
    source: "heuristic" | "promotion" | "llm";
    scope: string;
    weight: number;
    contribution: number;
  }>;
}

export class ScopeResolver {
  /**
   * 仲裁逻辑：
   * 
   * 1. promotion 权重最高 (0.50) —— 基于跨项目统计 + LLM 泛化，最可靠
   * 2. llm_suggestion 权重中等 (0.30) —— LLM 在规则生成时的判断
   * 3. heuristic 权重最低 (0.20) —— 关键词匹配，最不可靠
   * 
   * 安全护栏：
   * - promotion 判定 non-global 时，LLM 不能单独推到 global
   * - heuristic 判定 GLOBAL 时权重降半（因为默认 GLOBAL 太宽松）
   * - 所有来源缺失时默认 PROJECT（最安全）
   */
  resolve(input: ScopeInput): ScopeResult {
    const votes = new Map<string, number>();
    const contributions: ScopeResult["contributions"] = [];

    // promotion 投票（权重 0.50）
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

    // llm 投票（权重 0.30，但被 promotion 约束）
    if (input.llm_suggestion) {
      let weight = 0.30;
      // 安全护栏：promotion 判为非 global 时，LLM 的 global 建议降权
      if (input.promotion && input.promotion.scope !== "global" && 
          input.llm_suggestion.scope === "global") {
        weight = 0.10; // 强行降权
      }
      votes.set(input.llm_suggestion.scope, (votes.get(input.llm_suggestion.scope) || 0) + weight);
      contributions.push({
        source: "llm",
        scope: input.llm_suggestion.scope,
        weight,
        contribution: weight,
      });
    }

    // heuristic 投票（权重 0.20，但默认 GLOBAL 降权）
    if (input.heuristic) {
      let weight = 0.20;
      // 安全护栏：heuristic 默认 GLOBAL 且置信度低时降权
      if (input.heuristic.scope === "global" && input.heuristic.confidence < 0.7) {
        weight = 0.10;
      }
      votes.set(input.heuristic.scope, (votes.get(input.heuristic.scope) || 0) + weight);
      contributions.push({
        source: "heuristic",
        scope: input.heuristic.scope,
        weight,
        contribution: weight,
      });
    }

    // 得出最终结果
    let finalScope: RuleScope = RuleScope.PROJECT; // 默认最安全
    let maxVote = 0;
    for (const [scope, vote] of votes) {
      if (vote > maxVote) {
        maxVote = vote;
        finalScope = scope as RuleScope;
      }
    }

    const confidence = Math.min(1, maxVote / 0.80); // 归一化到 0-1

    return {
      scope: finalScope,
      confidence,
      reason: `Weighted vote: ${Array.from(votes.entries())
        .map(([s, v]) => `${s}=${v.toFixed(2)}`)
        .join(", ")} → ${finalScope}`,
      contributions,
    };
  }

  /**
   * 从 MemoryRuleInput 快捷构建 ScopeInput
   */
  static fromMemoryRuleInput(input: {
    promotion?: { scope: string; confidence: number; reason: string };
    scope_context?: { project_path?: string; organization_id?: string };
  }, pattern?: Pattern): ScopeInput {
    return {
      promotion: input.promotion ? {
        scope: input.promotion.scope as "project" | "organization" | "global",
        confidence: input.promotion.confidence,
        reason: input.promotion.reason,
        project_count: 0, // 后续填充
        organization_count: 0,
      } : undefined,
      context: {
        project_path: input.scope_context?.project_path,
        organization_id: input.scope_context?.organization_id,
      },
    };
  }
}
```

#### 4.2 集成到规则生成路径

**文件**: `src/mcp-server-ts/src/core/hybrid-rule-generator.ts`

在 `generateEnhancedRule` 的阶段 1.5（第 119 行），将 ScopeDetector 结果 + LLM scope 建议**都传入 ScopeResolver**，而不是直接覆盖：

```typescript
// 现有（第 119-147 行）:
const scopeContext = this.scopeDetector.detectScope(pattern, scopeSessionData);
basicRule.indexEntry.scope = scopeContext.scope;
// ... LLM CC-scope ...
basicRule.indexEntry.scope = llmScope.scope; // 直接覆盖

// 改为:
const heuristicScope = this.scopeDetector.detectScope(pattern, scopeSessionData);
// 收集 promotion scope（如果有关联的 promoted memory）
const promotionScope = this.getPromotionScopeForPattern(pattern);
// LLM scope 建议
const llmSuggestion = this.getLLMScopeSuggestion(pattern);
// 统一仲裁
const scopeResult = this.scopeResolver.resolve({
  heuristic: {
    scope: heuristicScope.scope,
    confidence: heuristicScope.confidence || 0.5,
    reason: heuristicScope.reason || "",
  },
  promotion: promotionScope,
  llm_suggestion: llmSuggestion,
  context: { project_path: scopeSessionData?.project_path },
});
// 最终写入
basicRule.indexEntry.scope = scopeResult.scope;
basicRule.indexEntry.scope_confidence = scopeResult.confidence;
basicRule.indexEntry.scope_reason = scopeResult.reason;
```

#### 4.3 在 handleGenerateRules memory-driven 路径中使用

当走 memory-driven 路径时，MemoryRuleInput 已携带 `promotion.scope`，直接传给 ScopeResolver 作为 promotion 来源，不再需要 ScopeDetector。

### 影响范围

| 文件 | 改动类型 |
|------|---------|
| **新建** `scope-resolver.ts` | 仲裁器 |
| `hybrid-rule-generator.ts` | 替换 scope 赋值逻辑 |
| `batch-llm-rule-generator.ts` | 替换 scope 赋值逻辑 |
| `index.ts` (handleGenerateRules) | memory-driven 路径使用 |

---

## 实施顺序与依赖

```
Phase 1: 方向1（Pattern 携带原始上下文）
  依赖：无
  影响：5 个检测器 + 所有规则生成器
  原因：底层改动，后续方向依赖更好的输入质量
  
Phase 2: 方向4（Scope 统一仲裁器）
  依赖：无
  影响：hybrid-rule-generator, batch-llm-rule-generator
  原因：基础设施，不依赖其他方向
  
Phase 3: 方向3（Fact 升级路径）
  依赖：方向4（升级后需要 scope 仲裁）
  影响：info-classifier, memory-promotion, handleGenerateRules
  原因：需要 scope 仲裁来判定升级后的规则范围
  
Phase 4: 方向2（统一双轨）
  依赖：方向1 + 方向3 + 方向4
  影响：handleGenerateRules, hybrid-rule-generator（新增方法）, memory-rule-adapter（新建）
  原因：需要 pattern 有原始上下文 + fact 能升级 + scope 已统一，才能完整切换
```

## 测试策略

| 阶段 | 测试内容 | 测试方式 |
|------|---------|---------|
| Phase 1 | evidence_excerpts 在检测器中正确捕获 | 单元测试：构造 MessageCluster，验证在 Pattern 中 |
| Phase 1 | hybrid/basic generator 正确消费新字段 | 集成测试：喂入带 evidence_excerpts 的 Pattern，检查 prompt 内容 |
| Phase 2 | ScopeResolver 仲裁逻辑 | 单元测试：多种组合的投票结果 |
| Phase 2 | promotion 约束 LLM global 建议 | 单元测试：promotion.project + llm.global → 最终 project |
| Phase 3 | FactUpgrader 触发条件 | 单元测试：各种 recall_count/session_count 组合 |
| Phase 3 | fact 升级→ promotion 链路 | 集成测试：升级后的记忆能被 promote |
| Phase 4 | MemoryRuleInput 适配 | 单元测试：MemoryRecord ↔ MemoryRuleInput 转换 |
| Phase 4 | memory-driven 规则生成 | 端到端：feed promoted memory → 拿到规则 → 验证 scope/content |

---

## 向后兼容

- `use_memory_driven` 默认值为 `true`，但不传或传 `false` 时回退到原有 Pattern-only 路径
- `evidence_excerpts` 为可选字段，不存在时 generator 仍用 `occurrences[].user_input`
- `ScopeResolver` 在各来源缺失时优雅降级（默认 PROJECT）
- `FactUpgrader` 不满足条件时保持 fact 原有行为（不升级）

---

## 预期效果

| 指标 | 当前 | 改造后预期 |
|------|------|-----------|
| 规则信息密度 | 一句摘要（~150 字） | 完整原始上下文 + 统计信息 |
| Scope 准确率 | 大概率 GLOBAL（默认） | 加权仲裁，project/organization 准确分配 |
| Fact 利用率 | 0%（硬拦截） | 高召回 fact 可升级为规则 |
| Pattern/Memory 一致性 | 双轨脱节 | Memory 为主，Pattern 为辅 |
| LLM 扩写质量 | 凭空脑补 | 基于证据链 + 统计信息推理 |
