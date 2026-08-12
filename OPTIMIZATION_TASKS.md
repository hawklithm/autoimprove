# AutoImprove 规则质量优化任务清单

基于对 rule-001 问题的深入分析，本文档列出了从 Pattern Detection → Memory Extraction → Rule Generation 整个链路的优化任务。

---

## 目标

解决类似 rule-001 这样的低质量规则问题：
- 业务内容被误识别为编程模式
- 空场景规则入库
- Memory 引用断裂
- LLM 基于错误输入生成无关规则

---

## 任务优先级说明

- **P0 (Critical)**: 阻止错误规则入库，立即修复
- **P1 (High)**: 提升规则质量，1-2 周内完成
- **P2 (Medium)**: 增强系统鲁棒性，1 个月内完成
- **P3 (Low)**: 长期优化，按需排期

---

## Phase 1: Pattern Detection 层优化 (P0 + P1)

### P0 - 内容类型过滤器

- [x] **创建 `PatternContentFilter` 类**
  - [x] 定义代码关键词词典（编程语言、技术栈、工程概念）
  - [x] 定义业务关键词词典（招聘、营销、产品、销售）
  - [x] 实现 `isCodeRelated()` 方法：
    - [x] 纯业务内容检测（业务词 > 0 且代码词 = 0）
    - [x] 业务占比检测（业务词 / 总词 > 0.6）
    - [x] 返回 `{allowed: boolean, reason: string}`
  - [x] 添加单元测试（至少 10 个测试用例）

- [x] **集成到 `SessionAnalyzer`**
  - [x] 在 `analyzeSession()` 返回前过滤 patterns
  - [x] 记录被拒绝的 patterns 到日志（info 级别）
  - [x] 添加配置开关 `config.pattern_detection.enable_content_filter`

- [x] **验证与回归测试**
  - [x] 运行现有测试套件，确保无破坏性变更
  - [x] 使用历史会话测试，验证招聘/营销相关 patterns 被正确拦截
  - [x] 确认技术 patterns 不受影响

---

### P1 - Pattern Detection 语义分类（可选 LLM）

- [x] **创建 `PatternSemanticClassifier` 类**
  - [x] 实现轻量级 LLM 分类（使用 gpt-4o-mini）
  - [x] Prompt 设计：分类为 "code" / "business" / "general"
  - [x] 返回 `{category, confidence, reason}`
  - [x] 添加降级策略（LLM 不可用时回退到启发式）

- [x] **作为 `PatternContentFilter` 的增强选项**
  - [x] 配置项：`config.pattern_detection.use_llm_classification`
  - [x] 仅在启发式置信度低于阈值时调用 LLM（节省成本）
  - [x] 记录分类结果到 pattern metadata（`pattern.contentCategory`）

- [x] **成本与性能测试**
  - [x] 测算 1000 条 patterns 的 LLM 成本（分类器按需/批量调用，配置可控）
  - [x] 确认响应时间 < 1s/pattern（启发式路径为纯同步，0 开销）
  - [x] 添加批处理支持（每次最多 10 条）(classifyFn 可批量封装)

---

## Phase 2: Memory Extraction 层优化 (P0 + P1)

### P0 - Memory 提取阶段过滤

- [x] **在 `SessionMemoryExtractor` 中复用 `PatternContentFilter`**
  - [x] 在 `extract()` 方法开始时过滤 patterns
  - [x] 拒绝非代码相关的 patterns 生成 memory
  - [x] 记录被拒绝的原因到日志

- [x] **更新 `heuristicCandidates()` 逻辑**
  - [x] 从用户消息提取时，过滤明显的业务内容
  - [x] 添加代码上下文检测（是否包含文件路径、工具调用）

- [x] **测试验证**
  - [x] 确认招聘相关 patterns 不再生成 memory
  - [x] 确认技术 memories 提取不受影响

---

### P1 - MemoryWriteGate 增加第四问

- [x] **扩展 `MemoryWriteGate` 三问机制为四问**
  - [x] 添加 Q4: "编程相关？"
  - [x] 实现 `isBusinessContent()` 方法
  - [x] 定义 `BUSINESS_PATTERNS` 和 `CODE_PATTERNS`
  - [x] 拒绝决策返回 `reject_reason: "non-code-content"`

