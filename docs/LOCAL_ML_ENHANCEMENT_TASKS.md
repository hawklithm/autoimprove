# 本地 ML 增强方案 — 任务拆解（带 checkbox）

> 对应设计文档：`docs/LOCAL_ML_ENHANCEMENT_DESIGN.md`
> 约束：每个任务 **最多 3 个修改点**；模块按「升级工作」拆分阶段；所有组件纯 CPU、可本地运行。
> 代码锚点：`src/mcp-server-ts/src/core/`（detector / `session-analyzer.ts` / `message-clusterer.ts` / `signal-matcher.ts` / `adaptive-session-analyzer.ts` / `pattern-clusterer.ts` / `llm-config-manager.ts` / `adaptive-confidence.ts`）、`src/mcp-server-ts/src/storage/init.ts`（`Config` :34 / `loadConfig()` :118）、`src/mcp-server-ts/src/storage/compact-cache.ts`（**`CompactCacheManager` 实际定义在此，非 `src/core`**）、`src/mcp-server-ts/src/core/adaptive-confidence.ts`（`recordFeedback` :189，即 `record_feedback` 工具的真实落地）、`src/mcp-server-ts/src/index.ts`（MCP 工具层调用点，`record_feedback` :536/:1070、`analyze_session` 相关工具）。
> 重要：`AdaptiveSessionAnalyzer`（`adaptive-session-analyzer.ts:78`）才是上层真实入口，内部 `new SignalMatcher()`（:67）并直接 `this.signalMatcher.match()`（:146）。因此模块 E 的切换必须在 `AdaptiveSessionAnalyzer` 实例化处生效，否则 `NeighborSignalMatcher` 不会被创建。

---

## 模块 A：配置与开关层（基础，所有模块依赖）

### A1. 新增 `local_ml` 配置段
- [x] 在 `src/mcp-server-ts/src/storage/init.ts` 的 `Config` 接口中新增 `local_ml` 字段（含 `enabled` / `embedding_backend` / `prefilter` / `clusterer` / `signal_match` / `personalization` / `ab_test` 子结构）。
- [x] 在 `loadConfig()` 中为该段提供默认值（默认全部 `enabled: false`，保持旧链路行为）。**注意**：`loadConfig()` 直接 `JSON.parse` 文件、无 deep merge，故必须同步改 `DEFAULT_CONFIG`（已改），否则已有 config 文件用户拿不到 `local_ml`。
- [x] 在 `src/mcp-server-ts/src/core/logger.js` 已有的日志体系中，为 `local_ml` 增加启动期配置状态日志（参考 `llm-config-manager.ts:138` 的 `logConfigurationStatus` 风格）。**注**：P0 阶段 `enabled:false` 时无需专门日志；A1 第3点降级为"结构就绪，日志待 P4 统一补"，不阻塞。

---

## 模块 B：轻量初筛 PreFilter（阶段一：降 token）

### B1. 建立 PreFilter 骨架与配置接入
- [x] 新建 `src/mcp-server-ts/src/core/pre-filter.ts`，导出 `PreFilterConfig` 接口与 `PreFilter` 类骨架（含 `enabled` / `mode: heuristic|haiku|local-llm`）。
- [x] 在 `src/mcp-server-ts/src/core/session-analyzer.ts` 的 `SessionAnalyzer` 构造函数中实例化 `PreFilter`（读取 `loadConfig().local_ml.prefilter`）。
- [x] 在 `SessionAnalyzer.analyzeSession`（`session-analyzer.ts:44` 之后）插入 `prefilter` 调用占位，未启用时直接透传。

### B2. 实现 heuristic 零成本过滤模式
- [x] 在 `PreFilter` 中实现 `heuristic` 模式：保留含 `tool_call` / 代码围栏 / 信号关键词的消息，丢弃纯寒暄与单字 ack。
- [x] 增加重复度判定：与上一条消息相似度 >90% 的重复消息予以丢弃（`cosineSimilarity` 为 `message-clusterer.ts:261` 的 `private` 方法，PreFilter 内自行实现字符级 Jaccard 相似度）。
- [x] 输出 `FilterResult`（`kept` / `droppedCount` / `reason` 计数），供可观测使用。

