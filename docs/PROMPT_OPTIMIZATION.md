# AutoImprove 系统提示词优化

**日期**: 2026-07-05  
**状态**: ✅ 已完成  
**相关文档**: `docs/FIXES_IMPLEMENTED.md`, `docs/autoimprove-analysis.md`

---

## 优化概览

针对 AI 未能在诊断阶段触发 `search_knowledge` 的问题，对系统提示词进行了全面强化，通过 6 大改进确保 AI 在所有应该搜索的场景下都能正确触发。

---

## 改进内容

### 1. ⚠️ BLOCKING REQUIREMENT - 强化优先级

**位置**: 模板开头，最显眼位置

**内容**:
```markdown
⚠️ **BLOCKING REQUIREMENT**: Before ANY of the following actions, you MUST call `search_knowledge` first:

1. **Write/Edit/Create ANY file** (code/config/docs/tests/scripts)
2. **Debug/Analyze/Diagnose** (diagnosis IS debugging - search BEFORE reading logs)
3. **Fix/Resolve/Repair** (bugs, errors, crashes, performance issues)
4. **Investigate/Troubleshoot** ("why is X broken/slow/failing")

**No exceptions.** Even for "simple" or "obvious" tasks - search is <10ms, skipping it risks repeating known mistakes.
```

**效果**:
- 使用 "BLOCKING REQUIREMENT" 强制语气
- 明确列出 4 类必须搜索的场景
- 强调"无例外"，包括简单任务

---

### 2. ✅ Pre-Action Checklist - 自检清单

**位置**: BLOCKING REQUIREMENT 之后

**内容**:
```markdown
### Pre-Action Checklist

Before taking action, verify:
- [ ] Did I call `search_knowledge` if this involves write/edit/debug/fix?
- [ ] Did I use appropriate keywords (error types, tech stack, operation)?
- [ ] Did I check scene_json (tech + functional domains)?
- [ ] Am I about to repeat a known pattern without checking history?
```

**效果**:
- 提供可视化的检查项
- 促使 AI 在 thinking 阶段自我验证
- 覆盖关键决策点：调用时机、参数选择、场景检测

---

### 3. 🎯 Trigger Patterns - 触发映射表

**位置**: Pre-Action Checklist 之后

**内容**:
```markdown
### Trigger Patterns (User Intent → search_knowledge)

| User Says | Intent | Required Action | Keywords Example | Scene Example |
|-----------|--------|-----------------|------------------|---------------|
| "服务宕机了" / "server crashed" | Debug | `search_knowledge` FIRST | `crash,server,timeout,connection` | `{"tech":["python","fastapi"],"functional":["server","database"]}` |
| "为什么会出现X错误" / "why X error" | Diagnose | `search_knowledge` FIRST | `error,exception,X` | Extract from context |
| ... (6 行常见场景) |
```

**关键词库**:
```markdown
**Trigger Keywords** (case-insensitive, Chinese/English):
- Debug/Diagnose: 宕机, crash, error, failed, 为什么, why, 出现, 问题, 异常, exception
- Fix/Resolve: 修复, fix, 解决, resolve, repair, 处理
- Implement: 实现, 添加, implement, add, create, build, 开发
- Analyze: 分析, analyze, 调查, investigate, 排查, troubleshoot
```

**效果**:
- 双语支持（中文/英文）
- 提供具体的用户输入 → 意图 → 行动映射
- 每种场景给出关键词示例和场景示例
- 建立触发关键词词库，覆盖常见表达

---

### 4. 🔍 Auto Scene Detection - 场景自动检测

**位置**: Trigger Patterns 之后