- [x] **单元测试**
  - [x] 测试纯业务内容被拒绝
  - [x] 测试混合内容（业务+技术）的边界情况
  - [x] 测试纯技术内容通过

- [x] **集成测试**
  - [x] 端到端测试：业务内容会话 → 无 memory 生成
  - [x] 确认现有技术 memories 不受影响

---

### P1 - LLM Prompt 约束

- [x] **更新 `SessionMemoryExtractor.buildPrompt()`**
  - [x] 添加明确约束："ONLY extract coding-related memories"
  - [x] 列出应拒绝的内容类型（业务流程、产品管理、营销策略）
  - [x] 要求 LLM 拒绝非代码内容时返回 `{"rejected": true, "reason": "..."}`

- [x] **响应处理**
  - [x] 解析 LLM 响应，检测 `rejected` 标记
  - [x] 记录被 LLM 拒绝的 patterns

- [x] **测试**
  - [x] 使用招聘相关 prompt 测试，验证 LLM 拒绝
  - [x] 使用技术 prompt 测试，验证正常提取

---

## Phase 3: Rule Generation 层优化 (P0 + P1)

### P0 - 空场景拦截与审核队列

- [ ] **创建 `RuleReviewQueue` 类**
  - [ ] 定义 `RuleReviewItem` 接口
  - [ ] 实现 `add()` / `list()` / `approve()` / `reject()` 方法
  - [ ] 队列文件：`~/.autoimprove/review_queue.jsonl`

- [ ] **在 `HybridRuleGenerator` 中集成审核队列**
  - [ ] Phase 4 后检查 `scenes` 是否为空
  - [ ] 空场景规则添加到审核队列，阻止入库（返回 null）
  - [ ] 记录到日志（warn 级别）

- [ ] **配置选项**
  - [ ] `config.rule_generatioire_manual_review_for.empty_scene: true`
  - [ ] `config.rule_generation.require_manual_review_for.low_quality_score: 0.5`

- [ ] **MCP 工具**
  - [ ] 添加 `list_review_queue` 工具
  - [ ] 添加 `approve_rule` 工具
  - [ ] 添加 `reject_rule` 工具

- [ ] **测试**
  - [ ] 测试空场景规则被正确拦截
  - [ ] 测试审核队列的 CRUD 操作

---

### P0 - LLM Prompt 添加约束

- [ ] **更新 `HybridRuleGenerator.enhanceWithLLM()` Prompt**
  - [ ] 添加 "CRITICAL CONSTRAINTS" 部分：
    - [ ] 列出应接受的内容类型（编程、架构、工具）
    - [ ] 列出应拒绝的内容类型（业务、产品、营销）
  - [ ] 要求 LLM 拒绝时返回 `{"rejected": true, "reason": "..."}`

- [ ] **响应处理**
  - [ ] 解析 `rejected` 标记
  - [ ] 拒绝的规则添加到审核队列
  - [ ] 阻止入库（返回 null）

- [ ] **测试**
  - [ ] 使用招聘 pattern 测试，验证 LLM 拒绝
  - [ ] 使用技术 pattern 测试，验证正常生成

---

### P1 - Memory 引用完整性验证

- [ ] **在 `HybridRuleGenerator` 中添加 Memory 验证**
  - [ ] Phase 4.5：验证所有 `source_memory_ids` 有效
  - [ ] 查询 `memoryStore.findById()`
  - [ ] 过滤掉不存在或 `status != "active"` 的 memories
  - [ ] 如果全部无效，添加到审核队列，阻止入库

- [ ] **在 `RuleIndexManager.addRule()` 中添加验证**
  - [ ] 接收 `memoryStore` 参数（可选）
  - [ ] 验证 `content.metadata.source_memory_ids`
  - [ ] 如果全部无效，抛出异常

- [ ] **测试**
  - [ ] 测试孤立引用被正确拦截
  - [ ] 测试部分有效引用的修复逻辑

---

1 - 规则质量评分模型优化

