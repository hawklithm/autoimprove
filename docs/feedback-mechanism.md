# 自动反馈记录机制

## 📊 实现方案：方案1 + 方案2 结合

本文档说明 AutoImprove 的自动反馈记录机制。

---

## 🎯 实现内容

### **方案 1：规则匹配时自动记录** ✅

**实现位置**：`src/mcp-server-ts/src/index.ts` - `handleSearchKnowledge()`

**工作原理**：
当 Claude 通过 `search_knowledge` 查询规则时，系统自动记录为 "used" 反馈。

**自动记录的场景**：
1. ✅ 按 ID 查询规则时
2. ✅ 按场景匹配规则时
3. ❌ 列出所有规则时（不记录）

**记录的信息**：
```json
{
  "rule_id": "RULE-010",
  "timestamp": "2026-06-06T10:30:00.000Z",
  "feedback_type": "used",
  "context": "scene:TypeScript,React/validation:relevance:0.85"
}
```

**跳过自动记录**：
```typescript
// 如果只是查看规则而不打算应用
mcp__autoimprove-core__search_knowledge({
  scene_json: "...",
  skip_feedback: true  // 跳过自动记录
})
```

---

### **方案 2：Claude 主动记录反馈** ✅

**实现位置**：
- 提示词模板：`templates/claude-feedback-instructions.md`
- 自动配置：`setup.sh` (Step 7)

**工作原理**：
`setup.sh` 自动将反馈指令添加到 `~/.claude/CLAUDE.md`，Claude 在每次会话中都能看到这些指令。

**配置文件结构**：
```
~/.claude/
├── CLAUDE.md (全局配置)
│   ├── @~/.autoimprove/rules/claude-index.md (规则列表)
│   └── @~/.claude/autoimprove-feedback-instructions.md (反馈指令)
└── autoimprove-feedback-instructions.md (从模板复制)
```

**Claude 可以主动记录的反馈类型**：
1. **used** - 应用了规则
2. **ignored** - 忽略了规则
3. **corrected** - 修正了规则建议
4. **disabled** - 禁用规则

---

## 🔄 数据流程

```
┌─────────────────────────────────────────────────────────┐
│  Claude 查询规则                                          │
│  search_knowledge(scene, keywords)                      │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  ✅ 方案1：自动记录                                       │
│  - 记录类型: "used"                                      │
│  - 上下文: scene + keywords + relevance                 │
│  - 存储: feedback_history.jsonl                         │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  Claude 应用规则给出建议                                  │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  用户接受 / 拒绝 / 修改建议                              │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  ✅ 方案2：Claude 主动记录                               │
│  record_feedback({                                      │
│    rule_id,                                            │
│    feedback_type: "used|ignored|corrd|disabled",   │
│    user_rating: 1-5,                                   │
│    context: "描述"                                      │
│  })                                                    │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  数据存储                                                │
│  ~/.autoimprove/feedback_history.jsonl                 │
└─────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  统计分析                                                │
│  get_rule_usage_stats()                                │
└─────────────────────────────────────────────────────────┘
```

---

## 📝 反馈数据格式

### 自动记录（方案1）
```jsonl
{"rule_id":"RULE-010","timestamp":"2026-06-06T10:30:00.000Z","feedback_type":"used","context":"scene:TypeScript/validation:relevance:0.85"}
{"rule_id":"RULE-008","timestamp":"2026-06-06T10:35:00.000Z","feedback_type":"used","context":"scene:React/setup:keywords:preference:relevance:0.92"}
```

### 主动记录（方案2）
```jsonl
{"rule_id":"RULE-010","timestamp":"2026-06-06T10:40:00.000Z","feedback_type":"used","user_rating":5,"context":"form_validation:user_accepted"}
{"rule_id":"RULE-023","timestamp":"2026-06-06T10:45:00.000Z","feedback_type":"ignored","context":"not_applicable_to_current_scenario"}
{"rule_id":"RULE-015","timestamp":"2026-06-06T10:50:00.000Z","feedback_type":"corrected","user_rating":3,"context":"needed_adjustment_for_specific_case"}
```

---

## 🚀 安装配置

### 全新安装
```bash
cd /Users/adazhao/workspace/autoimprove
./setup.sh
```

**setup.sh 会自动**：
1. ✅ 构建并配置 MCP Server
2. ✅ 创建存储目录结构
3. ✅ 复制反馈指令模板到 `~/.claude/autoimprove-feedback-instructions.md`
4. ✅ 在 `~/.claude/CLAUDE.md` 中添加引用

### 更新现有安装
```bash
cd /Users/adazhao/workspace/autoimprove
./setup.sh  # 会检测并更新配置
```

