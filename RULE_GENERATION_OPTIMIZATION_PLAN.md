# 规则生成优化方案

> 背景：`./summarize.sh --limit 100` 实际运行后，仅产出 1 条规则。经分析，生成器能力正常（产出结构完整、有据可查的规则），瓶颈在于：① memory-driven 与 batch LLM 两条路径都存在「scenes 被丢弃」的 bug；② promotion 门槛过严导致 memory 候选极少；③ 数据源里跨会话重复模式少；④ keywords 提取贫瘠影响搜索召回。

---

## 优先级排序总览

| 优先级 | 方案 | 改动量 | 收益 | 状态 |
|:---:|------|:---:|------|:---:|
| P0 | 方案 3：修复 batch LLM 路径 scenes 丢弃 bug | 小 | 高（修复明显 bug） | 待执行 |
| P1 | 方案 1：放宽 promotion 门槛 + score 兜底 | 小 | 高（提升规则产出数量） | 待执行 |
| P2 | 方案 4：优化 keywords 提取 | 小 | 中（提升搜索召回） | 待执行 |
| P3 | 方案 2：promotion 前语义聚类合并散落记忆 | 大 | 高（治本） | 待执行 |

---

## 方案 3（P0）：修复 batch LLM 路径 scenes 丢弃 bug

### 问题描述
`llm-prompt-builder.ts` 的 prompt 已明确要求 LLM 返回 `scenes` 字段（含 JSON 示例），但 `batch-llm-rule-generator.ts` 在解析后把 `scenes` 丢弃，最终 `indexEntry.scenes` 写死为空对象，导致所有 batch LLM 生成的规则 scenes 全空。

实际证据：本次生成的唯一规则 `scenes = {tech:none, functional:none, business:none}`。

### 修改点

**文件：`src/mcp-server-ts/src/core/batch-llm-rule-generator.ts`**

1. `parseBatchResponse` 的返回值（约 line 629-650）增加 `scenes` 字段透传：
```ts
return {
  title: rule.title,
  description: rule.description,
  rationale: rule.rationale,
  how_to_apply: rule.how_to_apply || [],
  when_to_use: rule.when_to_use || [],
  exceptions: rule.exceptions,
  scenes: rule.scenes || undefined,   // ← 新增：透传 LLM 返回的 scenes
  scope: ...,
  ...
};
```

2. `indexEntry.scenes` 赋值（约 line 776）改为「LLM scenes 优先 + SceneExtractor 兜底」，与 memory-driven 路径（`hybrid-rule-generator.ts` 已修复）保持对称：
```ts
// LLM 提供的 scenes 优先；否则用 SceneExtractor 从 cluster 文本提取兜底
let ruleScenes: Scene = scene || { tech: [], functional: [], business: [] };
const llmScenes = parsed.scenes as Scene | undefined;
const hasLlmScenes = llmScenes && (
  (llmScenes.tech?.length ?? 0) > 0 ||
  (llmScenes.functional?.length ?? 0) > 0 ||
  (llmScenes.business?.length ?? 0) > 0
);
if (hasLlmScenes) {
  ruleScenes = { tech: llmScenes.tech || [], functional: llmScenes.functional || [], business: llmScenes.business || [] };
} else {
  const sceneExtractor = SceneExtractor.getInstance();
  const sourceText = [cluster.representative_description, ...cluster.common_keywords].join(" ");
  const reExtracted = sceneExtractor.extractScene({ text: sourceText });
  if (reExtracted.tech.length || reExtracted.functional.length || reExtracted.business.length) {
    ruleScenes = reExtracted;
  }
}
// indexEntry.scenes = ruleScenes;
```

3. 需要确认 `SceneExtractor` 已在文件顶部导入（当前 `batch-llm-rule-generator.ts` 未导入，需补 `import { SceneExtractor } from "./scene-extractor.js";`）。

### 执行步骤
1. 补 `SceneExtractor` import
2. `parseBatchResponse` 返回值加 `scenes`
3. `indexEntry.scenes` 改 LLM 优先 + extractor 兜底
4. `npm run build` 编译
5. 用集成脚本（构造含 scenes 的 LLM 返回）验证

### 验收标准
- batch LLM 生成的规则 `scenes` 非空
- 全量测试 418 通过

---

## 方案 1（P1）：放宽 promotion 门槛 + score 兜底

### 问题描述
`memory-promotion.ts` 的 `evaluate()` 要求 `sessions >= 2`（非小批量时），但数据源里绝大多数 procedural memory 的 `independent_session_count = 1`（58 条里仅 1 条 s=4），导致 promotion 几乎选不出候选，memory-driven 路径长期空转。

### 修改点

**文件：`src/mcp-server-ts/src/core/memory-promotion.ts`**

