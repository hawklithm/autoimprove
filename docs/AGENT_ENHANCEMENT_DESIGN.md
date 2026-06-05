# Agent 增强规则质量设计方案

## 概述

使用 LLM Agent 进行深度语义分析，从对话中提取高质量的编码规则，替代简单的关键词匹配。

## 当前问题

### 基于关键词的局限性

```typescript
// 当前方法：关键词 → 简单截取
if (msg.content.includes("性能")) {
  description = msg.content.substring(0, 100); // 😞 粗暴截取
}
```

**问题**：
- ❌ 无法理解语义："这个性能怎么样？"被识别为性能模式
- ❌ 无法提取建议：用户说了一段话，但真正的建议在中间
- ❌ 无法识别反例："不要用这个方法"被当作正面建议
- ❌ 无法处理复杂对话：多轮对话中的上下文丢失

### Agent 的优势

- ✅ **深度理解**：理解用户的真实意图
- ✅ **上下文感知**：可以看前后对话来判断
- ✅ **提取能力**：从长篇对话中提取核心建议
- ✅ **质量控制**：判断是否值得记录为规则
- ✅ **规范化**：将口语转换为规范的规则描述

## 架构设计

### 整体流程

```
Session File
    ↓
[1] 基础检测（关键词匹配）
    ↓
候选模式 (50-100个)
    ↓
[2] Agent 语义分析 ← 🤖 新增
    ↓
高质量模式 (10-20个)
    ↓
[3] 生成规则
    ↓
Rules Database
```

### 三种实现方案

#### 方案 A：MCP Tool + 内部调用

```typescript
// 新增 MCP tool: enhance_patterns
async enhance_patterns(patterns: Pattern[]): Promise<EnhancedPattern[]> {
  // 使用内部 LLM 调用（如 Anthropic SDK）
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4",
    messages: [{ role: "user", content: enhancePrompt }]
  });
  
  return parseEnhancedPatterns(response);
}
```

**优点**：
- 快速，直接调用 API
- 不依赖 Claude Code 的 Agent 工具

**缺点**：
- 需要配置 API key
- 增加了 MCP server 的复杂度
- 成本难以控制

#### 方案 B：Skill 层 Agent 集成（推荐 ⭐）

```typescript
// 在 skill.ts 中使用 Claude Code 的能力
async function enhanceWithAgent(patterns: Pattern[]): Promise<Pattern[]> {
  // 1. 将模式写入临时文件
  const tempFile = writePatternsToTemp(patterns);
  
  // 2. 生成 agent prompt
  const prompt = generateEnhancePrompt(tempFile);
  
  // 3. 使用 spawn 调用 claude-code agent
  const result = await spawnClaudeAgent(prompt);
  
  // 4. 解析结果
  return parseAgentResult(result);
}
```

**优点**：
- 利用 Claude Code 现有能力
- 用户已经付费，无额外成本
- 可以看到 Agent 的工作过程
- 符合 Claude Code 的使用模式

**缺点**：
- 依赖 Claude Code CLI
- 速度可能较慢（但可接受）

#### 方案 C：Workflow 编排

```typescript
// 使用 Workflow 工具进行并行处理
export const meta = {
  name: 'enhance-patterns-workflow',
  description: 'Enhance pattern quality with parallel agents',
  phases: [
    { title: 'Analyze', detail: 'Semantic anals' },
    { title: 'Validate', detail: 'Quality check' }
  ]
};

const enhanced = await pipeline(
  patterns,
  async (pattern) => await agent(`Analyze: ${pattern.description}`, {
    schema: ENHANCED_PATTERN_SCHEMA
  })
);
```

**优点**：
- 并行处理，速度快
- 强大的编排能力

**缺点**：
- 过于重量级，overkill
- 不适合作为默认功能

### 推荐方案：方案 B

原因：
1. 利用现有基础设施
2. 用户体验好（可以看到进度）
3. 实现简单，易于维护
4. 性能可接受（批量处理）

## 详细设计

### 1. Agent Prompt 设计

