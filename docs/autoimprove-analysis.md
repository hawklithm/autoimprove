# AutoImprove 问题分析与解决方案

**日期**: 2026-07-05  
**问题类型**: MCP 工具设计缺陷 + AI 触发逻辑误解  
**状态**: 部分修复，需上游改进

---

## 执行摘要

在调试服务端超时宕机问题时，发现 AutoImprove MCP 工具存在两个关键问题：
1. AI 没有在诊断阶段触发 `search_knowledge`（触发时机理解错误）
2. `search_knowledge` 返回的规则缺少实际内容（API 设计缺陷）

**已修复**: 通过 `export_rules_to_claude_md` 将规则导出到系统提示中  
**待修复**: 需要 AutoImprove 开发者改进 MCP API 设计

---

## 问题1：AutoImprove 触发时机错误

### 背景

用户请求："结合日志分析下为什么服务端宕机了，梳理原因并给出解决方案"

AI 的行为：
- ❌ 直接读取日志文件并分析
- ❌ 没有调用 `search_knowledge` 检查历史经验
- ❌ 理由：认为这只是"读取分析"，不是"修复代码"

### 根本原因

**对 CLAUDE.md 规则的误解**：

```markdown
| user intent | Action | Example |
| "Fix/Debug/Resolve Y" | `search_knowledge` keywords | search_knowledge({keywords: "async,error,state"})
```

**错误理解**：
- 只有在写代码修复问题时才搜索
- 诊断分析和代码修复是两个独立阶段

**正确理解**：
- **诊断本身就是 Debug/Resolve 的一部分**
- 历史知识库可能包含类似问题的解决方案
- 应该在分析日志**之前**先搜索相关经验

### 正确的执行流程

```
用户："分析为什么服务端宕机"
  ↓
[STEP 1] 调用 search_knowledge
  - keywords: "timeout,server,crash,humanize,async"
  - scene: {"tech":["python","fastapi"],"functional":["debugging","performance"]}
  ↓
[STEP 2] 查看历史规则
  - 是否有类似超时问题的解决方案？
  - 是否有 long-running 任务的最佳实践？
  ↓
[STEP 3] 读取日志文件
  - mcp-server/logs/mcp_server.log
  - mcp-server/logs/server.log
  ↓
[STEP 4] 结合历史经验 + 日志分析给出诊断
  - 引用相关规则 ID
  - 说明为什么这个规则适用
```

### 修复方案

**更新 CLAUDE.md 规则描述**：

```markdown
| user intent | Action | When to trigger |
|---|---|---|
| "Fix/Debug/Resolve Y" | `search_knowledge` FIRST | ⚠️ BEFORE reading logs/code |
| "Analyze/Diagnose X" | `search_knowledge` FIRST | ⚠️ Diagnosis is part of debugging |
```

**关键原则**：
- ✅ **诊断 = Debug 的第一步，必须搜索**
- ✅ **分析日志前先搜索历史经验**
- ✅ **"为什么宕机" = Resolve 类问题**

---

## 问题2：`search_knowledge` 返回内容不完整

### 问题描述

调用 `search_knowledge` 后，返回的 JSON 数据只包含元数据，缺少规则的实际内容：

```json
{
  "success": true,
  "matches_count": 10,
  "matches": [
    {
      "rule": {
        "id": "rule-001",
        "type": "repeated-correction",
        "priority": "medium",
        "confidence": 0.804,
        "scenes": {"tech": [], "functional": [], "business": []},
        "keywords": []  // ❌ 空数组！
      },
      "relevance": 0.425,
      "reason": "no scene specified"
    }
  ]
}
```

**缺失的关键字段**：
- ❌ `title`: 规则标题
- ❌ `description`: 规则描述
- ❌ `how_to_apply`: 应用方法
- ❌ `when_to_use`: 使用场景
- ❌ `content`: 完整内容

### 根本原因

**AutoImprove MCP 服务器的 API 设计问题**：

1. **规则内容与索引分离**：
   - 索引：`~/.autoimprove/rules/index.json`（只有元数据）
   - 内容：`~/.autoimprove/rules/content/rule-001.md`（完整 Markdown）

2. **`search_knowledge` 只查询索引**：
   - 返回匹配的规则 ID 列表
   - 不读取 `content/*.md` 文件
   - 导致 AI 无法获取规则的实际指导内容

