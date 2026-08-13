# 规则生成优化任务清单

> 对应方案文档 `RULE_GENERATION_OPTIMIZATION_PLAN.md`
> 执行顺序：P0 → P1 → P2 → P3

---

## P0：修复 batch LLM 路径 scenes 丢弃 bug

### 任务 0.1：补 SceneExtractor import
- [x] 文件：`src/mcp-server-ts/src/core/batch-llm-rule-generator.ts`
- [x] 在顶部 import 区补 `import { SceneExtractor } from "./scene-extractor.js";`
- [x] 验证：`npm run build` 无报错

### 任务 0.2：parseBatchResponse 返回值透传 scenes
- [x] 文件：`src/mcp-server-ts/src/core/batch-llm-rule-generator.ts`
- [x] 约 line 629-650 的 `return { ... }` 增加 `scenes: rule.scenes || undefined`
- [x] 验证：编译通过

### 任务 0.3：indexEntry.scenes 改 LLM 优先 + extractor 兜底
- [x] 文件：`src/mcp-server-ts/src/core/batch-llm-rule-generator.ts`
- [x] 约 line 776 `scenes: scene || {...}` 改为「LLM scenes 优先，空则 SceneExtractor 从 cluster.representative_description + common_keywords 提取兜底」
- [x] 验证：集成脚本构造含/不含 scenes 的 LLM 返回，确认两条路径都产出非空 scenes

### 任务 0.4：回归测试
- [x] `cd src/mcp-server-ts && npx vitest run`
- [x] 验收：50 files / 418 tests 全部通过

---

## P1：放宽 promotion 门槛 + score 兜底

### 任务 1.1：调整 evaluate() 门槛
- [x] 文件：`src/mcp-server-ts/src/core/memory-promotion.ts`
- [x] 约 line 43-45：`minSessions` 统一放宽到 1，`score` 阈值从 0.6 提到 0.7
- [x] 保留 batchCtx 逻辑（小批量仍豁免）
- [x] 验证：编译通过

### 任务 1.2：验证 promotion 候选数量
- [x] 跑小批量 summarize（如 `--limit 3`）观察日志 `Promoted N procedural memories`
- [x] 验收：单会话高置信模式能被 promotion 选中；低质（score<0.7）仍被过滤

### 任务 1.3：观察规则质量
- [x] 检查新生成规则的 quality_score 分布
- [x] 验收：无噪声规则涌入；若 quality 普遍偏低，回调 scoreThreshold

---

## P2：优化 keywords 提取

### 任务 2.1：新增 keywords 增强逻辑
- [x] 文件：`src/mcp-server-ts/src/core/batch-llm-rule-generator.ts`
- [x] 生成规则后，从 `cluster.representative_description + parsed.title + parsed.description` 用 jieba 分词提取关键词
- [x] 合并 `cluster.common_keywords` + 新提取词，去重
- [x] 验证：编译通过

### 任务 2.2：验证 keywords 质量
- [x] 检查规则 keywords 是否包含有意义技术词
- [x] 验收：不再只有 `create/task:/agent/new` 这类贫瘠词

---

## P3：promotion 前语义聚类合并散落记忆

### 任务 3.1：新增语义聚类方法
- [x] 文件：`src/mcp-server-ts/src/core/memory-promotion.ts`（或新增 `memory-semantic-clusterer.ts`）
- [x] 复用 `EmbeddingEncoder` 计算 procedural memories 两两语义相似度
- [x] 相似度 >= 0.75 视为同主题，聚合 session/project/evidence
- [x] 验证：编译通过

### 任务 3.2：接入 promotion 流程
- [x] 在 `promoteEligible()` / `promoteEligibleWithLLM()` 开头先做语义聚类
- [x] 聚合后的记忆再走 `evaluate()`
- [x] 验证：编译通过

### 任务 3.3：验证聚类效果
- [x] 用「Create agent」类 5 条 s=1 记忆验证能否被聚为 1 个候选、聚合后 sessions>=2
- [x] 验收：语义相同记忆合并后能通过 promotion

### 任务 3.4：回归测试
- [x] `cd src/mcp-server-ts && npx vitest run`
- [x] 验收：418 tests 全部通过

---

## 完成标准

- [x] P0 完成：batch LLM 规则 scenes 非空
- [x] P1 完成：promotion 候选数量提升，无噪声涌入
- [x] P2 完成：keywords 有区分度
- [x] P3 完成：散落记忆语义合并，跨会话模式能被 promotion 捕获
- [x] 每个 P 完成后单独 commit