```markdown
You are a coding pattern extraction expert. Your task is to analyze user messages from a coding session and extract high-quality, actionable coding rules.

## Input
A list of candidate patterns detected by keyword matching:

{patterns_json}

## Your Task

For each pattern:

1. **Semantic Analysis**: Understand what the user really meant
   - Is this a real coding suggestion or just a question/complaint?
   - What is the actual actionable advice?

2. **Extract Core Advice**: 
   - Extract the specific, actionable recommendation
   - Remove noise, questions, and context
   - Make it concise (max 150 chars)

3. **Quality Assessment**:
   - Is this worth recording as a rule? (true/false)
   - Confidence level (0.0-1.0)
   - If confidence < 0.6, mark as invalid

4. **Metadata Extraction**:
   - Technical keywords (e.g., "react", "typescript", "api")
   - Pattern type: performance | security | anti-pattern | preference
   - Priority: critical | high | medium | low

## Output Format

Return ONLY valid JSON (no markdown, no explanations):

```json
{
  "enhanced_patterns": [
    {
      "original_index": 0,
      "is_valid": true,
      "description": "Use React.memo to prevent unnecessary re-renders of pure components",
      "keywords": ["react", "memo", "performance", "re-render"],
      "confidence": 0.85,
      "type": "performance",
      "priority": "high",
      "reason": "User corrected this mistake twice with explicit examples"
    },
    {
      "original_index": 1,
      "is_valid": false,
      "reason": "Just a question, no actionable advice"
    }
  ],
  "summary": {
    "total_analyzed": 10,
    "valid_patterns": 5,
    "filtered_out": 5
  }
}
```

## Examples

### Example 1: Valid Pattern
**Input**: "为什么还是在重新渲染？你应该用 React.memo 包裹这个组件，它是纯组件"
**Output**: 
```json
{
  "is_valid": true,
  "description": "Use React.memo to wrap pure components to prevent unnecessary re-renders",
  "keywords": ["react", "memo", "pure-component", "performance"],
  "confidence": 0.9,
  "type": "performance",
  "priority": "high"
}
```

### Example 2: Invalid Pattern
**Input**: "为什么还是不work？"
**Output**:
```json
{
  "is_valid": false,
  "reason": "No actionable advice, just a question"
}
```

### Example 3: Security Pattern
**Input**: "这里有SQL注入风险，你需要用参数化查询，不要直接拼接SQL字符串"
**Output**:
```json
{
  "is_valid": true,
  "description": "Use parameterized queries instead of string concatenation to prevent SQL injection",
  "keywords": ["sql", "injection", "security", "parameterized-query"],
  "confidence": 0.95,
  "type": "security",
  "priority": "critical"
}
```

## Important Rules

1. **Be Strict**: Only mark patterns af they contain clear, actionable advice
2. **No Noise**: Filter out questions, complaints, debugging statements
3. **Actionable**: The description should tell the developer what to do
4. **Concise**: Keep descriptions under 150 characters
5. **Keywords**: Extract 3-6 relevant technical terms
6. **Confidence**: Be conservative - when in doubt, lower the confidence

Now analyze the patterns:
```

### 2. 实现流程

```typescript
// skill.ts

async function enhancePatterns(patterns: Pattern[]): Promise<Pattern[]> {
  if (patterns.length === 0) {
    return patterns;
  }

  console.log(`\n🤖 Enhancing ${patterns.length} patterns with AI agent...`);
  console.log("   This will improve quality by:");
  console.log("   • Deep semantic understanding");
  console.log("   • Extracting actionable advice");
  console.log("   • Filtering out noise and questions");
  console.log("   • Normalizing descriptions\n");

  try {
    // 1. 准备数据
    const tempFile = prepareAgentInput(patterns);
    
    // 2. 调用 Agent
    const enhanced = await callEnhanceAgent(tempFile);
    
    // 3. 合并结果
    const mergedPatterns = mergeEnhancedPatterns(patterns, enhanced);
    
    // 4. 显示结果
    console.log(`✅ Agent analysis complete:`);
    console.log(`   • Original patterns: ${patterns.length}`);
    console.log(`   • Valid patterns: ${mergedPatterns.length}`);
    console.log(`   • Filtered out: ${patterns.length - mergedPatterns.length}`);
    console.log(`   • Quality improvement: ${calculateImprovement(patterns, mergedPatterns)}%\n`);
    
    return mergedPatterns;
    
  } catch (error) {
    console.warn(`⚠️  Agent enhancement failed: ${error.message}`);
    console.log(`   Falling back to basic patterns\n`);
    return patterns; // 回退到原始模式
  }
}

function prepareAgentInput(patterns: Pattern[]): string {
  const tempFile = join(homedir(), ".autoimprove", "temp_patterns_for_enhancement.json");
  
  // 简化模式数据，只保留必要信息
  const simplified = patterns.map((p, i) => ({
    index: i,
    type: p.type,
    description: p.description,
    user_context: p.occurrences[0]?.user_input || "",
    confidence: p.confidence
  }));
  
  writeFileSync(tempFile, JSON.stringify(simplified, null, 2));
  return tempFile;
}

async function callEnhanceAgent(inputFile: string): Promise<EnhancedPattern[]> {
  const prompt = `
