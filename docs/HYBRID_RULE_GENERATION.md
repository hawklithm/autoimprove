# Hybrid Rule Generation (方案3实现)

## 概述

方案3采用**多阶段混合策略**，显著提升规则内容的质量和详细程度。相比之前简略的规则内容，新系统生成的规则包含：

- ✅ 详细的描述（4-6句话，而非1-2句）
- ✅ 清晰的理由说明（为什么要遵循这个规则）
- ✅ 具体的应用步骤（How to Apply，3-6个可操作步骤）
- ✅ 代码示例（Before/After对比，从实际session中提取）
- ✅ 使用条件（When to Use，3-5个具体场景）
- ✅ 例外情况（Exceptions，何时不适用）

## 四个阶段

### Phase 1: 基础模式检测
- **组件**: `SessionAnalyzer` (现有)
- **功能**: 从session JSONL中检测重复纠正、反模式、性能、安全等模式
- **输出**: Pattern对象（包含description、occurrences、confidence等）

### Phase 2: LLM内容增强
- **组件**: `HybridRuleGenerator.enhanceWithLLM()`
- **功能**: 使用Claude Sonnet 4.6扩展规则内容
- **输入**: 基础Pattern + 用户原始消息
- **输出**: 包含title、description、rationale、how_to_apply、when_to_use、exceptions的结构化内容
- **Prompt设计**: 3000+ token的详细prompt，要求生成6个结构化部分

### Phase 3: 代码示例提取
- **组件**: `CodeExampleExtractor`
- **功能**: 从session的tool_calls中提取实际的before/after代码
- **算法**:
  1. 根据occurrence的timestamp定位session中的相关消息
  2. 向前查找Read工具调用（获取修改前的代码）
  3. 向后查找Edit/Write工具调用（获取修改后的代码）
  4. 提取相关代码片段（围绕目标行号±5行）
  5. 自动检测编程语言
  6. 生成对比说明

### Phase 4: 结构化存储
- **组件**: `RuleContent` (增强后的数据模型)
- **新增字段**:
  ```typescript
  interface RuleContent {
    // 向后兼容
    content: string;  // 完整格式化的markdown内容
    
    // Phase 4 结构化字段
    title?: string;
    description?: string;
    reason: string;
    how_to_apply?: string[];
    examples?: CodeExample[];
    when_to_use?: string[];
    exceptions?: string[];
    related_rules?: string[];
    
    metadata: Record<string, any>;
  }
  ```

## 使用方法

### 1. 基础模式（快速，向后兼容）

```typescript
// 通过MCP工具调用
{
  "tool": "generate_rules",
  "params": {
    "patterns_json": "[...]",  // Pattern数组的JSON
    "scene_json": "{...}"      // 可选的场景上下文
  }
}
```

**特点**:
- 速度快（无LLM调用，< 100ms）
- 规则内容简略（1-2句描述）
- 成本低（0 tokens）

### 2. 增强模式（详细，推荐）

```typescript
{
  "tool": "generate_rules",
  "params": {
    "patterns_json": "[...]",
    "scene_json": "{...}",
    "use_llm_enhancement": true,        // 启用LLM内容增强
    "extract_code_examples": true,      // 启用代码示例提取（默认true）
    "session_dir": "~/.claude/sessions", // session文件目录
    "max_examples": 3                    // 每条规则最多3个示例
  }
}
```

**特点**:
- 规则内容详细（6个结构化部分）
- 包含实际代码示例
- LLM成本：~1500-2000 tokens/规则
- 总耗时：~3-5秒/规则（包含LLM调用）

### 3. 通过Skills调用

修改 `autoimprove-summarize` skill以支持增强模式：

```bash
# 基础模式
/autoimprove-summarize

# 增强模式（需要ANTHROPIC_API_KEY）
/autoimprove-summarize --enhance

# 仅提取代码示例（无LLM）
/autoimprove-summarize --code-examples
```

## 生成规则的结构对比

### 旧方案（基础生成器）

```markdown
# Use useState for simple state

For boolean or simple value state, use useState instead of useReducer.

**Applies to**: component.tsx, hooks.ts

**Reason**: Corrected 3 times in one session; keywords: useState, useReducer
```

**问题**:
- 描述过于简略
- 没有说明"为什么"
- 没有"如何应用"
- 没有代码示例
- 没有使用条件

### 新方案（混合生成器 Phase 2-4）

```markdown
# Use useState for Simple State Management

## Description

For boolean or simple primitive value state, use useState instead of useReducer. 
Reserve useReducer for complex state objects with multiple sub-values or complex 
state transitions. Simple state updates like toggling a boolean, incrementing a 
counter, or storing a string should use useState for clarity and simplicity.

## Rationale

useState is more readable and requires less boilerplate for simple cases. Using 
useReducer for basic state adds unnecessary complexity with action types, reducer 
functions, and dispatch calls, making the code harder to understand and maintain. 
The overhead of useReducer only pays off when managing complex state logic.

## How to Apply

- When creating new state, ask: Is this a single primitive value? If yes, use useState
- During code review, flag useReducer usage where the reducer only has 2-3 simple toggle/set actions
- Refactor existing useReducer to useState: replace dispatch calls with direct setState calls
- Use ESLint plugin 'eslint-plugin-react-hooks' to enforce best practices

## Examples

### ❌ Avoid

```typescript
const [isOpen, dispatch] = useReducer((state, action) => {
  switch (action.type) {
    case 'toggle': return !state;
    default: return state;
  }
}, false);

