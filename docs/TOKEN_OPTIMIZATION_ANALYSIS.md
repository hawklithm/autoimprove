# Token消耗分析与优化方案

## 当前Token消耗分析

### 1. 主要消耗来源

通过分析代码，发现以下几个主要的token消耗点：

| 组件 | 调用场景 | Input Tokens | Output Tokens | 总消耗 | 频率 |
|------|---------|--------------|---------------|--------|------|
| **LLMRuleGenerator** | 规则生成（集群模式） | ~800-1000 | ~800-1200 | ~1800-2200 | 每个cluster 1次 |
| **HybridRuleGenerator** | 规则增强（Phase 2） | ~800-1000 | ~1000-1500 | ~1800-2500 | 每个pattern 1次 |
| **LLMSignalExtractor** | 信号提取（未匹配内容） | ~400-600 | ~300-500 | ~700-1100 | 每20条消息 1次 |
| **RuleQualityController** | 规则质量评估 | ~200-300 | ~100-200 | ~300-500 | 每条规则 1次（可选） |

### 2. 详细分析

#### LLMRuleGenerator (最大消耗源)

**Prompt长度**: ~2800 tokens
- 固定模板: ~2200 tokens (包含详细的7个部分说明和JSON示例)
- 内容示例: ~600 tokens (最多10条用户消息)

**问题**:
```typescript
// llm-rule-generator.ts:160-282
private buildRuleGenerationPrompt(cluster: PatternCluster, contents: LabeledContent[]): string {
  // 包含大量详细说明和示例
  // 每次调用都发送完整的2800+ token prompt
}
```

**优化机会**:
- Prompt模板过于冗长（2200 tokens的固定模板）
- 包含大量示例和解释文字
- 每次调用都重复发送相同的模板

#### HybridRuleGenerator (第二大消耗源)

**Prompt长度**: ~2500 tokens
- 固定模板: ~2000 tokens
- 用户消息: ~500 tokens

**问题**:
```typescript
// hybrid-rule-generator.ts:205-296
private buildEnhancementPrompt(pattern: Pattern, basicContent: RuleContent): string {
  // 详细的增强说明
  // 包含大量示例
}
```

#### LLMSignalExtractor (批量调用累积)

**单次调用**: ~700-1100 tokens
**批处理**: 每20条消息调用一次
**累积消耗**: 如果有200条未匹配消息 → 10次调用 → 7000-11000 tokens

**使用的模型**: `claude-haiku-4-5-20251001` (✅ 已经是最小模型)

### 3. 总消耗场景估算

**场景A: 分析一个session (基础模式)**
- SessionAnalyzer: 0 tokens (纯规则匹配)
- 总消耗: **0 tokens**

**场景B: 分析一个session (自适应模式，启用信号提取)**
- Signal matching: 0 tokens
- Signal extraction (假设40条未匹配): 2次LLM调用 × 900 tokens = 1800 tokens
- 总消耗: **~1800 tokens**

**场景C: 生成规则 (基础模式)**
- RuleGenerator: 0 tokens (纯模板生成)
- 总消耗: **0 tokens**

**场景D: 生成规则 (增强模式，5个pattern)**
- HybridRuleGenerator: 5 patterns × 2200 tokens = 11000 tokens
- CodeExampleExtractor: 0 tokens
- 总消耗: **~11000 tokens**

**场景E: 从集群生成规则 (LLM模式，3个cluster)**
- LLMRuleGenerator: 3 clusters × 2000 tokens = 6000 tokens
- 总消耗: **~6000 tokens**

**最差场景: 完整工作流 (自适应分析 + LLM规则生成)**
- 分析session: 1800 tokens
- 信号聚类: 0 tokens
- LLM规则生成 (5个cluster): 10000 tokens
- 规则质量评估 (5条规则): 2000 tokens
- **总消耗: ~13800 tokens**

## 优化方案

### 🎯 方案1: Prompt压缩与优化 (推荐，立即见效)

**目标**: 减少50-70%的prompt token消耗，不影响输出质量

#### 1.1 精简Prompt模板

**当前问题**:
- LLMRuleGenerator的prompt有2800+ tokens
- 包含大量冗余的解释文字和示例
- 每个部分都有详细说明 + 示例

**优化策略**:

```typescript
// 优化前 (~2800 tokens)
private buildRuleGenerationPrompt(cluster: PatternCluster, contents: LabeledContent[]): string {
  return `You are creating a comprehensive coding rule from observed correction/preference patterns.

Pattern Type: ${cluster.pattern_type}
...

