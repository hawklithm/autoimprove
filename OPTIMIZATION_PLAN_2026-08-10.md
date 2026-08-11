# AutoImprove · summarize 效果优化方案

> 基于 2026-08-10 真实跑评（24 个 WorkBuddy 会话 / LLM 增强 / `--min-confidence 0.2` → 47 规则 + 174 记忆）。
> 目标：修复评估发现的 5 个缺陷，让 summarize 产出的规则"有源、同语、低噪、可用"。

---

## 0. 评估回顾（一句话）

| 项 | 结果 |
|---|---|
| 规则 | 47 条（preference 6 / repeated-correction 3 / anti-pattern 12 / performance 13 / security 13） |
| 记忆 | 174 条（semantic 29 / procedural 137 / episodic 8；status: active 164 / superseded 10） |
| 聚类 | 67 簇 → 47 规则（仅 6 条发生跨 pattern 合并） |
| 分数 | 置信度/质量分 avg≈0.71；scope_confidence avg 0.90 |
| **异常** | **source_memory_ids 全空、memory_support_score 全 0.5、规则正文 100% 英文** |

---

## 缺陷 A：规则与记忆完全脱节（最关键，P0）

**现象**：47 条规则的 `source_memory_ids` 全部为空数组，`memory_support_score` 被写死 0.5，平均关联记忆数 = 0。系统抽出了 174 条 `status:active` 记忆，却没和任何规则建立链接。

**根因（已定位）**：
- `MemoryConsolidator` 自己开一个 repo 实例：`this.store = store || createDefaultMemoryRepository()`（`memory-consolidator.ts:15-16`）。
- `SessionAnalyzer` 构造时**未传入** store：`this.memoryConsolidator = new MemoryConsolidator()`（`session-analyzer.ts:53`）→ 与引擎各持一个独立实例。
- 引擎的 `this.memoryStore = createDefaultMemoryRepository()` 在引擎构造时（**分析之前**）建好（`batch-rebuild.ts:127`），JSONL 后端的 `MemoryStore` 在构造时 `load()` 读文件（`memory-store.ts:127`），此时文件为空 → 内存 `Map` 为空。
- Step 4 由 `SessionAnalyzer` 经它自己的 `MemoryConsolidator` 把 174 条记忆写进 `memories.jsonl`，但**引擎的 store 永不 reload** → Step 7 `findSupportingMemories` 查引擎的空 `Map` → `findRelevantMemoryIds` 返回 `[]` → `score = FALLBACK_MEMORY_SUPPORT(0.5)`（`memory-support.ts:108-128`、`batch-rebuild.ts:506-518`）。
- 注意：`BatchLLMRuleGenerator.convertToStorageFormat` 内部也再算一次（`:813-824`），但它用的 `this.memoryStore` 正是引擎传进去的**同一个空实例**（`:131`），所以两处都得到空链接——根因同一。

**与缺陷 E 同源**：记忆 164 条都是 `status:active`，所以 `activeOnly` 过滤**不是**原因；空链接纯粹是 JSONL 后端的"实例隔离 + 不 reload"导致。若后端是 SQLite（共享文件），引擎的 store 会直接读到已写入的记忆，A 不会显现。

**修复方案（P0，两项互补）**：
- **A1（主，架构正确）共享 MemoryRepository 实例**：给 `SessionAnalyzer` 增加可选 `memoryStore` 构造参数，转发给 `MemoryConsolidator`。引擎构造时 `new SessionAnalyzer(this.memoryStore)`。这样 Step 4 写入的记忆直接进入引擎的 `Map`，Step 7 天然可见。对 SQLite 后端也无害。
- **A2（兜底）增加 reload 安全网**：`MemoryStore` 增加 `reload()`（重读 `memories.jsonl` 覆盖 `Map`），在 `batch-rebuild.ts` Step 7 前调用 `this.memoryStore.reload?.()`（SQLite 实现为 no-op）。即使 A1 未覆盖的其它写入路径也能看到记忆。
- **顺带清理**：引擎在 `:351-368` 与生成器在 `:813` 重复计算了 memory support，统一以引擎最终值覆盖即可，无需改逻辑。

**验证**：重跑后 `source_memory_ids` 非空、`memory_support_score` 出现非 0.5 分布、`avgSourceMemories > 0`。