### 手动验证
```bash
# 检查反馈指令文件
cat ~/.claude/autoimprove-feedback-instructions.md

# 检查 CLAUDE.md 配置
cat ~/.claude/CLAUDE.md | grep -A 2 "AutoImprove 规则使用反馈"

# 检查反馈数据
cat ~/.autoimprove/feedback_history.jsonl
```

---

## 💡 使用示例

### Claude 工作流

**场景 1：应用规则**
```
用户：帮我添加表单验证

Claude：
1. 查询规则（自动记录 feedback_type=used）
   search_knowledge({scene_json: "validation"})

2. 应用规则给出建议
   "根据 RULE-010，建议..."

3. 用户接受建议后，主动记录
   record_feedback({
     rule_id: 010",
     feedback_type: "used",
     user_rating: 5,
     context: "form_validation:accepted"
   })
```

**场景 2：忽略规则**
```
用户：这个规则不适用

Claude：
record_feedback({
  rule_id: "RULE-XXX",
  feedback_type: "ignored",
  context: "user_indicated_not_applicable"
})
```

**场景 3：修正建议**
```
用户：这个方向对，但需要调整...

Claude：
record_feedback({
  rule_id: "RULE-XXX",
  feedback_type: "corrected",
  user_rating: 3,
  context: "direction_correct_but_adjusted"
})
```

---

## 📊 数据统计

查看反馈统计：

```typescript
// 查看所有统计
mcp__autoimprove-core__get_rule_usage_stats({
  output_format: "markdown"
})

// 查看特定规则
mcp__autoimprove-core__get_feedback_stats({
  rule_id: "RULE-010"
})

// 命令行脚本
node scripts/rule-usage-stats.ts --last=30days
```

---

## 🔧 技术细节

### 方案1 实现要点

**代码位置**：`handleSearchKnowledge()` in `index.ts:754`

**关键逻辑**：
```typescript
// 检查 skip_feedback 参数
const skipFeedback = args.skip_feedback === true;

if (!skipFeedback && matches.length > 0) {
  for (const match of matches) {
    adaptiveConfidence.recordFeedback({
      rule_id: match.rule.id,
      timestamp: new Date().toISOString(),
      feedback_type: "used",
      context: `scene:${scene.tech}/${scene.functional}:relevance:${match.relevance_score}`
    });
  }
}
```

**存储机制**：
- `AdaptiveConfidenceCalculator.recordFeedback()` 追加到内存数组
- `saveFeedbackHistory()` 写入 JSONL 文件
- 每次记录都是原子写入

### 方案2 实现要点

**提示词模板**：`templates/claude-feedback-instructions.md`

**setup.sh 逻辑**：
```bash
# Step 7: 配置 Claude 全局设置
if grep -q "autoimprove-feedback-instructions.md" "$GLOBAL_CLAUDE_MD"; then
  echo "✓ 已存在"
else
  # 复制模板
  cp "$TEMPLATES_DIR/claude-feedback-instructions.md" "$CLAUDE_DIR/"
  
  # 添加引用到 CLAUDE.md
  cat >> "$GLOBAL_CLAUDE_MD" << 'EOF'
## AutoImprove 规则使用反馈
@~/.claude/autoimprove-feedback-instructions.md
EOF
fi
```

---

## ⚠️ 注意事项

### 1. 双重记录问题
- **方案1** 在查询时记录
- **方案2** 在应用时记录

如果 Claude 查询后又主动记录，会产生两条记录。这是**预期行为**：
- 第一条：规则被查询（潜在使用）
- 第二条：规则实际应用（确认使用 + 评分）

统计时可以通过 `user_rating` 字段区分：
- 有 `user_rating` = 实际应用
- 无 `user_rating` = 仅查询

### 2. 数据量增长
自动记录会产生更多数据。建议：
- 定期归档旧数据
- 使用 `skip_feetrue` 跳过纯探索性查询
- 实现数据压缩或聚合

### 3. 隐私考虑
`context` 字段可能包含用户代码信息。建议：
- 仅记录场景关键词，不记录实际代码
- 定期清理敏感上下文

---

## 🎉 总结

**✅ 已实现**：
1. ✅ 方案1：规则匹配时自动记录
2. ✅ 方案2：Claude 主动记录反馈
3. ✅ setup.sh 自动配置
4. ✅ 完整的数据流程
5. ✅ 统计分析支持

**📈 效果**：
- 完全自动化的反馈收集
- 无需用户干预
- 数据完整且准确
- 支持多维度统计分析

**🚀 下一步**：
运行 `./setup.sh` 安装配置，开始自动收集反馈数据！