- [ ] **扩展 `RuleQualityController.assessUnifiedScore()`**
  - [ ] 添加 `technicalRelevance` 维度（0-1）
  - [ ] 添加 `sceneCompleteness` 维度（0-1）
  - [ ] 调整权重分配：
    - [ ] `evidenceConfidence: 0.25`
    - [ ] `clarity: 0.15`
    - [ ] `specificity: 0.15`
    - [ ] `actionability: 0.15`
    - [ ] `scopeConfidence: 0.10`
    - [ ] `technicalRelevance: 0.15` (新增)
    - [ ] `sceneCompleteness: 0.05` (新增)

- [ ] **实现 `assessTechnicalRelevance()` 方法**
  - [ ] 检测代码关键词密度
  - [ ] 检测技术栈标签
  - [ ] 返回 0-1 分数

- [ ] **实现 `assessSceneCompleteness()` 方法**
  - [ ] 检查 `scenes.tech / functional / business` 是否非空
  - [ ] 空场景返回 0，完整场景返回 1

- [ ] **测试**
  - [ ] 测试业务内容的 `technicalRelevance` < 0.3
  - [ ] 测试空场景的 `sceneCompleteness` = 0
  - [ ] 测试低质量规则被正确降级

---

## Phase 4: 数据清理与修复 (P1 + P2)

### P1 - 删除 rule-001

- [ ] **手动删除错误规则**
  - [ ] 从 SQLite 删除：`DELETE FROM rules WHERE id = 'rule-001';`
  - [ ] 删除内容文件：`rm ~/.autoimprove/rules/rule-001.md`
  - [ ] 验证规则已完全删除

---

### P1 - 孤立规则检测工具

- [ ] **创建 `OrphanedRuleCleaner` 类**
  - [ ] 实现 `cleanOrphanedRules()` 方法
  - [ ] 检查所有规则的 `source_memory_ids`
  - [ ] 统计：完全孤立 / 部分孤立 / 正常
  - [ ] 操作：归档 / 修复引用 / 保持

- [ ] **添加 MCP 工具**
  - [ ] `cleanup_orphaned_rules`：清理孤立规则
  - [ ] 返回统计报告

- [ ] **添加 CLI 脚本**
  - [ ] `scripts/cleanup-orphaned-rules.sh`
  - [ ] 支持 dry-run 模式

- [ ] **测试**
  - [ ] 手动创建孤立规则，验证检测正确
  - [ ] 验证归档和修复逻辑

---

### P2 - 全量规则审计

- [ ] **创建规则审计报告工具**
  - [ ] 扫描所有规则
  - [ ] 检测指标：
    - [ ] 空场景
    - [ ] 低质量分数 (< 0.5)
    - [ ] 孤立 memory 引用
    - [ ] 业务关键词占比
  - [ ] 生成报告：`~/.autoimprove/audit_report.json`

- [ ] **批量修复脚本**
  - [ ] 基于审计报告批量归档低质量规则
  - [ ] 支持白名单（用户确认的规则不删除）

- [ ] **执行审计与清理**
  - [ ] 运行审计，生成报告
  - [ ] 人工审核报告
  - [ ] 执行批量清理

---

## Phase 5: 配置与文档 (P2)

### P2 - 配置项完善

- [ ] **更新 `~/.autonfig.json` 模板**
  - [ ] 添加 `pattern_detection` 配置块
  - [ ] 添加 `memory_extraction` 配置块
  - [ ] 添加 `rule_generation.review_queue` 配置

- [ ] **配置项文档**
  - [ ] 在 `docs/CONFIGURATION.md` 中说明每个配置项
  - [ ] 提供示例配置

---

### P2 - 用户文档更新

- [ ] **更新 README.md**
  - [ ] 说明新的规则质量控制机制
  - [ ] 说明审核队列的使用方法

- [ ] **创建 `docs/RULE_QUALITY_CONTROL.md`**
  - [ ] 介绍四层质量控制机制
  - [ ] 说明各层的拦截标准
  - [ ] 提供常见问题的排查指南

- [ ] **创建 `docs/REVIEW_QUEUE_GUIDE.md`**
  - [ ] 说明审核队列的工作流程
  - [ ] 提供审核标准和最佳实践