---

## 缺陷 E：记忆后端静默回退 SQLite → JSONL（P0，与 A 同源）

**现象**：`memory.sqlite` 为 0 字节，`memories.jsonl` 841KB——实际走了 JSONL 分支。

**根因**：`createDefaultMemoryRepository()` 用 `try { return new SQLiteMemoryStore() } catch { return new MemoryStore() }`（`memory-sqlite-store.ts:234-243`）。本次 `new Database()` 抛错被吞，回退 JSONL。抛错原因与本仓库历史一致——`better-sqlite3` 预编译于 Node 24（ABI 137），而运行时是受管 Node 22（ABI 127），原生模块加载失败。

**修复方案（P0）**：
- **E1 修 ABI**：在 `src/mcp-server-ts` 下 `npm rebuild better-sqlite3`（或用受管 Node 22 重新编译预构建），让 SQLite 真正可用。**修好 E 会顺带让 A 在 SQLite 路径下自然消失**，但仍建议同时做 A1/A2 以防 JSONL 路径。
- **E2 后端选择显式化 + 告警**：catch 分支里 `logger.warn("memory backend fell back to JSONL (sqlite unavailable)")`，让回退不再静默；可选新增 env `AUTOIMPROVE_MEMORY_BACKEND=sqlite|jsonl` 强制指定，便于排查与一致性。
- **E3（可选）** 评估统一内存仓库：长期可让全进程只用一个 `MemoryRepository` 单例（依赖注入容器），彻底消除实例隔离类问题。

---

## 缺陷 B：规则语言错配（中文会话 → 英文规则，P1）✅ 已修复

**现象**：源会话是中文，但 47 条规则正文 100% 英文（`ruleLangDist:{zh:0,en:47,mixed:0}`），中文只以散 token 泄漏进 keywords。

**根因**：`LLMPromptBuilder.buildPrompt`（`llm-prompt-builder.ts:63`）的指令写死英文（"You are analyzing patterns from Claude Code sessions..."，`285` 行起），没有任何"按源语言输出"的约束，LLM 默认英文。

**修复方案（P1）**：
- **B1 证据语言检测 + 输出语言指令**：在 `PromptOptions` 增加 `outputLanguage?`；新增 `detectLanguage(text)`（检测 CJK/中文占比）。`buildPrompt` 在 instructions 段追加："请使用与源对话相同的语言输出规则（检测到中文则用中文撰写标题与说明）"。英文会话保持英文。
- **B2 配置默认语言**：`LLMConfigManager` 增加 `defaultRuleLanguage`（默认 `auto`，从 env `AUTOIMPROVE_RULE_LANGUAGE`/`LLM_RULE_LANGUAGE` 读取），允许用户强制 `zh`/`en`。
- 落点：`llm-prompt-builder.ts` 的 instructions 段与 `batch-llm-rule-generator.ts:303`、`llm-rule-generator.ts:106` 的 `buildPrompt` 调用处。
- **验证**：`tests/p1b-language.test.ts`（12 用例）覆盖 detectLanguage、auto/zh/en 指令注入、config 读取。重跑后 `ruleLangDist.zh > 0`。

---

## 缺陷 C：噪声规则（通用最佳实践 + 元对话/系统提示复述，P1）✅ 已修复

**现象**：部分规则并非真实项目约定——
- 通用最佳实践：`rule-055` 避免暴露敏感路径、`rule-058` 参数化查询防注入、`rule-004` 用绝对路径。
- **元对话/系统提示复述**：`rule-057` "避免硬编码 memory support 值"（谈的正是 AutoImprove 自己）、`rule-056` "严格遵循既定规则完成多步任务"（几乎是助手 system prompt 复述）、`rule-017` "避免重复通用元指令"（自指）。

**根因**：pipeline 在 pattern 提取、聚类、LLM 生成各阶段都**没有任何"元内容/通用性"过滤**。会话里关于工具本身或助手自身规范的讨论会被当成普通 pattern 学成规则。