3. **缺少规则详情查询 API**：
   - ❌ 没有 `get_rule_details(rule_id)` 工具
   - ❌ 没有 `read_rule(rule_id)` 工具
   - ❌ 无法二次查询获取完整内容

# 规则内容示例

实际的 `rule-001.md` 包含完整内容：

```markdown
---
type: repeated-correction
priority: medium
confidence: 0.804
keywords: ["api", "atomic", "locking"]
---

# Prefer atomic operations over exposing granular low-level methods

## Description
When designing APIs or agent interfaces, expose high-level atomic 
operations that encapsulate multiple steps (like atomic_write_chapter) 
rather than individual low-level methods (lock_chapter, save_chapter_text, 
update_chapter_status, unlock_chapter).

## How to Apply
- Before exposing a set of related methods, ask: 'Can these be combined 
  into a single atomic operation that guarantees consistency?'
- Identify operation sequences that should always execute together
- Create atomic wrapper methods
...

## When to Use
- Designing APIs, agent interfaces, or MCP tool exposures
- Operations involve multiple steps that must execute as a transaction
...
```

### 影响

AI 调用 `search_knowledge` 后：
- ✅ 知道有 10 条相关规则
- ✅ 知道规则的 ID、置信度、优先级
- ❌ **不知道规则具体说了什么**
- ❌ **无法应用规则的指导**
- ❌ **无法引用规则内容解释决策**

### 临时解决方案（已执行）

使用 `export_rules_to_claude_md` 将 top-10 规则导出到系统提示：

```bash
mcp__autoimprove-core__export_rules_to_claude_md({
  limit: 10,
  min_confidence: 0.7,
  strategy: "category-balanced"
})
```

**结果**：
- ✅ 成功导出到 `~/.autoimprove/rules/claude-index.md`
- ✅ 10 条规则（1 Critical, 6 High, 3 Medium）
- ✅ 预估 1002 tokens
- ✅ 现在会自动加载到每次对话的系统提示中

**优点**：
- AI 可以直接引用规则内容
- 不需要调用 MCP 工具二次查询
- 性能最优（预加载到上下文）

**缺点**：
- 只包含 top-10 规则，不是全部规则库
- 静态导出，需要手动更新
- 无法根据场景动态加载

---

## 长期解决方案（需上游修复）

### 方案A：改进 `search_knowledge` 返回格式（推荐）

**修改 AutoImprove MCP 服务器代码**：

```typescript
// 文件: mcp-server-ts/src/tools/search_knowledge.ts

async function searchKnowledge(params) {
  const matches = await searchIndex(params);
  
  // 当前实现（错误）
  return {
    success: true,
    matches: matches.map(m => ({
      rule: {
        id: m.id,
        type: m.type,
        confidence: m.confidence,
        keywords: m.keywords || []  // 通常是空的
      }
    }))
  };
  
  // 应该改为（正确）
  return {
    success: true,
    matches: await Promise.all(matches.map(async m => {
  t content = await readRuleContent(m.id);  // 读取 content/*.md
      return {
        rule: {
          id: m.id,
          type: m.type,
          priority: m.priority,
          confidence: m.confidence,
          title: content.title,
          description: content.description,
          keywords: content.keywords,
          how_to_apply: content.howToApply,
          when_to_use: content.whenToUse,
          // 可选：完整内容（如果 token 允许）
          full_content: params.include_content ? content.markdown : undefined
        },
        relevance: m.relevance
      }
    }))
  };
}
```

**优点**：
- 一次调用获取完整信息
- 向后兼容（）
- 符合 RESTful API 最佳实践

**缺点**：
- 返回数据变大，可能影响性能
- 需要缓存优化

### 方案B：添加 `get_rule_details` 工具

```typescript
// 新增工具
export const getRuleDetails = {
  name: "mcp__autoimprove-core__get_rule_details",
  description: "Get the full content of a specific rule by ID",
  inputSchema: {
    type: "object",
    properties: {
      rule_id: {
        type: "string",
        description: "Rule ID (e.g., 'rule-001')"
      },
      include_examples: {
        type: "boolean",
        description: "Include code examples",
        default: true
      }
    },
 required: ["rule_id"]
  },
  
  async handler({ rule_id, include_examples = true }) {
    const filePath = `~/.autoimprove/rules/content/${rule_id}.md`;
    const content = await readFile(filePath);
    const parsed = parseMarkdown(content);
    
    return {
      success: true,
      rule: {
        id: rule_id,
        title: parsed.title,
        description: parsed.description,
        how_to_apply: parsed.howToApply,
        when_to_use: parsed.whenToUse,
        exceptions: parsed.exceptions,
        examples: include_examples ? parsed.examples : undefined,
        full_markdown: content
      }
    };
  }
};
```

