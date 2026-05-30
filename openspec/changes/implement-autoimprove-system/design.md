## Context

AutoImprove 的核心假设已通过原型验证（理想场景 100% 成功率，真实场景 60-80% 成功率）。现在需要将原型（`prototype/session_analyzer.py`）转化为生产系统，包括 MCP Server、Skill、存储系统等完整组件。

当前状态：
- 原型实现了核心算法（Pattern 检测、置信度计算、规则生成判断）
- 已有完整的设计文档（`openspec/` 目录下 10+ 个文档）
- Claude Code 提供 MCP 和 Skill 基础设施

约束：
- 必须使用 FastMCP 框架实现 MCP Server（Python）
- 必须与 Claude Code 的 Skill 系统集成
- 存储在用户目录 `~/.autoimprove/`，不能依赖外部数据库
- 规则加载必须快速（< 100ms），避免影响会话启动

## Goals / Non-Goals

**Goals:**
- 实现完整的 MCP Server，提供 5 个 tools 和 2 个 resources
- 实现 4 个 Skill（summarize、rules、lessons、status），提供用户交互
- 实现规则存储系统（索引 + 内容分离），支持快速加载和场景匹配
- 实现会话分析算法，支持 5 种 Pattern 类型和置信度计算
- 实现场景检测（三维模型：tech/functional/business）
- 提供清晰的用户交互流程（确认、冲突处理、渐进式披露）

**Non-Goals:**
- 不实现团队协作和规则共享（v1 只支持单用户）
- 不实现规则自动应用（始终需要用户确认）
- 不实现 Web UI（只通过 Claude Code 交互）
- 不实现实时会话监控（只分析已完成的会话）
- 不实现规则版本控制（v1 只支持简单的创建/更新/归档）

## Decisions

### Decision 1: 使用 FastMCP 实现 MCP Server

**选择**: FastMCP (Python)

**理由**:
- FastMCP 是 Anthropic 官方推荐的 Python MCP 框架
- 原型已用 Python 实现，可直接复用代码
- 支持 tools 和 resources，满足所有需求
- 开发速度快，适合快速迭代

**替代方案**:
- TypeScript MCP SDK: 需要重写原型，开发周期长
- 自定义 MCP 实现: 维护成本高，不推荐

### Decision 2: 索引 + 内容分离的存储架构

**选择**: 
- 轻量级索引文件 `rules/index.json`（元数据）
- 独立内容文件 `rules/content/rule-{id}.md`（完整内容）

**理由**:
- 索引文件小（< 100KB），可快速加载到内存
- 内容文件按需加载，避免启动时读取所有规则
- 支持规则数量扩展到数千条而不影响性能
- 便于人工查看和编辑（markdown 格式）

**替代方案**:
- SQLite: 增加依赖，对于简单的 key-value 存储过重
- 单一 JSON 文件: 规则增多后加载慢，不可扩展
- 纯文件系统: 没有索引，场景匹配需要遍历所有文件

### Decision 3: 三维场景模型（tech/functional/business）

**选择**: Scene = {tech: [], functional: [], business: []}

**理由**:
- tech（技术栈）: 容易检测（文件扩展名、import 语句）
- functional（功能域）: 中等难度（目录结构、文件名）
- business（业务域）: 需要推断 + 配置（关键词 + 用户配置）
- 三维模型提供足够的粒度，同时保持简单

**替代方案**:
- 单维度（只用 tech）: 粒度不够，规则冲突多
- 更多维度（加入 layer、pattern 等）: 过度设计，检测困难

### Decision 4: 分类策略（不同 Pattern 类型不同阈值）

**选择**: 
- repeated-correction: 0.45, 需要跨会话
- anti-pattern: 0.45, 需要测试验证（框架规则例外）
- preference: 0.3, 关键词加成
- performance: 0.4, 需要性能证据
- security: 0.3, 权重 ×1.5, critical 优先级

**理由**:
- 不同类型的可靠性不同，应该用不同标准
- 安全问题即使单次出现也应该生成规则
- 用户偏好的证据较弱，需要关键词辅助
- 框架规则（如 React hooks）是硬性规则，不需要测试验证

**替代方案**:
- 统一阈值 0.5: 过于严格，会错过很多有价值的规则
- 完全动态阈值: 复杂度高，难以调试和解释

### Decision 5: Skill 作为用户交互层，MCP Server 作为能力层

**选择**: 
- Skill: 复杂工作流、用户交互、多步骤协调
- MCP Server: 原子能力、无状态、可组合

**理由**:
- 分离关注点：MCP Server 专注算法和存储，Skill 专注用户体验
- 可测试性：MCP tools 可独立测试，不依赖 Claude Code
- 可复用性：MCP tools 可被其他客户端调用
- 符合 Claude Code 架构设计

**替代方案**:
- 全部放在 Skill: MCP Server 变成简单的数据存储，失去独立价值
- 全部放在 MCP Server: Skill 变成简单的转发，用户交互逻辑分散