**修复方案（P1）**：
- **C1 新增 `patternNoiseFilter`**（pattern 级门禁）：在 `batch-rebuild.ts:279`（LLM 前的 `qualifiedPatterns` 过滤）与 `session-analyzer.ts:189`（`writeGate.shouldPersist`）两处拦截：
  - 元/系统短语黑名单：`strictly follow rules`、`adhere to defined rules`、`after completing multi-step tasks`、`system prompt`、`you are an AI`、`AutoImprove`、`memory support`、`meta-instruction` 等（中英文都覆盖）。
  - 自指检测：规则正文提及"规则本身/本系统/本工具/assistant 的规范"且无具体代码信号 → 丢弃。
  - 项目自指：pattern 来源 scope 指向 autoimprove 仓库自身（即"学习器在学自己"）→ 丢弃。
- **C2 通用性降级**：对"适用于任何项目任何语言"的 global 规则，若无任何项目特定信号（无 project_path、无特定技术栈 token），标记 low priority 或在置信度上打折，而非与普通规则同等对待。
- **C3 评估口径**：把"是否元内容/是否通用"纳入 `rule-quality` 的 specificity/actionability 评分，让这类规则自然落在低分被清理。

---

## 缺陷 D：默认阈值过保守（0.6 → 24 会话 0 规则，P2）✅ 已修复

**现象**：默认 `minConfidence=0.6`（`batch-rebuild.ts:143`）下，这 24 个偏单薄、彼此独立的会话产出 **0 条规则**；放宽到 0.2 才得到 47 条。

**根因**：`:276-278` 的全局 `p.confidence >= minConfidence` 在 `classifier.shouldGenerateRule` 的**分级门禁之前**就截断。而 `confidence.ts` 的 `PATTERN_STRATEGIES` 里 `PREFERENCE` 的 `min_confidence` 已是 0.3，单条偏好本可过 classifier，却被全局 0.6 先砍掉。对少量、单例会话过于激进。

**修复方案（P2）**：
- **D1 分级门禁协调**：将全局 0.6 截断改为"仅对需多会话/多次出现的类型生效"，或先过 classifier 的分级 `min_confidence`，全局阈值只作为最终质量下限。让单例 preference（conf≥0.3）能存活。
- **D2 数据不足显式提示**：当 `qualifiedPatterns.length === 0` 时，打印明确提示（"发现 N 个 pattern 但全部低于阈值 M；建议提供更多会话或降低 --min-confidence"），而不是静默产出 0 规则。
- **D3 自适应阈值（可选）**：依据会话数/pattern 数动态调整下限，避免开箱即 0。

---

## 优先级路线图

| 优先级 | 缺陷 | 修复 | 预期效果 |
|---|---|---|---|
| **P0** | A + E | A1 注入共享 store / A2 reload；E1 修 better-sqlite3 ABI / E2 后端告警 | ✅ 已完成：规则真正带上 `source_memory_ids`，`memory_support_score` 变为真实分布 |
| **P1** | B | B1 语言检测+指令 / B2 默认语言配置 | ✅ 已完成：中文会话→中文规则 |
| **P1** | C | C1 patternNoiseFilter / C2 通用性降级 / C3 质量评分纳入 | ✅ 已完成：去掉"工具学自己/通用废话"类噪声（`pattern-noise-filter.ts` + 三处门禁） |
| **P2** | D | D1 分级门禁 / D2 提示 / D3 自适应（未做） | ✅ 已完成：默认 0.6→0.3 + 分级门禁下沉（D1），空候选显式提示（D2）；D3 自适应阈值未实现 |

> 说明：修好 E1（SQLite 可用）会顺带消解 A 在 SQLite 路径下的表现，但 JSONL 路径（容器/拷贝安装常见）仍需 A1/A2 兜底，二者都做最稳。

## 验证方法（统一）

```
AUTOIMPROVE_STORAGE_ROOT=D:/tmp/autoimprove-eval/.autoimprove \
  node lib/cli/index.js summarize --session-dir C:/Users/marcus/.workbuddy/projects --limit 100 --force --min-confidence 0.2
node D:/tmp/autoimprove-eval/evaluate.cjs   # 比对指标
```

关注指标变化：
1. `avgSourceMemories > 0` 且 `source_memory_ids` 非空（A/E）
2. `ruleLangDist.zh > 0`（B）
3. 噪声规则（如 rule-056/057/017）消失或被降级（C）
4. 默认 0.6 下不再静默 0 规则或给出明确提示（D）