Generate a comprehensive, actionable coding rule with the following structure:

1. **Title**: Short, actionable title in imperative form (60-80 chars)
   - Start with a verb (e.g., "Use", "Avoid", "Prefer", "Always", "Never")
   - Be specific and concrete
   - Examples: "Use useState for simple state management", "Avoid nested ternary operators"

2. **Description**: What to do OR what to avoid (3-5 sentences)
   - Be clear and specific about the recommended practice
   - Explain the correct approach with context
   - Include what to look for in code reviews
   - Mention concrete patterns or indicators
...

Respond in JSON format:
{
  "title": "Use useState for simple state management",
  "description": "For boolean or simple primitive value state, use useState instead of useReducer. Reserve useReducer for complex state objects with multiple sub-values or complex state transitions. Simple state updates like toggling a boolean, incrementing a counter, or storing a string should use useState for clarity and simplicity.",
  ...
}`;
}

// 优化后 (~900 tokens, -68%)
private buildRuleGenerationPrompt(cluster: PatternCluster, contents: LabeledContent[]): string {
  const contentExamples = contents.slice(0, 5).map(c => c.content).join('\n'); // 减少到5条

  return `Create coding rule from pattern observations.

Type: ${cluster.pattern_type} | Occurrences: ${cluster.total_occurrences} | Confidence: ${(cluster.avg_confidence * 100).toFixed(0)}%

Examples:
${contentExamples}

Output JSON with:
- title: imperative, 60-80 chars
- description: what to do/avoid, 3-5 sentences
- rationale: why (2-4 sentences)
- how_to_apply: 3-6 actionable steps
- examples: {bad?, good, explanation} if applicable
- when_to_use: 3-5 conditions
- exceptions: 2-4 cases (optional)
- scenes: {tech[], business[], generic: bool}

Example output:
{"title":"Use useState for simple state","description":"For primitive values, use useState not useReducer. Reserve useReducer for complex state with multiple sub-values.","rationale":"useState is simpler and clearer for basic cases. useReducer adds unnecessary boilerplate.","how_to_apply":["Check if state is single primitive","Flag useReducer with <3 simple actions in reviews"],"when_to_use":["State is boolean/string/number","Simple toggle/set updates"],"scenes":{"tech":["react","hooks"],"business":[],"generic":false}}`;
}
```

**节省**: 2800 → 900 tokens = **-68% (-1900 tokens/次)**

#### 1.2 使用System Prompt代替重复的模板

**策略**: 将固定的指导说明移到system prompt，只在user message中传递变化的数据

```typescript
// 优化前：每次在user message中发送完整模板
const response = await this.anthropic.messages.create({
  model: "claude-sonnet-4-6-20250514",
  max_tokens: 1500,
  messages: [{
    role: "user",
    content: longPromptWith2800Tokens
  }]
});

// 优化后：固定说明放在system，数据放在user
const response = await this.anthropic.messages.create({
  model: "claude-sonnet-4-6-20250514",
  max_tokens: 1500,
  system: this.getRuleGenerationSystemPrompt(), // 缓存，只计费一次
  messages: [{
    role: "user",
    content: compactDataOnlyPrompt  // ~300 tokens
  }]
});
```

**Claude API的Prompt Caching**:
- System prompt会被缓存（5分钟TTL）
- 缓存的token只在第一次计费，后续调用90%折扣
- 实际节省: 批量调用时，2000 tokens固定部分 → 200 tokens (90% off)

**节省**: 2800 → 300 (user) + 200 (cached system) = **500 tokens (-82%)**

#### 1.3 减少示例数量

**当前**:
```typescript
const contentExamples = contents
  .slice(0, 10) // 最多10条示例
  .map((c, i) => `${i + 1}. ${c.content}`)
  .join('\n');
```

**优化**:
```typescript
// 智能选择最有代表性的3-5条
const contentExamples = this.selectRepresentativeExamples(contents, 3);
```

**策略**:
- 使用TF-IDF或嵌入相似度选择多样性最高的示例
- 优先选择较短的示例（信息密度高）
- 去重相似内容

**节省**: ~600 tokens → ~200 tokens = **-67%**

### 🎯 方案2: 批处理优化

#### 2.1 合并多个Pattern为一个LLM调用

**当前问题**: 每个pattern调用一次LLM
```typescript
// 5个patterns = 5次LLM调用 × 2200 tokens = 11000 tokens
for (const pattern of patterns) {
  const rule = await this.enhanceWithLLM(pattern, ...);
}
```

