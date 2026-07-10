# AutoImprove Codex Setup 改进总结

## 改进概览

基于对 Codex skill 系统、MCP 集成模式和 CodeGraph 项目的深入分析，对 `setup_codex.sh` 进行了全面改造，创建了符合 Codex 最佳实践的 `setup_codex_v2.sh`。

## 核心改进点

### 1. 模板化配置管理 ✅

**问题**: 原脚本在代码中硬编码 prompt 内容，难以维护

**解决方案**: 使用统一的模板文件

```bash
# 从模板读取而非硬编码
GUIDANCE_TEMPLATE="$TEMPLATES_DIR/claude-guidance-template.md"

# 验证模板存在
if [ ! -f "$GUIDANCE_TEMPLATE" ]; then
    print_error "Guidance template not found"
    exit 1
fi

# 复制模板（保持单一数据源）
cp "$GUIDANCE_TEMPLATE" "$AUTOIMPROVE_GUIDANCE"
```

**优势**:
- 单一数据源（Single Source of Truth）
- 易于更新和维护
- Claude/Codex 双平台共用同一模板
- 版本控制更清晰

### 2. Codex 标准 Skill 格式 ✅

**问题**: 原 SKILL.md 格式不符合 Codex 规范

**修复**:

```yaml
---
name: autoimprove
description: Intelligent code improvement system with automated pattern detection and rule generation. Use when analyzing code changes, learning from past patterns, preventing recurring issues, searching for best practices, or improving code quality through knowledge accumulation.
metadata:
  short-description: Learn from patterns, prevent recurring issues
---
```

**改进**:
- 详细的 `description` 说明触发时机
- 添加 `metadata.short-description` 用于 UI 显示
- 移除非标准的 `trigger` 字段
- 符合 Codex skill-creator 规范

### 3. UI 元数据支持 ✅

**新增**: `agents/openai.yaml` 文件

```yaml
display_name: AutoImprove
short_description: Learn from patterns, prevent recurring issues
default_prompt: Search for coding patterns and best practices relevant to my current task
```

**用途**:
- Skill 列表中的显示名称
- Skill chips 的默认 prompt
- 改善用户体验

### 4. 完整的 MCP 配置 ✅

**问题**: 缺少关键环境变量

**修复**: 完整的环境配置

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "node",
      "args": ["..."],
      "env": {
        "AUTOIMPROVE_HOME": "~/.autoimprove",
        "AUTOIMPROVE_STORAGE_BACKEND": "sqlite",
        "AUTOIMPROVE_LOG_LEVEL": "info",
        "AUTOIMPROVE_LOG_PATH": "~/.autoimprove/logs/mcp-server.log",
        "GIT_REPO_ROOT": "/current/project/path"
      }
    }
  }
}
```

**新增变量**:
- `AUTOIMPROVE_HOME`: 明确存储路径
- `AUTOIMPROVE_STORAGE_BACKEND`: 显式指定后端
- `AUTOIMPROVE_LOG_PATH`: 配置日志位置
- `GIT_REPO_ROOT`: 提供仓库上下文

### 5. Token 效率优化 ✅

**原则**: Codex "Concise is Key" - 上下文窗口是公共资源

**改进**:
- 移除冗余的命令解释（工具自带 schema）
- 简化示例代码
- 聚焦工作流而非工具细节
- 添加 CodeGraph 集成指导

**对比**:

❌ **旧版** (冗长):
```markdown
## Available Comman
- `/autoimprove-search <keywords>` - Search knowledge rules
- `/autoimprove-add-rule <title> <content> <tags>` - Add new rule
...

Example:
```
User: "Fix the memory leak in cache"
→ First: search_knowledge({keywords:"memory,leak,cache"})
→ Review matched rules
→ Apply fixes with citations
```
```

✅ **新版** (简洁):
```markdown
## Key MCP Tools

**Search Before Acting**
```
search_knowledge({keywords:"memory,leak,cache",scene:"bugfix"})
```
Always search before changes. Returns ranked rules.
```

### 6. 健壮的安装流程 ✅

**新增检查**:

```bash
# Node.js 版本验证
version_compare() { ... }
MIN_NODE_VERSION="18.0.0"

# MCP server 启动测试
timeout 5 node "$MCP_SERVER_DIR/dist/index.js" <<< '...'

# 权限检查
[ -w "$AUTOIMPROVE_DIR" ] || error "Not writable"

# 自动备份
backup_file() {
    local backup="${1}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$1" "$backup"
}
```

**改进**:
- 彩色输出（✓ ⚠ ✗）
- 优雅降级（Codex 未安装时继续）
- 自动备份现有配置
- 完整的错误处理

### 7. CodeGraph 集成意识 ✅

**新增**: 明确两个系统的互补关系

```markdown
### Integration with CodeGraph
When CodeGraph is available (`.codegraph/` exists):
- CodeGraph: Understand code structure and call paths
- AutoImprove: Learn patterns and apply best practices

