# Handoff 文档 —— AutoImprove 规则生成优化交接

> 交接时间：2026-08-13 00:33
> 交接人：上一任 agent
> 目标：完成规则生成质量优化的剩余 4 个方案（P0-P3）
> 配套文件：`RULE_GENERATION_OPTIMIZATION_PLAN.md`（方案详情）、`task.md`（任务清单）

---

## 0. 一句话背景

AutoImprove 是一个从 Claude/Codex 会话中学习并生成"编码规则"的 MCP server（TypeScript）。当前规则生成质量不理想：`summarize --limit 100` 只产出 1 条规则，且 scenes 为空、keywords 贫瘠。已定位根因，剩余 4 个优化方案待执行。

---

## 1. 当前状态（必须知道）

### 1.1 工作区与 git 状态
- 项目根：`/Users/adazhao/workspace/autoimprove`
- 当前分支：`main`，HEAD = `a280339`
- **⚠️ `a280339` 尚未 push 到 origin**（`origin/main` 还停在 `52aa624`）
- 两个新文档未提交：`RULE_GENERATION_OPTIMIZATION_PLAN.md`、`task.md`（git status 显示 `??`）
- 最近提交历史：
  ```
  a280339 fix: memory-driven 规则生成 scenes 为空被门禁打回（方案A+B）
  52aa624 feat: 规则生成优化 —— memory-driven 路径 + 跨类型聚类合并 + promotion 阈值豁免
  2db69ad fix: 修复测试失败（content-sanitization 缺 beforeEach 导入 + performance 阈值放宽）
  7467c34 fix: LLM 调用超时与重试 + 修复遗留测试失败
  e2f4dc0 Phase 7: 监控与告警（更早的 7 阶段优化）
  ```

### 1.2 已完成的工作（不要重复做）
- ✅ LLM 超时+重试（`llm-retry.ts`，60s 超时 + 3 次重试）
- ✅ 会话发现 bug 修复（`discoverSessionFiles` 漏顶层 jsonl）
- ✅ 跨类型聚类合并（`pattern-similarity-clusterer.ts` 的 `mergeCrossTypeClusters`）
- ✅ memory-driven 路径接入 summarize（`batch-rebuild.ts` Step7）
- ✅ **memory-driven 的 scenes 空 bug 已修复**（`hybrid-rule-generator.ts` 的 `generateRuleFromMemory`，方案 A+B 都做了）
- ✅ 测试全绿：`cd src/mcp-server-ts && npx vitest run` → **50 files / 418 tests**

### 1.3 关键目录结构
```
src/mcp-server-ts/src/core/     ← MCP server 核心逻辑（主要改动区）
  batch-rebuild.ts              ← BatchRebuildEngine，summarize 主流程
  batch-llm-rule-generator.ts   ← batch LLM 规则生成（P0/P2 改这里）
  hybrid-rule-generator.ts      ← hybrid 生成器（generateRuleFromMemory 在这里）
  memory-promotion.ts           ← promotion 服务（P1/P3 改这里）
  memory-models.ts              ← memoryFromPattern/memoryFromOccurrence
  pattern-similarity-clusterer.ts ← pattern 聚类
  llm-prompt-builder.ts         ← LLM prompt 模板（已含 scenes 要求）
  session-analyzer.ts           ← 会话分析 + memory 持久化
  scene-extractor.ts            ← SceneExtractor（scenes 兜底提取复用点）
src/mcp-server-ts/tests/        ← 测试
src/mcp-server-ts/vitest.config.ts ← ⚠️ vitest 配置（testTimeout=120s）
src/cli/                        ← CLI（summarize 命令入口）
src/utils/summarize-engine.ts   ← summarize 引擎
summarize.sh                    ← CLI wrapper
scripts/search-knowledge.sh     ← 拉取规则（--full-display 看全量）
```

---

## 2. 环境与运行要点（踩坑指南）

### 2.1 Node 版本陷阱
**必须用 Node 24**，`better-sqlite3` 编译于 ABI 137，默认 Node 22 不兼容。
```bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
```
每个 Bash 命令前都要 export（shell 状态不持久）。