// Usage
dispatch({ type: 'toggle' });
```

### ✅ Prefer

```typescript
const [isOpen, setIsOpen] = useState(false);

// Usage
setIsOpen(!isOpen);
// or
setIsOpen(prev => !prev);
```

**Why**: The useState version is more direct and readable. For a simple boolean 
toggle, the useReducer version adds unnecessary abstraction with action types and 
reducer logic.

## When to Use

- State is a single primitive value (boolean, string, number)
- State updates are simple assignments or toggles
- State transitions don't require validation or side effects
- Component has fewer than 5 independent state variables

## Exceptions

- When state transitions need to be logged or audited
- When building a finite state machine with specific valid transitions
- When multiple related state changes must happen atomically
- When the pattern is required by a library (e.g., form state management)
```

**改进**:
- ✅ 描述详细具体（4-6句）
- ✅ 明确的理由说明
- ✅ 4个可操作的应用步骤
- ✅ Before/After代码对比
- ✅ 4个具体使用条件
- ✅ 4个明确的例外情况

## 性能和成本

### 基础模式
- **速度**: < 100ms/规则
- **成本**: 0 tokens
- **适用场景**: 快速迭代

### 增强模式（LLM + 代码示例）
- **速度**: 3-5秒/规则
- **成本**: ~1500-2000 tokens/规则
  - Input: ~800 tokens (prompt + pattern context)
  - Output: ~800-1200 tokens (structured rule content)
- **适用场景**: 高质量规则库、用户可见的规则

### 仅代码示例（无LLM）
- **速度**: ~500ms/规则
- **成本**: 0 tokens
- **适用场景**: 需要示例但无LLM预算

## 技术实现细节

### 代码示例提取算法

```typescript
// 1. 根据timestamp定位消息
const targetIndex = findMessageByTimestamp(messages, occurrence.timestamp);

// 2. 向前查找Read调用（before代码）
for (let i = targetIndex - 1; i >= targetIndex - 10; i--) {
  if (toolCall.function.name === "Read") {
    beforeCode = extractRelevantCode(toolResult, context);
  }
}

// 3. 向后查找Edit/Write调用（after代码）
for (let i = targetIndex; i < targetIndex + 10; i++) {
  if (toolCall.function.name === "Edit") {
    afterCode = args.new_string;
  } else if (toolCall.function.name === "Write") {
    afterCode = extractRelevantCode(args.content, context);
  }
}

// 4. 生成说明
explanation = generateExplanation(beforeCode, afterCode, context);
```

### LLM Prompt设计要点

1. **详细的结构要求**: 明确6个部分的格式和长度要求
2. **具体示例**: 在prompt中包含完整的JSON示例
3. **实际用户消息**: 将pattern的occurrence中的user_input传递给LLM
4. **上下文信息**: 包含confidence、occurrences、keywords等元数据
5. **质量标准**: 明确"IMPORTANT"部分的要求（长度、可操作性、具体性）

### 数据模型扩展

```typescript
// 新增CodeExample接口
interface CodeExample {
  bad?: string;      // 反例代码（可选）
  good: string;      // 正例代码
  explanation: string; // 对比说明
  language?: string;  // 编程语言
}

// 扩展RuleContent接口
interface RuleContent {
  // ... 原有字段
  examples?: CodeExample[];      // Phase 3提取的示例
  how_to_apply?: string[];       // Phase 2生成的步骤
  when_to_use?: string[];        // Phase 2生成的条件
  exceptions?: string[];         // Phase 2生成的例外
}
```

## 向后兼容性

- ✅ 默认行为不变：不传参数时使用基础生成器
- ✅ 现有规则不受影响：新字段为可选
- ✅ 存储格式兼容：`content`字段仍包含完整markdown
- ✅ API兼容：`generate_rules`工具保持原有接口

## 配置建议

### 开发环境
```json
{
  "use_llm_enhancement": false,
  "extract_code_examples": true
}
```
理由：快速迭代，有代码示例但无LLM成本

### 生产环境（用户可见规则）
```json
{
  "use_llm_enhancement": true,
  "extract_code_examples": true,
  "max_examples": 2
}
```
理由：高质量规则，值得LLM成本

### CI/CD（大规模生成）
```json
{
  "use_llm_enhancement": false,
  "extract_code_examples": false
}
```
理由：速度优先，成本最低

## 下一步改进方向

1. **批量LLM调用**: 将多个pattern合并为一个prompt，降低成本
2. **示例缓存**: 相同文件路径的代码示例可以复用
3. **增量更新**: 只对新增的pattern进行LLM增强
4. **质量评分**: 自动评估生成的规则质量，筛选出最佳规则
5. **用户反馈循环**: 根据用户对规则的评分调整LLM prompt

## 总结

方案3成功解决了**规则内容过于简略**的问题：

| 维度 | 旧方案 | 新方案（Phase 2-4） | 改进 |
|------|-------|-------------------|------|
| 描述长度 | 1-2句 | 4-6句 | +200% |
| 应用指导 | ❌ 无 | ✅ 3-6步骤 | 新增 |
| 代码示例 | ❌ 无 | ✅ Before/After | 新增 |
| 使用条件 | ❌ 无 | ✅ 3-5条件 | 新增 |
| 例外说明 | ❌ 无 | ✅ 2-4例外 | 新增 |
| 生成速度 | < 100ms | 3-5s | -30x |
| Token成本 | 0 | ~1800 | +1800 |

**建议策略**: 
- 日常开发使用基础模式（快速、免费）
- 定期运行增强模式更新高质量规则库
- 用户可见的规则优先使用增强模式
