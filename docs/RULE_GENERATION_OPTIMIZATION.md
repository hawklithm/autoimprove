# 规则生成优化方案

## 问题诊断

根据反馈，当前规则生成存在三个主要问题：

### 1. 规则内容缺失
**现象**：生成的规则只有标题描述，缺少详细的推荐做法和示例代码
- `rule-003`: "必填参数未提前校验导致空指针异常或逻辑错误" (缺少具体建议)
- `rule-005`: "风控回调缺失或异常处理不当影响主流程" (缺少具体建议)
- `rule-012`: "Redis锁key使用冒号分隔而非下划线" (缺少具体建议)

**根本原因**：
- `HybridRuleGenerator` 的 Phase 2 (LLM 增强) 默认**未启用** (`useLLMEnhancement = false`)
- `BasicGenerator` 只生成简单的 title + description，没有详细的 how-to 和 examples
- Code example extraction (Phase 3) 无法补偿缺失的具体建议

### 2. 智能合并过于激进
**现象**：207个模式被过度合并成3条规则，丢失重要细节

**根本原因**：
- `consolidateWithAgent()` 的 semantic grouping 阈值过低
- 合并逻辑倾向于"大而全"的规则，而不是"小而精"
- 没有对**高价值模式**设置保护机制（强制独立成规则）

### 3. 重要模式缺失
**现象**：以下高频模式没有生成规则：
- Git提交规范 (不提交 MD/SQL/Shell 文件)
- DbClient 包装规则 (所有 mapper 必须通过 DbClient)
- 事务边界优化 (只包含 mapper 操作)
- Code Review 规范 (必须提供行号)
- Java 全限定类名问题
- API 路径前缀规范
- 批量查询优化
- 活动结束时间判断

**根本原因**：
- `minConfidence = 0.85` 过高，过滤掉了一些低频但重要的模式
- Pattern detection 对某些规范类模式的识别不足
- 合并时没有区分"规范类"和"错误类"模式

---

## 优化方案

### 方案 A：启用 LLM 增强 + 调整合并策略 (推荐)

#### 1. 默认启用 LLM 增强

**文件**: `src/mcp-server-ts/src/index.ts` (handleGenerateRules)

**修改**：
```typescript
// 修改前 (Line ~1008)
const useLLMEnhancement = args.use_llm_enhancement === true;

// 修改后
const useLLMEnhancement = args.use_llm_enhancement !== false; // 默认启用
```

**影响**：
- 规则生成时会调用 Anthropic API 生成详细的建议和示例
- Token 成本增加：每个模式 ~1500 tokens (优化后 ~900 tokens)
- 时间成本：10个模式约需 5-10 秒

**配置**：需要设置 `ANTHROPIC_API_KEY` 环境变量

#### 2. 降低最小置信度阈值

**文件**: `src/skills-ts/src/autoimprove-summarize/skill.ts` (Line 58)

**修改**：
```typescript
// 修改前
const minConfidence = minConfidenceArg ? parseFloat(minConfidenceArg) : 0.85;

// 修改后
const minConfidence = minConfidenceArg ? parseFloat(minConfidenceArg) : 0.60;
```

**影响**：
- 更多低频但重要的模式会被保留
- 可能产生一些低质量规则 (需要后续过滤)

#### 3. 调整合并策略：分类保护

**文件**: `src/skills-ts/src/autoimprove-summarize/skill.ts` (consolidateWithAgent)

**新增逻辑**：
```typescript
// 识别"规范类"模式 - 这些模式应该独立成规则
function isConventionPattern(pattern: Pattern): boolean {
  const keywords = [
    'git', 'commit', '提交', '规范', 'convention',
    'review', '审核', 'code review',
    'prefix', '前缀', 'naming', '命名',
    'package', '包装', 'wrapper',
    'transaction', '事务', 'boundary'
  ];
  
  const desc = pattern.description.toLowerCase();
  return keywords.some(kw => desc.includes(kw));
}

// 在合并前，将规范类模式标记为"不可合并"
const protectedPatterns = patterns.filter(isConventionPattern);
const mergablePatterns = patterns.filter(p => !isConventionPattern(p));
```

#### 4. 优化合并阈值：提高最小组大小

**文件**: Agent prompt in `consolidateWithAgent()` (Line ~630)

**修改**：
```typescript
const agentPrompt = `...

