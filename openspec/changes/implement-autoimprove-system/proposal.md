## Why

Claude Code 用户在多次会话中重复修正相同的错误（如忘记使用特定的辅助函数、违反团队约定等），导致效率低下。AutoImprove 通过分析会话历史自动学习这些模式并生成可重用的规则，让 Claude 在未来的会话中自动遵守这些规则，减少重复修正。原型验证已证明核心假设成立（理想场景 100% 成功率，真实场景 60-80% 成功率），现在需要实现完整的生产系统。

## What Changes

- 新增 MCP Server (`autoimprove-core`)，提供会话分析、规则生成、知识库管理等核心能力
- 新增 4 个 Skill（`autoimprove-summarize`、`autoimprove-rules`、`autoimprove-lessons`、`autoimprove-status`），提供用户交互界面
- 实现会话分析算法，支持 5 种 Pattern 类型检测（repeated-correction、anti-pattern、preference、performance、security）
- 实现置信度计算系统（v2.0 公式），包括关键词检测、分类策略、优先级系统
- 实现规则存储和索引系统（`~/.autoimprove/`），支持快速加载和场景匹配
- 实现规则生命周期管理（创建、激活、更新、衰减、归档）

## Capabilities

### New Capabilities

- `session-analysis`: 从 Claude Code 会话记录中提取 Pattern，计算置信度，判断是否生成规则
- `rule-generation`: 根据 Pattern 生成结构化规则，包括内容、原因、适用场景、优先级等
- `knowledge-storage`: 规则和会话数据的持久化存储，支持索引和快速检索
- `scene-detection`: 检测当前会话的场景（技术栈、功能域、业务域），用于规则匹配
- `rule-matching`: 根据当前场景匹配相关规则，按优先级排序
- `mcp-server`: FastMCP 实现的 MCP Server，提供 5 个 tools 和 2 个 resources
- `skill-orchestration`: 4 个 Skill 的工作流程，协调 MCP tools 完成复杂任务
- `user-interaction`: 用户交互设计，包括规则确认、冲突处理、渐进式披露

### Modified Capabilities

<!-- 无现有能力需要修改 -->

## Impact

**新增组件**:
- `~/.autoimprove/` - 用户数据目录（规则、会话、配置）
- `src/mcp-server/` - MCP Server 实现
- `src/skills/` - Skill 实现
- `prototype/` - 保留原型代码作为参考

**依赖**:
- FastMCP (Python) - MCP Server 框架
- Claude Code MCP Client - 调用 MCP tools
- Claude Code Skill System - 注册和执行 skills

**用户体验**:
- 用户需要首次运行 `/autoimprove-status` 初始化系统
- 会话结束后可选运行 `/autoimprove-summarize` 分析会话
- 生成的规则需要用户确认后才会激活
- 规则会在未来会话中自动加载到 Claude 的 context