### B3. 接入 haiku 与 local-llm 模式（可选增强，已推迟）
- [ ] ~~在 `PreFilter` 中实现 `haiku` 模式~~ **已推迟**：用户确认 B3 可往后放。Heuristic 模式（B2）已足够覆盖多数场景；haiku/local-llm 属于效果上限增强，待有明确 token 成本压力时再实现。
- [ ] ~~实现 `local-llm` 模式~~ 同上方，已推迟。
- [ ] ~~在 `SessionAnalyzer.performFullAnalysis` 与 `performIncrementalAnalysis` 中接入~~ 已推迟。

---

## 模块 C：语义表示 EmbeddingEncoder（阶段二核心）

### C1. 字符 n-gram TF-IDF 编码器
- [x] 新建 `src/mcp-server-ts/src/core/embedding-encoder.ts`，导出 `EmbeddingEncoder` 与 `EmbeddingBackend` 类型（`char-ngram-tfidf` | `onnx-local`）。
- [x] 实现 `char-ngram-tfidf` 后端：字符 bigram/trigram 提取（替换 `message-clusterer.ts:226` 的空格分词），输出 L2 归一化 `Float32Array`。
- [x] 实现 `encodeBatch` / `encode` / 静态 `cosine` 方法（IDF 计算为字符 n-gram 版，零依赖）。

### C2. 向量缓存（复用 compactCache 框架）
- [x] 为向量空间引入 `version` 号（`EmbeddingEncoder.version`，encoder 后端变更时触发重编码）——**已实现字段**。
- [x] 在 `EmbeddingEncoder` 中实现 `loadCache` / `saveCache` / `clearCache` 接口。向量持久化到 `~/.autoimprove/cache/embeddings/{sessionId}.embed.json`，携带 `version` + `backend` 签名，后端或版本变更时自动失效。
- [x] 缓存生命周期与 session 分析对齐：`encodeBatch` 前先查缓存，miss 时编码并回写。

### C3. 可选 ONNX 本地小模型后端（效果上限）
- [x] 在 `EmbeddingEncoder` 中实现 `onnx-local` 后端：惰性加载 `onnxruntime-node` InferenceSession（进程级单例），加载量化 ONNX 模型做 CPU 推理。
- [x] 实现模型惰性加载与进程级单例，控制首次加载开销与内存。
- [x] 在 `loadConfig().local_ml` 中补充 `onnx_model` 字段（已有）与可用性校验：模型文件不存在或 `onnxruntime-node` 未安装时自动回退 `char-ngram-tfidf` 并记录 warning。

---

## 模块 D：语义聚类 SemanticClusterer（替代词面聚类）

### D1. 聚类器接入向量编码器
- [x] 改造 `MessageClusterer.clusterMessages`（`message-clusterer.ts:44`）：非 legacy 时调用 `EmbeddingEncoder`（新增 `buildSemanticVectors`），原 `buildTFIDFVectors` 保留为 `legacy` 回退。
- [x] 改造 `growCluster`（`:97`）相似度：非 legacy 时基于 `EmbeddingEncoder` 归一化向量余弦（复用 `cosineSimilarity`，原方法保留供 `legacy` 模式）。
- [x] 非 legacy 时不再调用 `calculateSemanticBoost` / `SEMANTIC_GROUPS`（向量余弦已吸收语义）；方法体与常量保留供回退。

### D2. 组合相似度与 HDBSCAN 接入
- [x] 调整 `growCluster` 加权公式：非 legacy 时语义余弦 0.8 + `pathSimilarity`（`:282`）0.2，去掉原 `semanticBoost` 0.2 权重（legacy 保持 0.6/0.2/0.2）。
- [ ] 引入 HDBSCAN 密度聚类。**决策**：当前 `growCluster` 已是种子式层次聚类，语义向量已解决跨语言近邻；HDBSCAN 作为可选增强，待 H1 评估依赖后接入（属 P1.5 可选，不阻塞 P1 验收）。config 三态已预留。
- [x] `loadConfig().local_ml.clusterer` 支持 `hdbscan` / `kmeans` / `legacy` 三态，`constructor` 按此切换 backend，默认 `legacy` 行为不变。

### D3. 增量聚类改造
- [x] 在 `performIncrementalAnalysis`（`session-analyzer.ts:107`）中，新消息向量与**已有簇质心**做近邻并入。新增 `MessageClusterer.incrementalCluster()` 方法：新消息经 `EmbeddingEncoder` 编码后与缓存质心做余弦近邻，超阈值即并入。
- [x] 新增「离群」判定：未落入任何簇阈值内的新消息标记为离群，返回给调用方重新全量聚类（形成新簇或丢弃为噪声）。
- [x] 更新簇质心缓存：`SessionCacheEntry` 新增 `cluster_centroids` 字段，`SessionCacheManager` 增加 `getClusterCentroids` / `setClusterCentroids` 读写接口。增量运行后通过 `MessageClusterer.clustersToCentroids()` 重新序列化质心，保证增量与全量结果一致。

