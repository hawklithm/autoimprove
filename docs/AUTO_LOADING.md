# AutoImprove - Automatic Rule Loading

## 概述

从现在开始，AutoImprove 会自动将学习到的规则加载到每次 Claude Code 会话中。

## 工作原理

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code Session                                    │
│  ├─ ~/.claude/CLAUDE.md (全局指令)                       │
│  │   └─ @~/.autoimprove/rules/claude-index.md          │
│  │       └─ 自动加载 Top 10 高价值规则                   │
│  └─ 每次会话自动应用相关规则                             │
└─────────────────────────────────────────────────────────┘
```

## 实现细节

### 1. **规则索引文件**
- **位置**: `~/.autoimprove/rules/claude-index.md`
- **内容**: 精选的 Top 10 规则（约 400 tokens）
- **更新**: 每次运行 `/autoimprove-summarize` 后自动更新

### 2. **自动加载机制**
- **引用位置**: `~/.claude/CLAUDE.md`
- **引用方式**: `@~/.autoimprove/rules/claude-index.md`
- **作用域**: 全局（所有项目）

### 3. **规则选择策略**

#### Category-Balanced（推荐）
- 🔴 30% Security (关键安全规则)
- 🟠 30% Repeated Corrections (反复修正的模式)
- 🟡 20% Anti-Patterns (反模式警告)
- 🔵 15% Performance (性能优化)
- ⚪ 5% Preferences (编码偏好)

#### Top-N
- 按置信度排序，取 Top N

### 4. **新增 MCP 工具**

```typescript
export_rules_to_claude_md({
  strategy: "category-balanced" | "top-n",
  limit: 10,           // 导出规则数量
  min_confidence: 0.6  // 最低置信度
})
```

## 使用流程

### 首次安装
```bash
./setup.sh
```

Setup 脚本会自动：
1. 在 `~/.claude/CLAUDE.md` 中添加规则引用
2. 创建初始的 `claude-index.md`
3. 配置 MCP 服务器

### 日常使用
```bash
# 分析会话并自动更新规则索引
/autoimprove-summarize

# 批量分析所有未分析的会话
/autoimprove-summarize --all

# 使用智能合并模式
/autoimprove-summarize --consolidate
```

执行后，系统会自动：
1. 检测编码模式
2. 生成规则
3. **导出 Top 10 规则到 claude-index.md** ✨（新功能）

### 查看规则
```bash
# 查看完整规则库
/autoimprove-rules

# 查看当前场景适用的规则
/autoimprove-lessons

# 查看系统状态
/autoimprove-status
```

## 规则索引格式示例

```markdown
# AutoImprove Learned Rules

> 这些规则从你的编码习惯中自动学习。规则会根据当前工作场景自动匹配。

## 🔴 Critical Security Rules

### [RULE-093] 安全规则 [置信度: 0.95]
**场景**: 任何涉及用户输入的代码
**关键词**: input, validation, sanitize
**规则**: 在处理任何用户输入前，必须进行验证和清理，防止注入攻击。

## 🟠 High Priority Patterns

### [RULE-001] 反复修正的模式 [置信度: 0.75]
**场景**: React + 认证
**关键词**: token, refresh, auth
**规则**: 实现自动 token 刷新时，应该在 token 过期前刷新...

---

💡 **动态匹配**: Claude 会根据你当前的代码场景自动应用相关规则。
📊 **完整规则库**: 运行 `/autoimprove-rules` 查看全部规则。
```

## Token 成本

| 规则数量 | 估计 Tokens | 占比 (150k context) |
|---------|------------|-------------------|
| Top 5   | ~200       | 0.13%            |
| Top 10  | ~400       | 0.27%            |
| Top 20  | ~800       | 0.53%            |

**推荐**: Top 10（默认），平衡价值与成本。

## 优势

### ✅ 自动化
- 无需手动调用 `/autoimprove-lessons`
- 规则自动加载到每次会话
- 后台持续学习

### ✅ 智能匹配
- 运行时根据场景过滤
- 只应用相关规则
- 减少干扰

### ✅ 持续改进
- 跨项目学习
- 规则逐步积累
- 自动优化

### ✅ 可控成本
- 精选高价值规则
- Token 占用低
- 完整库按需查询

## 手动更新规则索引

如果需要手动触发规则导出：

```typ 通过 MCP 工具直接调用
mcp__autoimprove-core__export_rules_to_claude_md({
  strategy: "category-balanced",
  limit: 10,
  min_confidence: 0.6
})
```

或通过 Claude：
```
请调用 export_rules_to_claude_md 工具，使用 category-balanced 策略导出 10 条规则
```

## 文件结构

```
~/.autoimprove/
├── rules/
│   ├── index.json              # 完整规则元数据
│   ├── content/                # 完整规则内容
│   │   ├── rule-001.md
│   │   └── ...
│   └── claude-index.md         # ⭐ Claude 自动加载的索引

~/.claude/
└── CLAUDE.md                   # ⭐ 包含对 claude-index.md 的引用
```

## 故障排除

### 规则未自动加载
1. 检查 `~/.claude/CLAUDE.md` 是否包含引用：
   ```bash
   grep "claude-index.md/.claude/CLAUDE.md
   ```

2. 检查索引文件是否存在：
   ```bash
   cat ~/.autoimprove/rules/claude-index.md
   ```

3. 重新运行 setup：
   ```bash
   ./setup.sh
   ```

### 规则内容为空
运行 `/autoimprove-summarize` 至少一次以生成规则。

### 更新未生效
重启 Claude Code 或开始新会话。

## 与旧版本的区别

| 功能 | 旧版本 | 新版本 |
|-----|-------|-------|
| 规则加载 | 手动调用 `/autoimprove-lessons` | ✅ 自动加载 |
| 规则选择 | 运行时查询 | ✅ 预先精选 |
| 作用域 | 单次对话 | ✅ 所有会话 |
| Token 成本 | 按需（可能很高） | ✅ 固定低成本 |

## 版本信息

- **引入版本**: v0.2.0
- **相关 Issue**: N/A
- **文档更新**: 2026-06-04