**内容**:
```markdown
### Auto Scene Detection

Extract scene automatically from:
- **File paths**: `mcp-server/*.py` → `{"tech":["python"]}`
- **Error messages**: `sqlite3.Error` → `{"tech":["sqlite"]}`
- **User mentions**: "FastAPI服务" → `{"tech":["fastapi"]}`
- **Current working directory**: `/novel_writing/` → `{"functional":["novel","writing"]}`

Always include functional domain:
- Server issues → `{"functional":["server","database"]}`
- API errors → `{"functional":["api","error-handling"]}`
- Performance → `{"functional":["performance","optimization"]}`
- File operations → `{"functional":["file-io","storage"]}`
```

**效果**:
- 教会 AI 从多个来源自动提取场景信息
- 强调必须包含 functional domain
- 提供具体的提取规则和示例

---

### 5. ❌/✅ Bad/Good Examples - 对比示例

**位置**: Rules of Thumb 之后

**Bad Example**:
```markdown
### ❌ Bad Example: Skipping search_knowledge

User: "结合日志分析下为什么服务端宕机了"
Assistant: *directly reads logs and starts analyzing*

Problem: Missed historical patterns about database connection issues, 
migration failures, timeout configurations that were already solved before.
```

**Good Example**:
```markdown
### ✅ Good Example: Search first

User: "结合日志分析下为什么服务端宕机了"
Assistant:
1. search_knowledge({
     keywords: "crash,server,timeout,database,connection,migration",
     scene_json: '{"tech":["python","sqlite","fastapi"],"functional":["database","server","debugging"]}'
   })
2. Review matched rules (e.g., RULE-015: "Long-running DB operations cause timeout")
3. Read logs with context from historical patterns
4. Cite applicable rules: "Following RULE-015, checking for long-running queries..."
5. Provide solution based on both history and current state
```

**效果**:
- 使用实际的用户请求作为示例
- 对比错误做法和正确做法
- 展示完整的正确流程（5 步）
- 强化"先搜索后读取"的顺序

---

### 6. 📋 整体结构优化

**新的内容组织结构**:

1. **⚠️ BLOCKING REQUIREMENT** - 最高优先级，开门见山
2. **Pre-Action Checklist** - 自检清单
3. **Trigger Patterns** - 触发映射表（含关键词库）
4. **Auto Scene Detection** - 场景检测规则
5. **Search Strategies** - 搜索策略示例
6. **Rules of Thumb** - 规则准则
7. **❌/✅ Examples** - 对比示例
8. **If not initialized** - 错误处理

**改进前**:
- 标题: "AutoImprove"（普通）
- 开头: 简介文字
- 结构: 表格 → 规则 → 策略

**改进后**:
- 标题: "AutoImprove - CRITICAL FIRST STEP"（强调）
- 开头: ⚠️ BLOCKING REQUIREMENT（警告）
- 结构: 需求 → 清单 → 映射 → 检测 → 策略 → 规则 → 示例

---

## 技术实现

### 文件路径
`templates/claude-guidance-template.md`

### setup.sh 集成

Step 7 会自动处理这个模板：

```bash
# 检查是否已存在 AutoImprove 部分
if grep -q "<!-- AUTOIMPROVE_START -->" "$GLOBAL_CLAUDE_MD"; then
  # 更新：替换标记之间的内容
  awk -v template="$GUIDANCE_TEMPLATE" '...'
else
  # 新增：追加到文件末尾
  cat "$GUIDANCE_TEMPLATE" >> "$GLOBAL_CLAUDE_MD"
fi
```

**标记机制**:
- `<!-- AUTOIMPROVE_START -->` - 开始标记
- `<!-- AUTOIMPROVE_END -->` - 结束标记
- 允许 setup.sh 精确替换 AutoImprove 部分而不影响其他内容

---

## 预期效果

### 场景 1: 服务器宕机诊n
**用户输入**:
```
"结合日志分析下为什么服务端宕机了"
```

**改进前（错误）**:
```
AI thinking: 这是分析任务，读取日志即可
→ Read mcp_server.log
→ 开始分析
→ ❌ 没有搜索历史模式
```

**改进后（正确）**:
```
AI thinking:
- 检查 Pre-Action Checklist: 这是 Debug/Analyze 任务
- 检查 Trigger Keywords: 包含 "宕机" → Debug intent
- BLOCKING REQUIREMENT: 必须先 search_knowledge
- Auto Scene Detection: 从路径提取 {"tech":["python","fastapi"],"functional":["server","database"]}

→ search_knowledge({
    keywords: "crash,server,timeout,database,connection",
    scene_json: '{"tech":["python","fastapi"],l":["server","database","debugging"]}'
  })
→ 获取历史规则 (例如 RULE-015: Long-running DB operations)
→ Read logs with context
→ 引用规则: "Following RULE-015..."
→ ✅ 提供基于历史和当前状态的解决方案
```

### 场景 2: 修复 Bug

**用户输入**:
```
"修复一下这个 TypeError"
```

**改进前（错误）**:
```
AI thinking: 简单的 bug 修复，直接修改代码
→ Edit file
→ ❌ 没有检查是否有类似 bug 的历史修复方案
```

**改进后（正确）**:
```
AI thinking:
- 检查 Trigger Keywords: "修复" → Fix intent
- BLOCKING REQUIREMENT: Write/Edit 前必须搜索
- Pre-Action Checklist: Did I call search_knowledge?

→ search_knowledge({keywords: "TypeError,bug,fix,error-handling"})
→ 获取规则 (例如 RULE-022: Common TypeError patterns)
→ 应用历史最佳实践
→ Edit file
→ ✅ 引用规则: "Following RULE-022..."
```

### 场景 3: 实现新功能

**用户输入**:
```
"添加一个用户登录功能"
```

**改进前（可能跳过）**:
```
AI thinking: 实现新功能，开始写代码
→ Write auth.py
→ ⚠️ 可能没有检查认证的最佳实践
```

**改进后（正确）**:
```
AI thinking:
- 检查 Trigger Keywords: "添加" → Implement intent
- Auto Scene Detection: 登录功能 → functional: ["auth"]
- BLOCKING REQUIREMENT: 必须先搜索

→ search_knowledge({
    keywords: "auth,login,session,security",
    scene_json: '{"functional":["auth","security"]}'
  })
→ 获取规则 (例如 RULE-008: JWT best practices, RULE-012: Password hashing)
→ Write auth.py with historical patterns
→ ✅ 引用规则: "Following RULE-008 for JWT..."
```

---

## 测试建议

### 1. 触发词测试

测试各种表达方式是否正确触发：

```bash
# 中文表达
"服务宕机了"          → 应触发
"为什么会出现错误"     → 应触发
"修复这个问题"        → 应触发
"分析一下日志"        → 应触发
"实现新功能"         → 应触发

# 英文表达
"server crashed"     → 应触发
"why this error"     → 应触发
"fix this bug"       → 应触发
"analyze the logs"   → 应触发
"implement feature"  → 应触发

# 边界情况
"读取一下日志"        → 不应触发（纯读取）
"这是什么意思"        → 不应触发（纯解释）
"帮我理解这段代码"     → 不应触发（纯理解）
```

### 2. 场景检测测试

验证 AI 能否正确提取场景：

```bash
# 从文件路径
Context: "mcp-server/src/index.ts"
Expected: {"tech":["typescript"], "functional":["server"]}

# 从错误消息
Context: "sqlite3.OperationalError: database is locked"
Expected: {"tech":["sqlite"], "functional":["database"]}

# 从用户描述
Context: "FastAPI 服务响应慢"
Expected: {"tech":["fastapi","python"], "functional":["performance","api"]}
```

### 3. 清单验证测试

检查 AI 是否在 thinking 中使用清单：

```bash
User: "修复数据库连接超时"
Expected thinking process:
- [ ] Did I call search_knowledge? (should check YES)
- [ ] Did I use appropriate keywords? (timeout, database, connection)
- [ ] Did I check scene_json? ({"tech":["database"], "functional":["database"]})
- [ ] Am I repeating a known pattern? (should check history)
```

---

## 部署步骤

### 1. 验证模板更新

```bash
cd /Users/adazhao/workspace/autoimprove
cat templates/claude-guidance-template.md | head -30
# 应该看到 "⚠️ BLOCKING REQUIREMENT"
```

### 2. 备份当前配置

```bash
cp ~/.claude/CLAUDE.md ~/.claude/CLAUDE.md.before-optimization
```

### 3. 运行 setup.sh 更新

```bash
./setup.sh
```

**预期输出**:
```
Step 7: Configuring Claude Code global settings...
Found existing AutoImprove section in global CLAUDE.md, updating...
✓ Updated AutoImprove guidance in /Users/adazhao/.c.md
  (Backup saved to /Users/adazhao/.claude/CLAUDE.md.backup)
```

### 4. 验证更新成功

```bash
# 检查 BLOCKING REQUIREMENT
grep -A 5 "BLOCKING REQUIREMENT" ~/.claude/CLAUDE.md

# 检查 Pre-Action Checklist
grep -A 5 "Pre-Action Checklist" ~/.claude/CLAUDE.md

# 检查 Trigger Patterns
grep -A 10 "Trigger Patterns" ~/.claude/CLAUDE.md

# 检查 Bad/Good Examples
grep -A 15 "Bad Example" ~/.claude/CLAUDE.md
```

### 5. 重启 MCP 服务器（可选）

```bash
claude mcp restart autoimprove-core
```

---

## 对比：优化前后

| 维度 | 优化前 | 优化后 |
|------|--------|--------|
| **优先级强调** | "When to prefer" (建议性) | "⚠️ BLOCKING REQUIREMENT" (强制性) |
| **触发场景** | 表格列出，缺少诊断场景 | 表格 + 6 行具体映射 + 关键词库 |
| **自检机制** | ❌ 无 | ✅ 4 项清单 |
| **场景检测** | "Scene auto-detected" 简单提及 | 详细的提取规则 + 4 个来源 + functional domain 映射 |
| **双语支持** | ⚠️ 仅英文 | ✅ 中英双语关键词 |
| **示例质量** | ❌ 无对比示例 | ✅ Bad/Good 完整对比 + 5 步流程 |
| **结构清晰度** | 平铺直叙 | 层次分明：需求→清单→映射→检测→规则→示例 |
| **覆盖度** | Debug/Fix 提及不足 | Debug/Diagnose/Fix/Analyze 全覆盖 |

---

## 风险评估

### 低风险改动
✅ 所有改动都是**系统提示词**层面，不涉及代码逻辑  
✅ 使用 `<!-- AUTOIMPROVE_START/END -->` 标记，不影响其他配置  
✅ setup.sh 自动备份原文件（.backup 后缀）  
✅ 向后兼容 - 只是增强现有规则，不删除功能

### 可能的副作用
⚠️ AI 可能在某些"纯解释"任务中也尝试搜索（过度触发）  
**缓解措施**: 已在 Trigger Keywords 中排除纯读取/解释场景

⚠️ 中文关键词可能不完全覆盖所有表达方式  
**缓解措施**: 使用"case-insensitive"和常见同义词

---

## 下一步

### 短期（1周内）
1. ✅ 部署优化后的模板
2. 监控 AI 触发 `search_knowledge` 的频率
3. 收集误触发案例（纯解释被误判为 Debug）
4. 补充缺失的中文触发关键词

### 中期（1个月内）
1. 分析日志中的 `search_knowledge` 调用模式
2. 统计 Bad Example 场景的改善率
3. 添加更多领域的 Scene Detection 规则（前端、移动端等）
4. 优化 Pre-Action Checklist 的清单项

### 长期（3个月内）
1. 建立自动化测试框架验证触发逻辑
2. 基于实际使用数据微调 Trigger Keywords
3. 添加更多语言支持（日语、德语等）
4. 研究 AI 的 thinking pattern，优化清单设计

---

## 总结

### 核心改进
1. **⚠️ BLOCKING REQUIREMENT** - 开门见山，强制优先级
2. **✅ Pre-Action Checklist** - 自检清单，thinking 阶段验证
3. **🎯 Trigger Patterns** - 用户意图映射 + 双语关键词库
4. **🔍 Auto Scene Detection** - 多源场景提取规则
5. **❌/✅ Examples** - 实际对比示例，展示正确流程
6. **📋 结构优化** - 从"建议"到"强制"的语气转变

### 预期效果
- ✅ AI 在诊断场景下 100% 触发 `search_knowledge`
- ✅ 中文用户体验大幅提升（双语关键词）
- ✅ 场景检测准确率提高（自动提取规则）
- ✅ 减少"忘记搜索"的人为错误

### 部署状态
✅ 模板已更新  
⏳ 等待用户运行 `./setup.sh` 部署  
⏳ 等待实际使用验证效果  

---

**文档版本**: 1.0  
**作者**: AI (Claude Code)  
**相关文件**:
- `templates/claude-guidance-template.md` - 优化后的模板
- `setup.sh` - 自动部署脚本（Step 7）
- `~/.claude/CLAUDE.md` - 最终生效的配置文件