**优化**: 批量处理
```typescript
// 5个patterns = 1次LLM调用 × 3000 tokens = 3000 tokens (-73%)
const rules = await this.batchEnhanceWithLLM(patterns, ...);
```

**实现**:
```typescript
private async batchEnhanceWithLLM(
  patterns: Pattern[],
  basicContents: RuleContent[]
): Promise<RuleContent[]> {
  const batchPrompt = patterns.map((p, i) => 
    `Pattern ${i + 1}: ${p.description}\nOccurrences: ${p.occurrences.length}`
  ).join('\n\n');

  // 单次调用生成多条规则
  const prompt = `Generate rules for these ${patterns.length} patterns:\n\n${batchPrompt}`;
  
  // 返回JSON数组
}
```

**节省**: 5 × 2200 → 1 × 3000 = **-73% (-8000 tokens)**

#### 2.2 条件触发LLM增强

**策略**: 不是所有规则都需要LLM增强

```typescript
// 优先级评分
function shouldUseLLMEnhancement(pattern: Pattern): boolean {
  // 只对高价值规则使用LLM
  if (pattern.confidence < 0.6) return false; // 低置信度规则不值得
  if (pattern.occurrences.length < 2) return false; // 单次出现不值得
  if (pattern.priority === "low") return false; // 低优先级不值得
  
  return true;
}

// 在batchGenerate中过滤
const patternsNeedingLLM = patterns.filter(shouldUseLLMEnhancement);
const patternsBasic = patterns.filter(p => !shouldUseLLMEnhancement(p));

// 只对需要的使用LLM
const enhancedRules = await hybridGenerator.batchGenerateEnhancedRules(patternsNeedingLLM, ...);
const basicRules = generator.batchGenerateRules(patternsBasic, ...);
```

**节省**: 假设50%的规则不需要LLM → **-50% token消耗**

### 🎯 方案3: 模型选择优化

#### 3.1 分级使用模型

| 任务 | 当前模型 | 优化模型 | 节省 |
|------|----------|----------|------|
| 信号提取 | Haiku 4.5 | ✅ 已最优 | - |
| 简单规则生成 | Sonnet 4.6 | **Haiku 4.5** | -75% 成本 |
| 复杂规则生成 | Sonnet 4.6 | ✅ 保持 | - |
| 规则增强 | Sonnet 4.6 | **Haiku 4.5** (简单) / Sonnet (复杂) | -40% 平均成本 |

**实现**:
```typescript
function selectModel(pattern: Pattern): string {
  // 复杂场景用Sonnet
  if (pattern.type === "security") return "claude-sonnet-4-6-20250514";
  if (pattern.confidence > 0.8 && pattern.occurrences.length > 5) {
    return "claude-sonnet-4-6-20250514"; // 高质量规则
  }
  
  // 简单场景用Haiku
  return "claude-haiku-4-5-20251001"; // 性价比高
}
```

**Haiku vs Sonnet成本对比**:
- Haiku: $0.25/1M input, $1.25/1M output
- Sonnet: $3/1M input, $15/1M output
- **Haiku比Sonnet便宜12倍**

#### 3.2 降低max_tokens

**当前配置**:
```typescript
max_tokens: 2000  // HybridRuleGenerator
max_tokens: 1500  // LLMRuleGenerator
```

**优化**: 动态调整
```typescript
function calculateMaxTokens(pattern: Pattern): number {
  // 简单规则不需要那么多输出
  if (pattern.type === "preference" && pattern.occurrences.length < 3) {
    return 800;  // -60%
  }
  
  // 复杂规则保持充足
  if (pattern.type === "security" || pattern.type === "anti-pattern") {
    return 1500;
  }
  
  return 1000;  // 默认 -50%
}
```

**节省**: 平均输出 1500 → 1000 tokens = **-33%**

### 🎯 方案4: 缓存与去重

#### 4.1 规则内容缓存

**问题**: 相似的pattern可能生成相似的规则

**策略**: 
```typescript
class RuleGenerationCache {
  private cache = new Map<string, RuleContent>();
  
  getCacheKey(pattern: Pattern): string {
    // 基于描述和关键词生成key
    return `${pattern.type}:${pattern.description.slice(0, 50)}:${pattern.keywords.join(',')}`;
  }
  
  async generateOrGetCached(pattern: Pattern): Promise<RuleContent> {
    const key = this.getCacheKey(pattern);
    
    if (this.cache.has(key)) {
      console.log(`Using cached rule for pattern: ${pattern.description}`);
      return this.cache.get(key)!;
    }
    
    const rule = await this.generateWithLLM(pattern);
    this.cache.set(key, rule);
    return rule;
  }
}
```