**Grouping Rules:**
- Only merge patterns if they share BOTH topic AND context
- Minimum group size: 2 patterns (don't force small patterns into groups)
- Maximum group size: 5 patterns (prevent mega-groups)
- Keep high-specificity patterns separate (e.g., "Redis key format", "Git commit rules")

**Examples of what NOT to merge:**
- "Redis key naming" + "Database transaction scope" (different topics)
- "Git commit rules" + "Code review format" (both are conventions but different areas)
- Specific rules like "DbClient wrapper" should stay independent

...`;
```

---

### 方案 B：两阶段生成（粗 → 细）

**流程**：
1. **Phase 1**: 基础检测 → 生成简单规则
2. **Phase 2**: LLM 对每条规则进行二次增强，补充具体建议和代码示例

**优势**：
- 保证所有规则都有详细内容
- 可以针对性地为不同类型的规则生成不同格式的内容

**劣势**：
- Token 成本翻倍
- 时间成本增加

---

### 方案 C：混合策略（推荐实施）

结合方案 A 和 B 的优点：

1. **默认启用 LLM 增强** (方案 A.1)
2. **降低置信度阈值到 0.60** (方案 A.2)
3. **规范类模式保护机制** (方案 A.3)
4. **优化合并策略** (方案 A.4)
5. **添加 token budget 参数**：允许用户控制成本

**新增命令行参数**：
```bash
/autoimprove-summarize --min-confidence 0.60 --max-rules 20 --enable-llm
```

**Token Budget 控制**：
```typescript
interface ConsolidationOptions {
  minConfidence: number;
  maxRules?: number;        // 最多生成多少条规则 (默认无限制)
  enableLLM?: boolean;      // 是否启用 LLM 增强 (默认 true)
  tokenBudget?: number;     // Token 预算 (默认 50000)
}
```

---

## 实施优先级

### Phase 1: 快速修复 (1-2小时)
- [x] 修改 `useLLMEnhancement` 默认值为 true
- [x] 降低 `minConfidence` 到 0.60
- [x] 添加规范类模式识别函数
- [x] 修改合并 prompt，提高最小组大小

### Phase 2: 增强功能 (3-4小时)
- [ ] 添加命令行参数支持 (`--min-confidence`, `--max-rules`, `--enable-llm`)
- [ ] 实现 token budget 控制
- [ ] 优化合并逻辑的 grouping 阈值
- [ ] 添加合并前的"高价值模式"检测

### Phase 3: 质量提升 (1-2天)
- [ ] 改进 `LLMRuleGenerator` 的 prompt engineering
- [ ] 添加规则模板系统（针对不同类型的规则）
- [ ] 实现规则内容质量评分
- [ ] 添加交互式规则审核流程

---

## 验证方案

### 测试场景 1：207个模式 → 期望结果
- **当前**：3条规则（内容不完整）
- **优化后期望**：15-25条规则（每条有详细建议和示例）

### 测试场景 2：重要模式保留率
检查以下模式是否生成独立规则：
- ✅ Git提交规范
- ✅ DbClient 包装
- ✅ 事务边界优化
- ✅ Code Review 规范
- ✅ Java 全限定类名
- ✅ API 路径前缀
- ✅ 批量查询优化
- ✅ 活动结束时间判断

### 测试场景 3：规则内容完整性
每条规则应包含：
- ✅ 标题描述
- ✅ 问题原因
- ✅ **推荐做法** (how-to)
- ✅ **代码示例** (good/bad)
- ✅ 适用场景
- ✅ 例外情况

---

## Token 成本估算

### 当前成本 (不启用 LLM)
- 207个模式 → 3条规则
- Token 使用：~5000 tokens (仅合并)
- 时间：~10秒

### 优化后成本 (启用 LLM)
- 207个模式 → 20条规则
- Token 使用：~30000 tokens
  - Pattern detection: ~5000 tokens
  - LLM enhancement: 20 rules × 1000 tokens = ~20000 tokens
  - Consolidation: ~5000 tokens
- 时间：~30-45秒
- 成本：约 $0.10-0.15 (Claude Sonnet 价格)

### Token 优化措施
1. 使用 batch processing 减少 LLM 调用次数
2. 缓存相似模式的 LLM 结果
3. 对低置信度模式跳过 LLM 增强

---

## 配置文件示例

`~/.autoimprove/config.json`:
```json
{
  "rule_generation": {
    "min_confidence": 0.60,
    "enable_llm_enhancement": true,
    "max_rules_per_session": 25,
    "token_budget": 50000,
    "consolidation": {
      "min_group_size": 2,
      "max_group_size": 5,
      "preserve_conventions": true,
      "similarity_threshold": 0.75
    }
  }
}
```

---

## 下一步行动

1. **立即实施** Phase 1 快速修复
2. **测试验证** 使用历史 207 个模式重新生成
3. **收集反馈** 检查规则质量和完整性
4. **迭代优化** 根据反馈调整参数和策略