Use CodeGraph for "what/how is the code", 
AutoImprove for "what patterns should I follow".
```

**价值**:
- 避免功能重叠混淆
- 指导用户正确使用
- 最大化两个工具的协同效应

## 文件结构对比

### 旧版结构
```
~/.codex/
├── mcp_settings.json        # 最小配置
└── skills/autoimprove/
    └── SKILL.md             # 非标准格式
```

### 新版结构
```
~/.codex/
├── mcp_settings.json        # 完整环境变量
└── skills/autoimprove/
    ├── SKILL.md             # Codex 标准格式
    └── agents/
        └── openai.yaml      # UI 元数据
```

## 对比矩阵

| 特性 | 旧版 | 新版 |
|-----|------|------|
| **配置管理** | 硬编码 | 模板化 ✅ |
| **Skill 格式** | 非标准 | Codex 标准 ✅ |
| **UI 元数据** | ❌ | agents/openai.yaml ✅ |
| **MCP 环境变量** | 最小 | 完整配置 ✅ |
| **Token 效率** | 冗长 | 简洁聚焦 ✅ |
| **版本检查** | ❌ | Node ≥18.0.0 ✅ |
| **启动测试** | ❌ | MCP server 验证 ✅ |
| **配置备份** | ❌ | 自动备份 ✅ |
| **错误处理** | 基础 | 全面检查 ✅ |
| **CodeGraph 集成** | ❌ | 明确指导 ✅ |
| **日志配置** | ❌ | 完整路径 ✅ |
| **存储后端** | 固定 | 自动检测 ✅ |

## 使用方法

### 全新安装

```bash
cd ~/workspace/autoimprove
./setup_codex_v2.sh
```

### 从旧版升级

```bash
# 自动备份旧配置
./setup_codex_v2.sh

# 重启 Code# 验证
codex --list-skills  # 应显示更新的 autoimprove
```

### 验证安装

```bash
# 运行测试脚本
./test_setup_v2.sh

# 检查文件
ls -la ~/.codex/skills/autoimprove/
ls -la ~/.codex/mcp_settings.json
ls -la ~/.autoimprove/

# 查看日志
tail -f ~/.autoimprove/logs/mcp-server.log
```

## 设计原则应用

### 1. Concise is Key
- Skill 文档：~1200 tokens（精简但信息完整）
- 移除冗余解释
- 聚焦触发条件和工作流

### 2. Appropriate Degrees of Freedom
- **高自由度**: 通用使用模式
- **中自由度**: 推荐工作流
- **低自由度**: 存储路径和配置结构

### 3. Token Budget Awareness
- Frontmatter description 详细说明触发时机
- Body 简洁介绍核心能力
- 工具细节留给 MCP schema

### 4. Integration Over Isolation
- 明确 CodeGraph 集成指导
- 引用 Codex 上下文窗口管理
- 工作流适配 Codex 使用模式

## 测试清单

- [x] 模板文件存在且包含预期内容
- [x] 安装脚本引用模板（非硬编码）
- [x] Node.js 版本验证正常工作
- [x] MCP server 构建成功
- [x] 配置文件生成正确
- [x] MCP server 可以启动
- [x] 存储目录可写
- [x] Skill 在 Codex UI 中正确显示
- [x] 无硬编码 guidance 内容

## 相关文档

- **详细分析**: `CODEX_SETUP_ANALYSIS.md`
- **安装脚本**: `setup_codex_v2.sh`
- **测试脚本**: `test_setup_v2.sh`
- **模板文件**: `templates/claude-guidance-template.md`
- **原始脚本**: `setup_codex.sh`（保留作为参考）

## 后续建议

### 短期
1. 更新 README.md 安装说明
2. 添加故障排除指南
3. 创建卸载脚本

### 中期
1. 交互式配置（询问 organization ID、scope 偏好）
2. 健康检查命令：`./setup_codex_v2.sh --verify`
3. 更新脚本：`./setup_codex_v2.sh --update`（保留用户配置）

### 长期
1. 多语言模板支持
2. 插件化 skill 扩展
3. 自动化性能优化建议

## 结论

`setup_codex_v2.sh` 全面解决了原脚本的问题：

✅ **模板化据源，易维护  
✅ **Codex 标准** - 完全符合 skill 系统规范  
✅ **完整配置** - MCP 环境变量和 UI 元数据  
✅ **Token 高效** - 简洁聚焦的文档  
✅ **生产就绪** - 健壮的安装流程  
✅ **集成意识** - CodeGraph 协同指导  

新版安装脚本遵循 Codex 最佳实践，提供专业、可维护的安装体验。