### 2.2 编译
```bash
cd /Users/adazhao/workspace/autoimprove/src/mcp-server-ts
npm run build   # 编译 MCP server（tsc → dist/）
```
- `dist/` 是 gitignored，不提交
- 改完 src 后**必须重新 build**，否则运行时还是旧代码
- 验证编译进 dist：`grep -c "关键词" src/mcp-server-ts/dist/core/xxx.js`

### 2.3 跑测试（重要）
```bash
cd /Users/adazhao/workspace/autoimprove/src/mcp-server-ts
npx vitest run
```
- **必须 cd 到 `src/mcp-server-ts`**，否则 vitest 用默认 5s 超时，scene-extraction 等 LLM 测试全挂
- 全量预期：50 files / 418 tests 通过

### 2.4 LLM 端点（间歇性不稳定）
- Base URL: `https://aigw-gzgy2.cucloud.cn:8443/v1`，模型 `DeepSeek-V4-Flash`
- Key 从环境变量 `LLM_API_KEY` 读（不在 config.json）
- 单次请求 1-2s 正常，**持续批量调用会出现超时窗口**（延迟飙到 32s+，甚至 90s 超时）
- 环境变量：`LLM_TIMEOUT_MS`（默认 60s）、`BATCH_MAX_CONCURRENT`（默认 2）
- 调端点健康：`curl` 单个 chat 请求测 http code

### 2.5 运行时数据
- `~/.autoimprove/`：rules（规则库）、memories（memory.sqlite）、logs（jsonl 日志）
- 规则库现状：`~/.autoimprove/rules/index.json` 是 `{rules:[]}`，但 SQLite（rules.db）里才是真实数据
- 记忆库：`~/.autoimprove/memories/memory.sqlite`，有 memories 表
- 日志：`~/.autoimprove/logs/autoimprove-*.jsonl`，可用 node 脚本解析进度

### 2.6 codegraph 无关干扰
- `codegraph/` 是独立的第三方项目（非 submodule，gitignored），与 autoimprove 无关
- 从**根目录**跑 `npx vitest run` 会误扫它的测试导致 110 个失败，忽略即可
- 从 `src/mcp-server-ts` 跑就不会扫到

---

## 3. 核心诊断结论（已完成的分析，别重新推导）

### 3.1 为什么只生成 1 条规则
`summarize --limit 100` 实际流水线：
```
304 会话 → 分析 100 → 38 非代码拒绝 → 17 pattern → 10 noise 过滤 → 7 合格
        → 1 promoted memory → 0 规则（scenes 空被门禁打回，已修复）
        → 2 pattern 聚类 → 1 规则
```
根本原因：数据源里跨会话重复的模式极少。58 条 procedural memory 里，`independent_session_count = 1` 的占绝大多数，只有 1 条 s=4。

### 3.2 scenes 空 bug 的两个位置
1. **memory-driven 路径（已修复 `a280339`）**：`generateRuleFromMemory` 曾把 scenes 写死为空
2. **batch LLM 路径（未修复，即 P0）**：`batch-llm-rule-generator.ts` 同样丢弃 scenes

### 3.3 关键发现（P0 的真相）
`llm-prompt-builder.ts` 的 prompt **已经要求 LLM 返回 scenes 字段**（line 525、564 有 JSON 示例），但 `batch-llm-rule-generator.ts` 解析后（`parseBatchResponse` 的 return，约 line 629-650）**把 scenes 丢弃了**，然后 line 776 写死 `scenes: scene || {空}`。

**所以 P0 的本质是"把丢掉的字段接回来"，不是新增提取逻辑。**

---

## 4. 待完成任务（详细方案见 `RULE_GENERATION_OPTIMIZATION_PLAN.md`）

### P0：修复 batch LLM 路径 scenes 丢弃 bug（最优先）
文件：`src/mcp-server-ts/src/core/batch-llm-rule-generator.ts`
1. 补 `import { SceneExtractor } from "./scene-extractor.js";`
2. `parseBatchResponse` 返回值（约 line 629-650）加 `scenes: rule.scenes || undefined`
3. line 776 `scenes: scene || {...}` 改为「LLM scenes 优先，空则 SceneExtractor 从 cluster 文本提取兜底」（对称参考 `hybrid-rule-generator.ts` 已修复的写法）