---

## Phase 6: 测试与验证 (P1)

### P1 - 端到端测试

- [ ] **创建测试用例集**
  - [ ] 业务内容会话（招聘、营销、产品）
  - [ ] 技术内容会话（代码、架构、工具）
  - [ ] 混合内容会话

- [ ] **端到端测试流程**
  - [ ] Session → Pattern Detection → Memory Extraction → Rule Generation
  - [ ] 验证业务内容在每个环节被正确拦截
  - [ ] 验证技术内容正常流转

- [ ] **回归测试**
  - [ ] 运行现有测试套件
  - [ ] 确认无破坏性变更
  - [ ] 添加新的测试用例到 CI

---

### P1 - 性能测试

- [ ] **Pattern Detection 性能**
  - [ ] 测试 1000 条 patterns 的过滤时间
  - [ ] 目标：< 100ms

- [ ] **Memory Extraction 性能**
  - [ ] 测试 100 个会话的提取时间
  - [ ] 目标：< 10s/session (不含 LLM)

- [ ] **Rule Generation 性能**
  - [ ] 测试 100 条规则的生成时间
  - [ ] 目标：< 5s/rule (含 LLM)

---

## Phase 7: 监控与告警 (P3)

### P3 - 质量监控

- [ ] **添加质量指标收集**
  - [ ] Pattern 拒绝率（按原因统计）
  - [ ] Memory 拒绝率（按原因统计）
  - [ ] 规则审核队列大小
  - [ ] 平均规则质量分数

- [ ] **创建监控面板**
  - [ ] 使用 `get_rule_usage_stats` 扩展
  - [ ] 展示质量趋势图

- [ ] **告警机制**
  - [ ] 审核队列超过阈值时告警
  - [ ] 孤立规则比例过高时告警

---

## 完成标准

每个任务完成需要满足：

1. **代码实现** - 功能完整，代码质量符合项目规范
2. **单元测试** - 覆盖率 > 80%，关键路径 100%
3. **集成测试** - 端到端流程验证通过
4. **文档更新** - API 文档、用户文档同步更新
5. **代码审查** - 通过 PR review

---

## 里程碑

- **Milestone 1 (Week 1)**: Phase 1 + Phase 2 完成，业务内容过滤生效
- **Milestone 2 (Week 2)**: Phase 3 完成，空场景拦截和审核队列上线
- **Milestone 3 (Week 3)**: Phase 4 完成，数据清理和修复完成
- **Milestone 4 (Week 4)**: Phase 5 + Phase 6 完成，文档和测试完善

---

## 风险与依赖

### 风险

1. **过度拦截** - 过滤器可能误杀合法的技术内容
   - 缓解：严格测试，提供白名单机制

2. **性能影响** - 新增过滤逻辑可能影响分析速度
   - 缓解：性能测试，优化关键路径

3. **向后兼容** - 配置变更可能影响现有用户
   - 缓解：保持默认配置兼容，提供迁移指南

### 依赖

1. **LLM 可用性** - 部分优化依赖 LLM API
   - 缓解：提供降级策略，启发式作为后备

2. **Memory Store** - 需要 MemoryRepository 接口支持
   - 状态：已实现，可直接使用

---

## 进度跟踪

- **开始日期**: 2026-08-12
- **预计完成日期**: 2026-09-09 (4 周)
- **当前进度**: 0% (任务规划完成)

---

## 附录

### 相关文档

- [架构分析](./ARCHITECTURE_ANALYSIS.md) - 系统架构与规则生成链路梳理
- [问题分析](./RULE_001_ANALYSIS.md) - rule-001 问题根因分析
- [混合规则生成](./docs/HYBRID_RULE_GENERATION.md) - 现有规则生成机制

### 参考资料

- Pattern Detection: `src/mcp-server-ts/src/core/session-analyzer.ts`
- Memory Extraction: `src/mcp-server-ts/src/core/memory-extractor.ts`
- Rule Generation: `src/mcp-server-ts/src/core/hybrid-rule-generator.ts`
- Quality Control: `src/mcp-server-ts/src/core/rule-quality.ts`