**优点**：
- 不影响现有 API
- 按需加载，性能更好
- 灵活控制返回内容

**缺点**：
- 需要两次调用（先搜索，再获取详情）
- 增加 API 复杂度

### 方案C：改进 `claude-index.md` 自动更新机制

```typescript
// 在每次 batch_rebuild 或 generate_rules 后自动导出
async function afterRuleGeneration() {
  await exportRulesToClaudeMd({
    limit: 10,
    strategy: "category-balanced",
    min_confidence: 0.7
  });
  
  console.log("✅ claude-index.md updated with top 10 rules");
}
```

**优点**：
- 自动化，无需手动干预
- 始终保持最新规则

**缺点**：
- 仍然只有 top-10
- 无法动态适配当前场景

---

## 推荐实施路线

### 短期（1周内）

1. ✅ **已完成**：手动导出规则到 `claude-index.md`
2. 🔄 **进行中**：更新 CLAUDE.md，明确 Debug/Analyze 场景必须先搜索
3. 📝 **待办**：向 AutoImprove 开发者提交此文档

### 中期（1个月内）

1. AutoImprove 开发者实施**方案A**或**方案B**
2. 修复 `search_knowledge` 返回内容不完整问题
3. 添加自动化测试确保规则内容正确返回

### 长期（3个月内）

1. 实施**方案C**：自动更新 `claude-index.md`
2. 优化规则匹配算法，提升相关性评分
3. 添加规则使用统计和反馈机制

---

## 验证方法

### 测试 `search_knowledge` 修复是否成功

```bash
# 调用工具
mcp__autoimprove-core__search_knowledge({
  keywords: "timeout,server,crash"
})

# 检查返回结果
# ✅ 应该包含：title, description, how_to_apply
# ❌ 不应该只有：id, type, confidence
```

### 测试触发时机是否修复

```
用户输入："分析为什么 API 响应慢"

AI 行为：
[STEP 1] ✅ 立即调用 search_knowledge({keywords: "performance,api,slow"})
[STEP 2] ✅ 查看相关规则（如 RULE-010）
[STEP 3] ✅ 读取日志/代码
[STEP 4] ✅ 结合规则给出诊断："Following RULE-010, 检测到..."
```

---

## 附录：相关文件

### 关键文件路径

```
~/.autoimprove/
├── rules/
│   ├── index.json              # 规则元数据索引
│   ├── claude-index.md         # 自动导出的 top-10 规则（已修复）
│   └── content/
│       ├── rule-001.md         # 规则完整内容
│       ├── rule-002.md
│       └── ...
├── cache/                      # 分析缓存
└── storage.db                  # 规则数据库

~/.claude/
└── CLAUDE.md                   # AI 行为规则（需更新）

/Users/adazhao/.codebuddy/skills/novel_writing/
└── mcp-server/logs/
    ├── mcp_server.log          # 本次分析的日志文件
    └── server.log
```

### 相关 MCP 工具

```
mcp__autoimprove-core__search_knowledge       # 搜索规则（有问题）
mcp__autoimprove-core__export_rules_to_claude_md  # 导出规则（已使用）
mcp__autoimprove-core__record_feedback        # 记录规则使用反馈
mcp__autoimprove-core__get_rule_usage_stats   # 查看使用统计
```

---

## 总结

### 问题

1. **触发时机错误**：AI 没有在诊断阶段调用 `search_knowledge`
2. **API 设计缺陷**：`search_knowledge` 只返回元数据，缺少实际内容

### 已修复

- ✅ 使用 `export_rules_to_claude_md` 导出 top-10 规则到系统提示
- ✅ 规则现在可以在诊断时引用

### 待修复

- 🔄 更新 CLAUDE.md，明确 Debug/Analyze 必须先搜索
- 📝 AutoImprove 开发者需要修复 `search_knowledge` API

### 影响

- **立即**：AI 可以引用 top-10 规则进行诊断
- **长期**：改进后可以动态搜索并应用全部规则库

---

**文档版本**: v1.0  
**作者**: AI (Claude Code)  
**审核**: 待用户确认  
**下次更新**: AutoImprove MCP API 修复后