You are a coding pattern extraction expert.

Read the candidate patterns from: ${inputFile}

Analyze each pattern and extract high-quality, actionable coding rules.

${ENHANCE_PROMPT_TEMPLATE}

Output ONLY valid JSON to: ${inputFile.replace('.json', '_enhanced.json')}
`;

  // 使用 spawn 调用 Claude Code
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--non-interactive', '--output-json'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    proc.stdin.write(prompt);
    proc.stdin.end();
    
    let output = '';
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          resolve(result.enhanced_patterns);
        } catch (e) {
          reject(new Error('Failed to parse agent output'));
        }
      } else {
        reject(new Error(`Agent exited with code ${code}`));
      }
    });
    
    setTimeout(() => {
      proc.kill();
      reject(new Error('Agent timeout'));
    }, 60000); // 60秒超时
  });
}

function mergeEnhancedPatterns(
  original: Pattern[],
  enhanced: EnhancedPattern[]
): Pattern[] {
  const merged: Pattern[] = [];
  
  for (const e of enhanced) {
    if (!e.is_valid) continue;
    
    const orig = original[e.original_index];
    if (!orig) continue;
    
    // 合并：使用 Agent 的改进描述，保留原始的 occurrences
    merged.push({
      ...orig,
      description: e.description,
      keywords: e.keywords,
      confidence: e.confidence,
      type: e.type as PatternType,
      // 保留原始的 occurrences 作为证据
      occurrences: orig.occurrences
    });
  }
  
  return merged;
}
```

### 3. 使用方式

```bash
# 启用 Agent 增强（推荐）
/autoimprove-summarize --enhance

# 结合其他选项
/autoimprove-summarize --all --enhance --min-confidence 0.8

# 批量模式也支持
/autoimprove-summarize --all --force --enhance
```

### 4. 性能优化

#### 批量处理

```typescript
// 一次处理多个模式，而不是一个一个调用
const BATCH_SIZE = 20; //  20 个模式

async function enhancePatternsBatched(patterns: Pattern[]): Promise<Pattern[]> {
  const batches = chunk(patterns, BATCH_SIZE);
  const results: Pattern[] = [];
  
  for (let i = 0; i < batches.length; i++) {
    console.log(`   Processing batch ${i + 1}/${batches.length}...`);
    const enhanced = await enhancePatterns(batches[i]);
    results.push(...enhanced);
  }
  
  return results;
}
```

#### 缓存机制

```typescript
// 缓存已增强的模式，避免重复处理
interface EnhancementCache {
  [patternHash: string]: EnhancedPattern;
}

function getCachedEnhancement(pattern: Pattern): EnhancedPattern | null {
  const hash = hashPattern(pattern);
  return cache[hash] || null;
}

function hashPattern(pattern: Pattern): string {
  return crypto
    .createHash('md5')
    .update(pattern.description + pattern.type)
    .digest('hex');
}
```

#### 并行处理（可选）

```typescript
// 使用 Promise.all 并行处理多个批次
async function enhancePatternsParallel(patterns: Pattern[]): Promise<Pattern[]> {
  const batches = chunk(patterns, BATCH_SIZE);
  const MAX_PARALLEL = 3; // 最多 3 个并行 Agent
  
  const results = await Promise.all(
    batches.slice(0, MAX_PARALLEL).map(batch => enhancePatterns(batch))
  );
  
  return results.flat();
}
```

### 5. 回退机制