---

## 模块 E：近邻信号匹配 NeighborSignalMatcher（替代 Aho-Corasick）

### E0. 上层实例化切换（关键，否则新 matcher 不生效）
- [x] 在 `AdaptiveSessionAnalyzer`（`adaptive-session-analyzer.ts:67`）处，按 `loadConfig().local_ml.signal_match.mode` 决定 `new SignalMatcher()` 或 `new NeighborSignalMatcher()`。
- [x] 确认 `this.signalMatcher.match()`（`:146`）与 `rebuild()`（`:185`）接口兼容 `NeighborSignalMatcher`（结构已在 E1 对齐）。
- [x] 在 `getStats()`（`:452`）/`close()`（`:459`）处兼容新 matcher 的对应方法，避免上层调用空指针。

### E1. 向量化信号词典索引
- [x] 新建 `src/mcp-server-ts/src/core/neighbor-signal-matcher.ts`，导出 `NeighborSignalMatcher`，结构兼容现有 `MatchResult` / `MatchedSignal`（`signal-matcher.ts:9`）。
- [x] 启动时将所有 `signals.text` 经 `EmbeddingEncoder` 编码为词典向量索引（替代 `SignalMatcher.buildAutomaton` 的 `AhoCorasick`，`signal-matcher.ts:45`）。
- [x] 保留 `aggregateSignals`（`:197`）加权置信度逻辑不变，仅替换匹配来源。

### E2. top-k 近邻匹配
- [x] 实现 `match(content)`：编码消息 → 与词典向量做 top-k 余弦近邻 → 超 `matchThreshold` 即命中。
- [x] 保留 `extractContextWindow`（`:181`）与 `recordSignalMatch` / `incrementMatchCount`（`:138`）的副作用逻辑。
- [x] 在 `batchMatch`（`:172`）中复用单条 `match`，保证接口一致。

### E3. 性能索引与回退
- [ ] 词典量大时接入 `FAISS-CPU` / `hnswlib` 近邻索引（纯 CPU），控制匹配延迟。**决策**：可选增强，待 H2 评估依赖后接入，当前暴力余弦扫描在数百~数千条信号量级已足够。
- [x] 在 `loadConfig().local_ml.signal_match` 中支持 `mode: neighbor|exact`，`exact` 回退到原 `SignalMatcher`。`init.ts` Config 接口已有 `mode: "legacy" | "neighbor"`，`adaptive-session-analyzer.ts:74` 按此切换。
- [x] 在 `SignalMatcher.maybeRebuild`（`:74`）对应位置增加近邻索引的重建触发（5 分钟间隔对齐）。两个 matcher 的 `maybeRebuild` 均已有 5 分钟重建间隔。

---

## 模块 I：PatternClusterer 语义化改造（adaptive 链路的 pattern 级聚类）

> 背景：`AdaptiveSessionAnalyzer` 在抽取信号后，调用 `PatternClusterer.clusterPatterns`（`pattern-clusterer.ts:39`）对已抽取 pattern 做**聚类合并**（不同于 `MessageClusterer` 的 message 级聚类）。`PatternClusterer` 内部使用 `jaccardSimilarity` + 词级 `textSimilarity`（`pattern-similarity-clusterer.ts`）。设计文档与前述模块只覆盖了 `MessageClusterer`，此处补齐 pattern 级聚类的语义化，否则跨语言同义 pattern 仍会被拆散。

### I1. 接入向量编码器做 pattern 相似度
- [x] 改造 `PatternSimilarityClusterer.calculateSimilarity`（`pattern-similarity-clusterer.ts:112`）：将 `keyword` Jaccard（0.4）与 `textSimilarity` 词重叠（0.3）替换为基于 `EmbeddingEncoder` 向量的语义相似度。
- [x] 保留 `type` 精确匹配（0.2 权重）与 `context` 相似度（0.1 权重）的辅助结构，仅把"词面重叠"部分升级为"语义近邻"。
- [x] 确认 `PatternClusterer.clusterPatterns`（`pattern-clusterer.ts:39`）经由此相似度，无需改调用方；并同步使 `PatternClusterer.calculateSimilarity`（`pattern-clusterer.ts`）在 `pattern_clusterer==semantic` 时将 signal Jaccard(0.7) 升级为语义近邻，保留 length/confidence 权重。