### Decision 6: 规则需要用户确认，但加载是自动的

**选择**:
- 规则生成后需要用户确认才激活
- 激活的规则在会话启动时自动加载到 context
- 用户可以在会话中临时覆盖规则

**理由**:
- 确认环节保证用户控制权，避免错误规则
- 自动加载避免用户每次手动选择规则
- 临时覆盖提供灵活性，不影响规则本身

**替代方案**:
- 完全自动: 用户失去控制，错误规则会持续影响
- 完全手动: 用户负担重，规则利用率低

## Risks / Trade-offs

### Risk 1: 场景检测不准确导致规则匹配错误

**风险**: 业务域推断可能不准确，导致规则应用到错误的场景

**缓解**:
- 提供手动配置业务域映射（`config.json`）
- 场景检测返回置信度，低置信度时提示用户
- 规则匹配使用部分匹配（2/3 维度匹配即可）
- 用户可以手动包含/排除特定规则

### Risk 2: 规则数量增长导致 context 溢出

**风险**: 随着规则增多，自动加载的规则可能占用过多 context

**缓解**:
- 限制自动加载的规则数量（默认 top 10）
- 按优先级和相关性排序，只加载最相关的
- 提供 `/autoimprove-lessons` 查看所有规则，不自动加载
- 未来可实现规则摘要（只加载标题和关键信息）

### Risk 3: 置信度计算权重需要持续调优

**风险**: 当前权重是基于原型测试估算的，真实使用中可能不准确

**缓解**:
- 权重配置化，可在 `config.json` 中调整
- 记录规则使用统计（匹配次数、应用次数、用户反馈）
- 提供 `/autoimprove-status` 查看统计，辅助调优
- 计划在 v1.1 实现自动权重调优

### Risk 4: 会话文件格式变化导致解析失败

**风险**: Claude Code 会话文件格式可能变化，导致 Pattern 检测失败

**缓解**:
- 使用宽松的 JSON 解析（跳过无法解析的行）
- 记录解析错误到日志，便于调试
- 提供版本检测，识别不同格式的会话文件
- 保持与 Claude Code 团队沟通，提前获知格式变化

### Risk 5: 规则冲突难以自动解决

**风险**: 新规则可能与现有规则冲突，自动检测困难

**缓解**:
- v1 只做简单的文本相似度检测（描述相似度 > 0.8）
- 检测到冲突时提示用户手动解决
- 记录用户的解决方案，用于改进冲突检测
- v1.1 计划实现语义冲突检测（使用 embedding）

## Migration Plan

### Phase 1: MCP Server 实现（Week 1）

1. 搭建 FastMCP 项目结构
2. 实现存储层（index + content）
3. 实现 5 个 MCP tools（analyze_session, generate_rules, search_knowledge, update_rules, list_scenes）
4. 实现 2 个 MCP resources（knowledge://rules/, knowledge://lessons/）
5. 单元测试和集成测试

### Phase 2: Skill 实现（Week 2）

1. 实现 autoimprove-status（初始化 + 状态查看）
2. 实现 autoimprove-summarize（会话分析 + 规则生成）
3. 实现 autoimprove-rules（规则确认 + 冲突处理）
4. 实现 autoimprove-lessons（场景规则查看）
5. 端到端测试

### Phase 3: 集成和测试（Week 3）

1. 与 Claude Code 集成测试
2. 真实会话数据测试
3. 性能测试（启动时间、规则匹配速度）
4. 用户体验测试（确认流程、错误提示）
5. 文档编写（README、用户指南）

### Rollback Strategy

- MCP Server 独立部署，可单独回滚
- Skill 通过配置开关控制，可快速禁用
- 存储格式向后兼容，旧版本可读取新格式
- 提供数据导出工具，支持迁移到其他系统

## Open Questions

### Q1: 是否需要实现规则的自动衰减？

**背景**: 长时间未使用的规则可能已过时

**选项**:
- A: v1 不实现，手动归档
- B: 实现简单的时间衰减（90 天未使用降低置信度）
- C: 实现基于反馈的衰减（用户反馈负面时降低）

**倾向**: A（v1 保持简单，v1.1 再考虑）

### Q2: 是否支持规则的导入/导出？

**背景**: 用户可能想在多台机器间同步规则

**选项**:
- A: v1 不支持，用户手动复制 `~/.autoimprove/`
- B: 实现简单的导出（JSON 格式）
- C: 实现完整的导入/导出 + 冲突合并

**倾向**: B（导出简单，导入可以 v1.1 再做）

### Q3: 是否需要实现规则的 A/B 测试？

**背景**: 对于不确定的规则，可以先试用再决定是否保留

**选项**:
- A: v1 不支持
- B: 支持"试用模式"（规则生效但标记为试用，30 天后提示确认或删除）

**倾向**: A（v1 保持简单，通过置信度和用户确认保证质量）
