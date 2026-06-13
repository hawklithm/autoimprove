# Setup Script Enhancement Summary

## 问题分析

当前 `CLAUDE.md` 中的 AutoImprove 使用说明存在以下问题，导致 Claude 不知道何时应该调用 AutoImprove 工具：

### 核心问题

1. **语言不够强制** - 使用建议性语言（"proactively"、"should"）而不是强制性语言（"MUST"、"REQUIRED"）
2. **触发条件模糊** - "Starting a new task in a familiar area" 太抽象，Claude 无法判断
3. **缺少强制检查点** - 没有明确说明在工作流的哪个环节**必须**调用工具
4. **没有与工作流集成** - 不像 CodeGraph 那样说"BEFORE writing code MUST call"

### 对比 CodeGraph 的成功案例

| 维度 | CodeGraph（成功） | AutoImprove（改进前） |
|------|------------------|---------------------|
| **语言强度** | "PRIMARY TOOL"、"REQUIRED"、"MUST" | "proactively"、"should" |
| **触发条件** | "BEFORE writing code"、"call this FIRST" | "during coding" |
| **检查点** | 明确的强制检查点 | 没有明确时机 |
| **后果说明** | 说明不使用会导致什么 | 没有说明代价 |

## 解决方案

### 1. 创建增强版模板文件

**文件**: `templates/claude-guidance-template.md`

主要改进：

#### ✅ 使用强制性语言
```markdown
### REQUIRED: Check for learned rules BEFORE implementing

**IMPORTANT**: Before starting any implementation task, you MUST check...
```

#### ✅ 明确的决策树
```
User asks for implementation?
  ↓
  Is this a coding task (not just Q&A)?
    ↓ YES
    → Call search_knowledge FIRST with scene context
```

#### ✅ 强制检查点
```markdown
Call `search_knowledge` at these **mandatory checkpoints**:

1. **BEFORE writing code for a feature** → Check if similar work was done before
2. **WHEN user describes a bug fix** → Check if similar bugs were fixed before
3. **AFTER user corrects your approach** → This pattern should be learned for next time
```

#### ✅ 反例说明（Anti-patterns）
```markdown
❌ **Wrong**: User asks for auth → directly start implementing
✅ **Right**: User asks for auth → search_knowledge first → check for learned patterns
```

#### ✅ 具体的使用场景表格
```markdown
| Trigger | Action | Example |
|---|---|---|
| User: "Add [feature]" | Call `search_knowledge` BEFORE planning | "Add authentication" → search auth rules |
| User: "Fix [bug]" | Call `search_knowledge` BEFORE debugging | "Fix JWT validation" → search jwt,validation |
```

### 2. 修改 setup.sh

**改动位置**: `setup.sh` 第 193-202 行

**改动内容**:
- 将内联的 GUIDANCE_EOF heredoc（~120 行）替换为引用外部模板文件
- 添加模板文件存在性检查
- 保持 awk 插入逻辑不变

**改动前**:
```bash
TEMP_GUIDANCE=$(mktemp)
cat > "$TEMP_GUIDANCE" << 'GUIDANCE_EOF'
## AutoImprove MCP Tools
...（120行内联文本）
GUIDANCE_EOF
```

**改动后**:
```bash
# Use enhanced AutoImprove guidance template
GUIDANCE_TEMPLATE="$TEMPLATES_DIR/claude-guidance-template.md"

if [ ! -f "$GUIDANCE_TEMPLATE" ]; then
  echo "❌ Error: Guidance template not found at $GUIDANCE_TEMPLATE"
  exit 1
fi

TEMP_GUIDANCE=$(mktemp)
cat "$GUIDANCE_TEMPLATE" > "$TEMP_GUIDANCE"
```

## 效果预期

修改后，Claude 会：

1. ✅ **在每个实现任务前自动检查已学习的规则**
   - 触发条件明确：User: "Add [feature]" 或 "Fix [bug]"
   - 动作明确：Call `search_knowledge` FIRST

2. ✅ **在用户纠正后主动建议运行分析**
   - 触发条件：用户纠正了你的实现方式
   - 动作明确：会话结束时建议运行 `/autoimprove-summarize`

3. ✅ **明确知道什么时候必须调用哪个工具**
   - 有决策树 有反例说明错误做法
   - 有具体示例展示正确流程

4. ✅ **避免"我觉得没有规则"的错误判断**
   - 明确说明：不要猜测，让系统检查
   - 强调 search_knowledge 是 O(1) 性能，没有开销

## 文件清单

### 新增文件
- `templates/claude-guidance-template.md` - 增强版使用说明模板

### 修改文件
- `setup.sh` - 修改第 193-202 行，引用外部模板

### 删除文件
- `CLAUDE.md.enhanced` - 临时文件，已清理

## 使用方式

### 首次安装或重新安装
```bash
./setup.sh
```

setup.sh 会自动：
1. 检查 `templates/claude-guidance-template.md` 是否存在
2. 将增强版说明插入到 `CLAUDE.md` 中
3. 创建备份 `CLAUDE.md.backup`

### 手动更新现有项目的 CLAUDE.md

如果已经运行过 setup.sh，想要使用新的说明：

```bash
# 备份当前 CLAUDE.md
cp CLAUDE.md CLAUDE.md.backup

# 删除旧的 AutoImprove 章节（从 "## AutoImprove MCP Tools" 到下一个 "t Overview"）
# 然后重新运行 setup.sh，或者手动复制 templates/claude-guidance-template.md 的内容
./setup.sh
```

## 验证

修改完成后，验证方式：

1. **检查模板文件存在**:
   ```bash
   ls -l templates/claude-guidance-template.md
   ```

2. **运行 setup.sh**:
   ```bash
   ./setup.sh
   ```

3. **检查生成的 CLAUDE.md**:
   ```bash
   grep "REQUIRED: Check for learned rules BEFORE implementing" CLAUDE.md
   ```
   应该能找到这个标题，说明新模板已生效。

4. **在 Claude Code 中测试**:
   - 说："Add JWT authentication"
   - Claude 应该先调用 `search_knowledge` 查找相关规则
   - 而不是直接开始实现

## 注意事项

1. **模板文件必须存在**: setup.sh 依赖 `templates/claude-guidance-template.md`
2. **保持一致性**: 如果要修改说明，应该修改模板文件，而不是直接修改 CLAUDE.md
3. **向后兼容**: 现有的 CLAUDE.md 中的其他章节（Project Overview 等）不受影响

## 后续改进建议

1. **添加更多反例**: 收集用户反馈，添加更多常见的"错误做法"示例
2. **场景扩展**: 根据实际使用情况，扩展"Mandatory usage scenarios"表格
3. **性能数据**: 收集实际的 search_knowledge 调用数据，优化说明的有效性
4. **多语言支持**: 考虑添加中文版模板 `claude-guidance-template.zh.md`