### I2. 回退与实例化接入
- [x] 在 `AdaptiveSessionAnalyzer`（`adaptive-session-analyzer.ts:70` 的 `new PatternClusterer()`）处，按 `loadConfig().local_ml.clusterer` 决定走语义版或 legacy 词面版（`PatternClusterer` 构造器内部读 `pattern_clusterer` 配置自动切换）。
- [x] 保留 `getClusterStats`（`:226`）接口不变，供 G1 指标复用。
- [x] 在配置段补充 `pattern_clusterer` 子开关（与 `clusterer` 联动或独立），保证可回退。

---

## 模块 F：本地个性化 Personalizer（用户级在线训练）

### F1. 反馈信号采集
- [x] 在 `record_feedback` 工具真实落地处 `adaptiveConfidence.recordFeedback`（`adaptive-confidence.ts:189`，由 `index.ts:1521/:2265` 调用）中，将 `feedback_type`（used/ignored/disabled/corrected）与对应 signal / 消息关联（**复用** `signal-dictionary-db.ts` 已有的 `signal_matches.outcome` 与 `confidence_history` 表，而非新建等价表）。`RuleFeedback` 增加可选 `user_id` / `signal_text` 字段；Personalizer 持久化用户质心/阈值，不新建表。
- [x] 在 `signal_matches` / `confidence_history` 中补充「用户维度」标识（user_id / 组织维度列），为 per-user 个性化建立索引键（设计文档 §6.1 的监督信号已天然存在于这些表中）。**注**：当前数据模型 signal_matches 无 user_id 列；采用轻量降级——Personalizer 以 `user_id`（来自 feedback/session 入参）为索引键，质心/阈值独立持久化，避免 ALTER 现有表破坏 schema。
- [x] 新增仅承载「用户质心 / 阈值」的轻量持久化（如 `personalization/{user_id}.json` 或独立小表），正/负样本本身复用上述已有表，不重复存储原始信号。

### F2. 用户级质心与阈值
- [x] 新建 `src/mcp-server-ts/src/core/personalizer.ts`，实现对该用户正样本 signal 向量取平均得到「用户风格质心」。
- [x] 实现 per-user `matchThreshold` / `SIMILARITY_THRESHOLD` 自适应（口语化用户放宽、精确术语用户收紧）。
- [x] 模型持久化到 `~/.autoimprove/personalization/{user_id}.json`，携带 encoder `version` 号。

### F3. 在线增量训练与权重微调
- [x] 每次 `record_feedback` / `mark_session_analyzed` 后异步增量更新该用户质心与阈值（指数滑动平均，避免过拟合）。`handleMarkSessionAnalyzed` 在 personalization 启用且带 `user_id` 时，经 `SignalDictionaryDB.getSignalTextsBySession` 拉取正样本并调用 `Personalizer.recordSessionAnalyzed`。
- [x] 实现可选的 per-user 最近质心 / logistic regression 轻量分类器，判别「消息是否值得提取为信号」（提供 `centroidSimilarity` 最近质心打分，logistic regression 留待后续增强）。
- [x] 在 `loadConfig().local_ml.personalization` 中支持 `enabled` / `per_user` 开关，并接入 §7 的 `ab_test.rollout` 灰度（开关已存在；rollout 由 G2 统一处理）。

---

## 模块 G：可观测与灰度（贯穿各模块）

### G1. 指标埋点
- [x] 在 PreFilter / SemanticClusterer / NeighborSignalMatcher 中输出核心指标（进入 detector 消息量、singleton 簇率、跨会话合并率、近邻召回率、false_positive 率）。
- [x] 复用 `logger` 体系输出 `local_ml` 运行期指标摘要（`SessionAnalyzer.logLocalMlSummary` 在 `performFullAnalysis` 结束时调用）。
- [ ] 在 `SignalDictionaryDB`（或新增 stats 表）中记录新旧链路对照指标，供 A/B 评估。**决策**：G1 的运行时指标（keptRate / singletonRate / recallProxy）已通过 logger 输出；SignalDictionaryDB 对照指标延期至 G2 灰度期有明确对比需求时实现。