```typescript
async function enhancePatternsWithFallback(patterns: Pattern[]): Promise<Pattern[]> {
  try {
    // 尝试使用 Agent
    return await enhancePatterns(patterns);
  } catch (error) {
    console.warn(`⚠️  Agent enhancement failed: ${error.message}`);
    
    // 回退策略 1：使用改进的关键词方法
    try {
      console.log(`   Trying improved keyword method...`);
      return await enhanceWithKeywords(patterns);
    } catch (error2) {
      // 回退策略 2：返回原始模式
      console.log(`   Using original patterns`);
      return patterns;
    }
  }
}
```

## 预期效果

### 质量提升

| 指标 | 当前（关键词） | Agent 增强 | 提升 |
|------|----------------|------------|------|
| 有效规则率 | 87% | 95%+ | **+9%** |
| 描述质量 | 中等 | 高 | ✅ |
| 假阳性 | 13% | <5% | **-60%** |
| 可操作性 | 70% | 90%+ | **+29%** |

### 示例对比

#### 场景 1：性能优化

**用户输入**：
```
为什么这个列表滚动这么卡？每次都重新渲染了吧？
你看这里，应该用 React.memo 包裹 ListItem 组件，
还有用 useCallback 包裹 onClick 处理函数。
```

**关键词方法**：
```json
{
  "description": "为什么这个列表滚动这么卡？每次都重新渲染了吧？你看这里，应该用 React.memo 包裹 ListItem 组件，还有用 useCallback 包裹 onClick 处理函数...",
  "confidence": 0.75
}
```

**Agent 增强**：
```json
{
  "description": "Wrap ListItem component with React.memo and onClick handler with useCallback to prevent unnecessary re-renders",
  "keywords": ["react", "memo", "useCallback", "performance", "re-render"],
  "confidence": 0.92,
  "type": "performance",
  "priority": "high"
}
```

#### 场景 2：过滤噪音

**用户输入**：
```
这个安全问题是什么原因？我看不懂错误信息
```

**关键词方法**：
```json
{
  "type": "security",
  "description": "这个安全问题是什么原因？我看不懂错误信息",
  "confidence": 0.85  // ❌ 错误：这不是规则！
}
```

**Agent 增强**：
```json
{
  "is_valid": false,  // ✅ 正确：识别为纯问句
  "reason": "Question only, no actionable advice"
}
```

## 成本分析

### Token 使用

假设：
- 每个模式平均 200 tokens（输入）
- Agent 分析输出 100 tokens
- 总计：300 tokens/pattern

**场景 1：单次会话分析**
```
候选模式：20 个
Token 使用：20 × 300 = 6,000 tokens
成本：~$0.02（使用 Sonnet）
```

**场景 2：批量分析 100 个会话**
```
候选模式：500 个
Token 使用：500 × 300 = 150,000 tokens
成本：~$0.50（使用 Sonnet）
```

### 优化建议

1. **选择性增强**：只对高置信度候选模式使用 Agent
2. **批量处理**：合并多个模式在一个请求中
3. **使用 Haiku**：对于简单场景使用更便宜的模型
4. **缓存结果**：相同的模式不重复分析

## 实现计划

### Phase 1：基础实现（MVP）
- [ ] 实现基础的 Agent 调用逻辑
- [ ] 设计并测试 Prompt
- [ ] 实现结果解析和合并
- [ ] 添加 `--enhance` 参数

### Phase 2：优化
- [ ] 实现批量处理
- [ ] 添加缓存机制
- [ ] 性能测试和调优
- [ ] 错误处理和回退

### Phase 3：高级功能
- [ ] 并行处理
- [ ] 模型选择（Opus/Sonnet/Haiku）
- [ ] 成本控制和预算
- [ ] 详细的增强报告

## 总结

使用 Agent 增强规则质量是一个自然的进化：

**关键词匹配** → **噪音过滤** → **Agent 语义分析**

预期收益：
- ✅ 95%+ 有效规则率
- ✅ 高质量的规范化描述
- ✅ 更准确的元数据提取
- ✅ 用户体验提升

实现风险：
- ⚠️  增加延迟（可接受：20-30秒）
- ⚠️  依赖外部服务（有回退机制）
- ⚠️  Token 成本（可控：<$1/100 会话）

**推荐策略**：作为可选功能（`--enhance`），让用户选择是否使用。
