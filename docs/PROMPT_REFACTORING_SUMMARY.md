# Prompt Refactoring Summary

## 问题分析

从日志 `~/.autoimprove/llm-calls.log` 分析发现：

1. **实际使用的是 `batch-llm-rule-generator.ts`**，不是 `llm-rule-generator.ts`
2. `llm-rule-generator.ts` 中的 `loadClusterContents` 和详细的 prompt 模板**从未被调用过**
3. 两个 generator 有各自独立的 prompt 构建逻辑，导致代码重复

## 解决方案

### 已完成：创建统一的 Prompt Builder

创建了 `src/mcp-server-ts/src/core/llm-prompt-builder.ts`，提供：

#### 1. 统一的数据结构

```typescript
export interface PromptEvidence {
  description: string;
  confidence: number;
  occurrences: number;
  keywords: string[];
  contentExamples?: string[];  // 详细内容（content-based）
  userContext?: string[];       // 用户输入上下文（pattern-based）
}

export interface PromptOptions {
  patternType: PatternType;
  avgConfidence: number;
  commonKeywords: string[];
  totalOccurrences: number;
  sessionCount?: number;
  isBatchMode: boolean;          // 是否批量合并模式
  maxContentExamples?: number;
}
```

#### 2. 核心构建方法

```typescript
static buildPrompt(evidence: PromptEvidence[], options: PromptOptions): string
```

**自动适配两种模式：**

- **Content-based 模式**（`llm-rule-generator.ts`）：
  - 使用 `contentExamples`（完整的对话内容）
  - 提供更详细的上下文，适合深度分析

- **Pattern-based 模式**（`batch-llm-rule-generator.ts`）：
  - 使用 `description` + `userContext`（用户输入摘要）
  - 更紧凑，适合批量处理

#### 3. 转换工具方法

```typescript
// Pattern → PromptEvidence
static patternToEvidence(pattern: Pattern): PromptEvidence

// LabeledContent → PromptEvidence  
static contentToEvidence(
  contents: LabeledContent[],
  description: string,
  avgConfidence: number,
  keywords: string[]
): PromptEvidence
```

### 部分完成：Generator 重构

#### batch-llm-rule-generator.ts ✅

已成功重构为使用 `LLMPromptBuilder`：

```typescript
// 旧代码（已删除）
const prompt = this.buildBatchPrompt(cluster, qualifiedPatterns);

// 新代码
const evidence: PromptEvidence[] = qualifiedPatterns.map(p =>
  LLMPromptBuilder.patternToEvidence(p)
);

const prompt = LLMPromptBuilder.buildPrompt(evidence, {
  patternType: cluster.pattern_type,
  avgConfidence: cluster.avg_confidence,
  commonKeywords: cluster.common_keywords,
  totalOccurrences: cluster.total_occurrences,
  sessionCount: cluster.session_count,
  isBatchMode: true,
  maxContentExamples: 5
});
```

#### llm-rule-generator.ts ⚠️ (部分完成)

修改了 `generateRule` 方法以使用 `LLMPromptBuilder`，但存在类型兼容性问题需要解决。

## 待完成工作

### 1. 修复类型定义 ⚠️ 

需要统一 `PatternCluster` 和 `PatternClusterGroup` 的类型定义：

```typescript
// pattern-clusterer.ts
export interface PatternCluster {
  pattern_type: PatternType;  // 改为 PatternType 而不是 string
  representative_description?: string;  // 添加缺失字段
  // ...
}

// pattern-similarity-clusterer.ts
export interface PatternClusterGroup {
  pattern_type: PatternType;  // 改为 Patter是 string
  session_count?: number;     // 添加缺失字段
  // ...
}
```

### 2. 编译并测试

```bash
cd src/mcp-server-ts
npm run build
npm test
```

### 3. 验证 LLM 日志

运行 batch rebuild 后检查日志：

```bash
tail -100 ~/.autoimprove/llm-calls.log
```

应该看到统一格式的 prompt，包含：
- 清晰的 metadata 部分
- Pattern/Content evidence 部分
- 统一的输出格式说明
- 质量标准说明

## 设计优势

### 1. **单一数据源**
- 所有 prompt 构建逻辑集中在 `LLMPromptBuilder`
- 修改 prompt 模板只需改一个地方

### 2. **自动适配**
- 根据 `evidence` 中是否有 `contentExamples` 自动选择模式
- Pattern-based: 紧凑高效
- Content-based: 详细深入

### 3. **可扩展**
- 新增 prompt 部分只需添加方法到 `LLMPromptBuilder`
- 支持不同场景的差异化配置（通过 `PromptOptions`）

### 4. **Token 优化**
- `selectRepresentativeEvidence` 方法智能选择最有代表性的样本
- 避免重复和冗余内容

## 后续优化建议

1. **添加 prompt 版本控制**
   - 在日志中记录 prompt 版本
   - 方便 A/B 测试不同 prompt 策略

2. **提取 prompt 模板到配置文件**
   - 将 quality standards 等文本提取到 YAML/JSON
   - 方便非程序员调优

3. **添加 prompt 性能监控**
   - 记录每个 prompt 生成的规则质量
   - 自动优化 prompt 参数

## 测试建议

```bash
# 1. 运行一次 batch rebuild
cd src/skills-ts
npm run build && npx tsx src/autoimprove-summarize/skill.ts

# 2. 检查生成的 rules 质量
ls ~/.autoimprove/rules/content/ | wc -l

# 3. 对比新旧 prompt 生成的规则
grep -A 20 "FULL PROMPT:" ~/.autoimprove/llm-calls.log | tail -50
```

## 提交建议

```bash
git add src/mcp-server-ts/src/core/llm-prompt-builder.ts
git add src/mcp-server-ts/src/core/batch-llm-rule-generator.ts
git commit -m "refactor: create unified LLM prompt builder

- Extract prompt logic to LLMPromptBuilder class
- Support both content-based and pattern-based modes
- Auto-adapt prompt based on evidence type
- Refactor batch-llm-rule-generator to use new builder

Fixes duplicate prompt logic between generators"
```