### P1：放宽 promotion 门槛 + score 兜底
文件：`src/mcp-server-ts/src/core/memory-promotion.ts`
- 当前 line 53-54：`minSessions = batchRelaxed ? 1 : 2`、`score >= 0.6`
- 改为：`minSessions` 统一放宽到 1，`score` 阈值提到 0.7（用质量分而非频次过滤）

### P2：优化 keywords 提取
文件：`src/mcp-server-ts/src/core/batch-llm-rule-generator.ts`
- 生成规则后，从 `cluster.representative_description + parsed.title + parsed.description` 用 jieba 分词提取关键词，合并 `cluster.common_keywords`

### P3：promotion 前语义聚类合并散落记忆（治本，改动大）
文件：`src/mcp-server-ts/src/core/memory-promotion.ts`（或新增 `memory-semantic-clusterer.ts`）
- 复用 `EmbeddingEncoder` 计算 procedural memories 语义相似度
- 相似度 >= 0.75 的聚合 session/project/evidence
- 聚合后走 `evaluate()` 判定

---

## 5. 验证方法

### 5.1 单元/集成测试
```bash
cd /Users/adazhao/workspace/autoimprove/src/mcp-server-ts
npx vitest run   # 目标 418 全过
```

### 5.2 验证 scenes 修复（P0 完成后）
写一个临时 .mjs 集成脚本（参考之前的做法）：
- 构造含 scenes 的 LLM 返回 → 确认规则 scenes 非空
- 或用 `scripts/search-knowledge.sh --full-display` 拉取真实规则看 scenes

### 5.3 验证 promotion 候选（P1 完成后）
跑小批量 summarize：`node lib/cli/index.js summarize --limit 3 ...`，看日志 `Promoted N procedural memories` 的 N 是否提升

### 5.4 拉取规则内容
```bash
cd /Users/adazhao/workspace/autoimprove
bash scripts/search-knowledge.sh --full-display
```

---

## 6. 提交规范

- 每个 P 完成后单独 commit，中文描述，格式参考历史提交
- 示例：`fix: 修复 batch LLM 路径 scenes 丢弃 bug（P0）`
- 改源码后必须 `npm run build` 再验证
- **⚠️ 记得 push**：当前 `a280339` 和两个新文档都还没 push

---

## 7. 交接状态更新（2026-08-13 08:30 已完成 P0-P3）

> 以下任务已全部完成并提交，无需再执行：

- ✅ **P0** `b19e272`：batch LLM 路径 scenes 丢弃 bug 已修复（parseBatchResponse 透传 + SceneExtractor 兜底），集成脚本两条路径均产出非空 scenes
- ✅ **P1** `c4722aa`：promotion 门槛放宽（minSessions=1）+ score 权重调整（confidence 0.55）+ 阈值 0.65（真实库校准：0.7 会滤空所有候选），eligible 候选 1→17
- ✅ **P2** `315b57d`：keywords 用 jieba 从 representative_description + title + description 提取合并，3 个贫瘠词 → 20 个含区分度技术词
- ✅ **P3** `0293d56`：新增 `memory-semantic-clusterer.ts`，promotion 前语义聚类（阈值 0.68 真实库校准），hire-agent 3 条 s=1 记忆聚合后 sessions=3 通过 promotion；新增 3 个测试
- ✅ 全量测试：**51 files / 421 tests 全部通过**（原 418 + 新增 3）
- ✅ `task.md` 所有 checkbox 已勾选完成

**尚未执行**：push 到 origin（`origin/main` 仍停在 `52aa624`，本地领先 5 个提交）。需用户确认后执行。

## 原第 7 节：接手后建议的第一步

1. 先 `git status` + `git log` 确认状态，push 未同步的提交
2. 提交两个新文档（`RULE_GENERATION_OPTIMIZATION_PLAN.md`、`task.md`）
3. 从 P0 开始执行（改动最小、收益最确定）
4. 每个方案完成后跑全量测试 + 单独 commit