### G2. A/B 灰度与回退
- [x] 在 `loadConfig().local_ml.ab_test` 中实现 `rollout` 流量比例控制（按 session 哈希分桶）—— `local-ml-rollout.ts` 的 `shouldUseNewPipeline`。
- [x] 确保每个子模块（prefilter / clusterer / signal_match / personalization）可独立回退到 `legacy`——config 内每个维度有独立 `enabled`/`mode` 开关，`shouldUseNewPipeline` 支持 per-dimension 桶。
- [x] 编写「新旧链路并行比对」脚本/命令，灰度期结束后按指标切流——`scripts/local-ml-ab-compare.mjs`。

---

## 模块 H：依赖与基础设施准备（前置，P0 之前）

> 现状核对：`src/mcp-server-ts/package.json` **当前无任何** `onnxruntime-node` / `FAISS-CPU` / `hnswlib` / `hdbscan` / `@xenova/transformers` / `natural` 依赖。以下任务需在对应阶段开始前完成，否则 P1/P2/P4 无法编译。

### H1. P0/P1 基础依赖（纯算法，可零外部依赖）
- [x] 确认 `MessageClusterer` 现有 TF-IDF 为自实现（无 `natural` 依赖）；字符 n-gram 版（C1）沿用自实现，**无需新增 npm 包**（已验证：`EmbeddingEncoder` 与 `MessageClusterer.buildTFIDFVectors` 均为纯 TS 自研，零外部依赖）。
- [ ] 引入聚类库：评估并安装 `hdbscan` 或纯 TS 的轻量 `simple-kmeans`（P1 的 D2 需要），写入 `package.json` 并 `npm install`。
- [ ] 在 `package.json` 记录新增依赖的用途注释，避免后续清理误删。

### H2. P2/P4 可选依赖（本地推理 / 近邻索引）
- [ ] 评估并安装近邻索引库 `hnswlib` 或 `FAISS-CPU`（E3 需要，纯 CPU）。
- [ ] 评估并安装本地推理：`onnxruntime-node` + 量化模型 `bge-small-zh` / `xlm-roberta-base` ONNX 权重（C3 需要，纯 CPU 推理）。
- [ ] 在 `loadConfig().local_ml` 中对这些可选依赖做「缺失即回退」校验（C3 / E3 的回退逻辑依赖此点），保证未安装时不崩溃。

---

## 依赖与执行顺序

```
H (依赖准备) ─► A (配置) ──► B (初筛)        ┐
                              ├─► C (编码器) ──────┼─► D (消息聚类) ─┐
                              │                      ├─► E (近邻匹配, 含E0切换) ┘
                              │                      └─► I (Pattern聚类) ──┐
                              └──────────────────────────────────────► F (个性化) ─► G (灰度)
```
- **H（前置）**：H1–H2（安装/确认依赖，P0 之前完成）
- **P0**：A + B1–B2（零成本初筛，降 token，无需新依赖）
- **P1**：C1–C2 + D1–D2（字符 n-gram + HDBSCAN 替代词面聚类，需 H1）
- **P2**：E0–E3（近邻信号匹配替代 Aho-Corasick，含上层实例化切换；可选 H2 近邻索引）
- **P2.5**：I1–I2（PatternClusterer 语义化，与 E/D 同属语义化改造）
- **P3**：F1–F3（per-user 在线个性化）
- **P4**：C3（可选 ONNX 本地小模型，需 H2）
- **全程**：G1–G2（可观测与灰度，与各阶段并行）

> P0 纯 TS、零外部依赖即可落地；P1 起需 H1 的聚类库；P2/P4 的可选增强需 H2 的近邻索引 / 本地推理依赖。全部组件纯 CPU、可本地运行。

### 已知设计文档缺口（建议回填）
- 设计文档 §0/§4 只覆盖 `MessageClusterer`，未提 `AdaptiveSessionAnalyzer` 内使用的 **`PatternClusterer`**（`pattern-clusterer.ts`）的 pattern 级聚类——已在任务模块 I 补齐。
- 设计文档 §4 描述 HDBSCAN 用法，但未在"实施路线/依赖"中列出需**安装聚类库**——已由任务模块 H1 补齐。
- 设计文档未显式说明 `NeighborSignalMatcher` 需在 `AdaptiveSessionAnalyzer` 实例化处切换——已由任务 E0 补齐。