**节省**: 重复pattern不再调用LLM

#### 4.2 Signal提取去重

**当前问题**: 每次session分析都可能提取相同的信号

**优化**:
```typescript
async extractSignals(unmatchedContent: string[]): Promise<ExtractionResult> {
  // 预过滤：已知pattern不再提取
  const filtered = unmatchedContent.filter(content => {
    const hash = this.getContentHash(content);
    return !this.db.hasProcessedContent(hash);
  });
  
  if (filtered.length === 0) {
    return { /* 全部跳过 */ };
  }
  
  // 只对新内容调用LLM
  return this.extractFromBatch(filtered);
}
```

### 🎯 方案5: 配置化控制

**创建配置文件** `~/.autoimprove/optimization.json`:

```json
{
  "token_optimization": {
    "enable_prompt_compression": true,
    "enable_prompt_caching": true,
    "enable_batch_processing": true,
    
    "llm_rule_generation": {
      "use_haiku_for_simple": true,
      "simple_rule_threshold": 0.6,
      "max_examples_per_prompt": 3,
      "enable_caching": true
    },
    
    "signal_extraction": {
      "batch_size": 20,
      "enable_deduplication": true,
      "min_match_rate_for_extraction": 0.4
    },
    
    "hybrid_enhancement": {
      "enable_selective_enhancement": true,
      "min_confidence_for_llm": 0.6,
      "min_occurrences_for_llm": 2
    }
  }
}
```

## 综合优化方案 (推荐组合)

### ⭐ 阶段1: 立即优化 (无需改动API)

1. **Prompt压缩** (方案1.1)
   - 精简LLMRuleGenerator prompt: 2800 → 900 tokens
   - 精简HybridRuleGenerator prompt: 2500 → 800 tokens
   - **节省**: ~70% prompt tokens

2. **示例数量优化** (方案1.3)
   - 10条示例 → 3-5条智能选择
   - **节省**: ~400 tokens/次

3. **降低max_tokens** (方案3.2)
   - 动态调整输出长度
   - **节省**: ~33% 输出tokens

**总节省**: 约 **60-70%** token消耗

### ⭐ 阶段2: 深度优化 (需要API调整)

4. **System Prompt + Prompt Caching** (方案1.2)
   - 利用Claude的prompt caching
   - **节省**: 批量场景下 **~80%**

5. **批处理** (方案2.1)
   - 合并多个pattern为一次调用
   - **节省**: **~70%** (5个pattern场景)

6. **选择性LLM** (方案2.2 + 3.1)
   - 简单规则用Haiku或跳过LLM
   - **节省**: **~50%** 成本 + tokens

**总节省**: 约 **80-85%** token消耗 + 成本

### ⭐ 阶段3: 智能优化 (长期)

7. **缓存与去重** (方案4)
8. **配置化控制** (方案5)

## 实施优先级

| 优先级 | 方案 | 实施难度 | 预期节省 | 风险 |
|--------|------|----------|----------|------|
| P0 | Prompt压缩 (1.1) | 低 | 70% | 低 |
| P0 | 示例优化 (1.3) | 低 | 400 tokens | 低 |
| P0 | max_tokens动态调整 (3.2) | 低 | 33% | 低 |
| P1 | 选择性LLM (2.2) | 中 | 50% | 低 |
| P1 | System Prompt缓存 (1.2) | 中 | 80%批量 | 中 |
| P2 | 批处理 (2.1) | 中 | 70% | 中 |
| P2 | 模型分级 (3.1) | 低 | 成本-75% | 中 |
| P3 | 缓存去重 (4) | 高 | 变量 | 低 |

## 预期效果

### 优化前 (当前)
- 分析1个session (自适应): **1800 tokens**
- 生成5条规则 (增强模式): **11000 tokens**
- 总计: **12800 tokens**

### 优化后 (阶段1)
- 分析1个session: **600 tokens** (-67%)
- 生成5条规则: **3000 tokens** (-73%)
- 总计: **3600 tokens** (-72%)

### 优化后 (阶段2)
- 分析1个session: **400 tokens** (-78%)
- 生成5条规则 (批量+缓存): **800 tokens** (-93%)
- 总计: **1200 tokens** (-91%)

## 下一步

1. ✅ 我可以立即实施阶段1的优化（Prompt压缩 + 示例优化 + max_tokens调整）
2. 需要你确认是否接受API变化后，实施阶段2（批处理 + System Prompt）
3. 长期迭代阶段3

你想让我先实施哪些优化？推荐从P0开始，立即见效且无风险。