`evaluate()` 的 eligible 判定（约 line 43-45）调整：
- 门槛从 `sessions >= 2` 放宽到 `sessions >= 1`
- 用 score 兜底质量：score 阈值从 `0.6` 提到 `0.7`，即「单会话但高置信」的模式也能进，用质量分而非频次过滤

```ts
// 现状：
const minSessions = batchRelaxed ? 1 : 2;
const eligible = (explicit || sessions >= minSessions || validation > 0) && contradiction === 0 && score >= 0.6;

// 改为：
const minSessions = batchRelaxed ? 1 : 1;   // 统一放宽到 1，用 score 兜底
const scoreThreshold = 0.7;                   // 提高质量门槛
const eligible = (explicit || sessions >= minSessions || validation > 0) && contradiction === 0 && score >= scoreThreshold;
```

### 执行步骤
1. 调整 `evaluate()` 的 minSessions 与 scoreThreshold
2. 重新编译
3. 跑 `--limit 100` 或小批量验证 promotion 候选数量是否提升

### 验收标准
- 单会话高置信（conf >= 0.8 之类）的模式能被 promotion 选中
- 低置信（score < 0.7）仍被过滤，无噪声规则涌入

### 风险
- 放宽后可能引入低质规则，需观察 quality_score 分布，必要时回调 scoreThreshold

---

## 方案 4（P2）：优化 keywords 提取

### 问题描述
本次规则的 keywords 只有 `create, task:, agent, new` 4 个贫瘠词，搜索召回能力弱。根因是 `cluster.common_keywords` 直接取 pattern.keywords 的交集，而 pattern.keywords 在 pattern detection 阶段提取不充分。

### 修改点

**文件：`src/mcp-server-ts/src/core/batch-llm-rule-generator.ts`**

生成规则后，用 `SceneExtractor` 或现有分词工具从「cluster.representative_description + parsed.title + parsed.description」重新提取 keywords，替换/扩充 `cluster.common_keywords`：

```ts
// indexEntry.keywords 与 content.metadata.keywords 处
const enrichedKeywords = await this.extractKeywords(cluster, parsed);
// 合并 common_keywords + 新提取词，去重
```

具体实现可复用 `SceneExtractor.extractScene()` 返回的关键词，或新增一个 `extractKeywords` 私有方法（tokenize + 频次排序）。

### 执行步骤
1. 确认 `SceneExtractor` 是否返回 keywords（若无则用 jieba 分词）
2. 在规则生成处合并 keywords
3. 编译 + 验证 keywords 数量/质量

### 验收标准
- 规则 keywords 包含有意义的技术词（如 paperclip, agent-api, hire），而非仅 `create/task:/agent/new`

---

## 方案 2（P3）：promotion 前语义聚类合并散落记忆

### 问题描述
5 条「Create agent」相关的 procedural memory 语义上是同一件事，但 `independent_session_count` 各为 1，导致每个都达不到 promotion 门槛。治本方案：在 promotion 前做一次语义聚类，把语义相同的 s=1 记忆合并，聚合后的会话数 >= 2。

### 修改点

**文件：`src/mcp-server-ts/src/core/memory-promotion.ts`（或新增 `memory-semantic-clusterer.ts`）**

在 `promoteEligibleWithLLM()` / `promoteEligible()` 开始时，对候选 procedural memories 做语义聚类：
1. 用 `EmbeddingEncoder` 计算记忆两两语义相似度（或复用 `PatternSimilarityClusterer` 的思路）
2. 相似度 >= 阈值（如 0.75）的记忆视为同一主题，聚合其 `independent_session_count`、`independent_project_count`、`evidence`
3. 聚合后的记忆再走 `evaluate()` 判定

```ts
// 伪代码
const candidates = this.store.list({ activeOnly: true, kind: "procedural" });
const clustered = await this.clusterBySemantics(candidates);
for (const group of clustered) {
  const merged = mergeMemories(group);  // 聚合 session/project/evidence
  const decision = this.evaluate(merged);
  ...
}
```

### 执行步骤
1. 确认 `EmbeddingEncoder` 可复用（已在 embedding-encoder.ts 中）
2. 新增聚类方法（或复用 pattern-similarity-clusterer 的 calculateSimilarity 思路）
3. 接入 promotion 流程
4. 编译 + 验证：语义相同的 s=1 记忆能被合并并满足 promotion

### 验收标准
- 「Create agent」类 5 条 s=1 记忆被聚类为 1 个候选，聚合后 sessions >= 2，能通过 promotion
- 全量测试通过

### 风险
- 语义聚类阈值不当可能误合并不同主题，需谨慎设阈值并保留原 memory id 追溯

---

## 执行顺序建议

```
P0（方案3）→ P1（方案1）→ P2（方案4）→ P3（方案2）
```

理由：P0 是明确的 bug 修复，收益立竿见影；P1 改动小且直接提升产出数量；P2 提升搜索体验；P3 是治本但改动大、风险高，放最后。
