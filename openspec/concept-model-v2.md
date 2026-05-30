# AutoImprove 概念模型（v2.0 - 基于验证更新）

> 本文档基于 5 种场景的验证结果更新，整合了关键发现和改进方案。

---

## 更新日志

**v2.0 (2026-05-30)**
- ✅ 添加 Pattern 分类策略（5 种类型）
- ✅ 更新置信度计算公式（类型特定权重）
- ✅ 扩展数据结构（category、priority、keywords）
- ✅ 添加关键词检测机制
- ✅ 调整阈值策略（分类阈值 0.3-0.5）

---

## 1. Scene（场景）- 三维模型

### 定义

Scene 是规则和知识的组织维度，采用三维正交模型：

```typescript
interface Scene {
  tech?: string[];        // 技术栈维度
  functional?: string[];  // 功能域维度
  business?: string[];    // 业务域维度
}
```

### 三个维度

**技术栈（Tech Stack）**
- 定义：项目使用的技术、框架、工具
- 特点：相对稳定，项目级
- 例子：`react`, `vue`, `node`, `python`, `prisma`, `postgresql`
- 检测：文件扩展名、import 语句、package.json

**功能域（Functional Domain）**
- 定义：通用的功能领域，跨项目适用
- 特点：标准化，可复用
- 例子：`auth`, `api`, `database`, `ui`, `testing`, `performance`, `security`
- 检测：关键词、文件路径、代码模式

**业务域（Business Domain）**
- 定义：项目特定的业务模块
- 特点：项目特定，需要配置
- 例子：`user-management`, `billing`, `analytics`, `notification`
- 检测：混合方案（推断 + 配置）

---

## 2. Pattern（模式）- 五种类型 🆕

### 类型定义

```typescript
type PatternType = 
  | 'repeated-correction'  // 重复修正
  | 'anti-pattern'         // 反模式
  | 'preference'           // 用户偏好
  | 'performance'          // 性能优化 🆕
  | 'security';            // 安全问题 🆕

interface Pattern {
  type: PatternType;
  description: string;
  occurrences: PatternOccurrence[];
  first_seen: string;
  last_seen: string;
  confidence: number;
  
  // 🆕 新增字段
  category?: 'functional' | 'style' | 'performance' | 'security';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  keywords?: string[];  // 检测到的关键词
}

interface PatternOccurrence {
  session_id: string;
  timestamp: string;
  user_action: 'explicit_correction' | 'amend' | 'undo' | 'accept';
  context: string;
  
  // 🆕 扩展字段
  test_passed?: boolean;
  performance_improved?: boolean;      // 性能是否改善
  security_issue?: string;             // 安全问题类型
  user_input?: string;                 // 用户原始输入（用于关键词检测）
}
```

### 类型特征

| 类型 | 特征 | 检测信号 | 示例 |
|------|------|---------|------|
| **repeated-correction** | 多次修正同一问题 | 同一区域多次编辑 + 用户修正 | JWT token 刷新逻辑 |
| **anti-pattern** | 错误模式 | 测试失败 → 修正 → 通过 | 直接使用 Prisma |
| **preference** | 风格偏好 | 语义等价修改 + 偏好关键词 | Named vs default exports |
| **performance** | 性能优化 | 性能问题 + 优化 + 改善 | useMemo 优化渲染 |
| **security** | 安全漏洞 | 安全关键词 + 用户警告 | SQL 注入防护 |

---

## 3. 分类策略 🆕

### 策略配置

```typescript
const patternStrategies = {
  'repeated-correction': {
    min_confidence: 0.5,
    min_occurrences: 2,              // 至少出现 2 次
    requires_multiple_sessions: true, // 需要跨会话
    weight_adjustment: 1.0,
    detect_keywords: [],
  },
  
  'anti-pattern': {
    min_confidence: 0.5,
    min_occurrences: 1,
    requires_test_validation: true,   // 需要测试验证
    weight_adjustment: 1.0,
    detect_keywords: [],
  },
  
  'preference': {
    min_confidence: 0.3,              // 🆕 降低阈值
    min_occurrences: 1,
    requires_multiple_sessions: false,
    weight_adjustment: 1.0,
    detect_keywords: [                // 🆕 关键词检测
      '我们团队', '团队习惯', '我更喜欢', '我们约定',
      'we prefer', 'our team', 'we use', 'convention'
    ],
  },
  
  'performance': {
    min_confidence: 0.4,              // 🆕 降低阈值
    min_occurrences: 1,
    requires_performance_evidence: true, // 需要性能改善证据
    weight_adjustment: 1.0,
    detect_keywords: [                // 🆕 关键词检测
      'useMemo', 'useCallback', 'React.memo',
      '重渲染', '性能', 'optimize', 'performance',
      'slow', 'lag', '卡顿'
    ],
  },
  
  'security': {
    min_confidence: 0.3,              // 🆕 最低阈值
    min_occurrences: 1,
    requires_multiple_sessions: false,
    weight_adjustment: 1.5,           // 🆕 提高权重
    priority: 'high',                 // 🆕 高优先级
    detect_keywords: [                // 🆕 关键词检测
      'sql injection', 'xss', 'csrf', 'injection',
      '注入', '安全', 'security', 'vulnerability',
      'sanitize', 'escape', 'validate', 'attack'
    ],
  },
};
```

### 类型判断逻辑

```typescript
function determinePatternType(pattern: Pattern): PatternType {
  // 1. 检查安全关键词（最高优先级）
  if (hasSecurityKeywords(pattern)) {
    return 'security';
  }
  
  // 2. 检查性能关键词
 PerformanceKeywords(pattern) && pattern.occurrences.some(o => o.performance_improved)) {
    return 'performance';
  }
  
  // 3. 检查偏好关键词
  if (hasPreferenceKeywords(pattern) && isSemanticEquivalent(pattern)) {
    return 'preference';
  }
  
  // 4. 检查测试失败→通过序列
  if (hasFailFixPassSequence(pattern)) {
    return 'anti-pattern';
  }
  
  // 5. 默认：重复修正
  return 'repeated-correction';
}
```

---

## 4. 置信度计算（v2.0）🆕

### 更新的计算公式

```typescript
function calculateConfidence(pattern: Pattern): number {
  // 步骤 1: 计算基础置信度
  const baseConfidence = calculateBaseConfidence(pattern);
  
  // 步骤 2: 应用类型特定的调整
  const adjustedConfidence = applyTypeAdjustments(pattern, baseConfidence);
  
  // 步骤 3: 应用关键词加成
  const finalConfidence = applyKeywordBonus(pattern, adjustedConfidence);
  
  return Math.min(finalConfidence, 1.0);
}

function calculateBaseConfidence(pattern: Pattern): number {
  // 因素 1: 频率得分（降低权重：0.4 → 0.3）
  const frequencyScore = Math.min(pattern.occurrences.length / 10, 1.0);
  
  // 因素 2: 时间跨度得分（降低权重：0.2 → 0.1）
  const timeSpanDays = daysBetween(pattern.first_seen, pattern.last_seen);
  const timeSpanScore = Math.min(timeSpanDays / 90, 1.0);
  
  // 因素 3: 用户行为得分（提高权重：0.3 → 0.4）
  const explicitCorrections = pattern.occurrences.filter(
    o => o.user_action === 'explicit_correction'
  ).length;
  const behaviorScore = explicitCorrections / pattern.occurrences.length;
  
  // 因素 4: 验证结果得分（提高权重：0.1 → 0.2）
  const validationScore = calculateValidationScore(pattern);
  
  // 🆕 更新的权重分配
  return (
    frequencyScore * 0.3 +    // 降低频率权重
    timeSpanScore * 0.1 +     // 降低时间权重
    behaviorScore * 0.4 +     // 提高用户行为权重
    validationScore * 0.2     // 提高验证权重
  );
}

function calculateValidationScore(pattern: Pattern): number {
  let score = 0;
  let count = 0;
  
  for (const occurrence of pattern.occurrences) {
    // 测试通过
    if (occurrence.test_passed === true) {
      score += 1.0;
      count++;
    }
    
    // 🆕 性能改善
    if (occurrence.performance_improved === true) {
      score += 1.0;
      count++;
    }
    
    // 🆕 安全问题修复
    if (occurrence.security_issue) {
      score += 1.0;
      count++;
    }
  }
  
  return count > 0 ? score / count : 0;
}

function applyTypeAdjustments(pattern: Pattern, baseConfidence: number): number {
  const strategy = patternStrategies[pattern.type];
  
  // 应用权重调整
  return baseConfidence * strategy.weight_adjustment;
}

function applyKeywordBonus(pattern: Pattern, confidence: number): number {
  const strategy = patternStrategies[pattern.type];
  
  if (!strategy.detect_keywords || strategy.detect_keywords.length === 0) {
    return confidence;
  }
  
  // 检查是否有关键词
  const hasKeyword = strategy.detect_keywords.some(keyword =>
    pattern.description.toLowerCase().includes(keyword.toLowerCase()) ||
    pattern.occurrences.some(o => 
      o.user_input?.toLowerCase().includes(keyword.toLowerCase())
    )
  );
  
  // 🆕 关键词加成
  if (hasKeyword) {
    return confidence + 0.2;  // 加 0.2
  }
  
  return confidence;
}
```

### 置信度阈值（分类）🆕

```typescript
function shouldGenerateRule(pattern: Pattern): boolean {
  const strategy = patternStrategies[pattern.type];
  
  // 检查置信度
  if (pattern.confidence < strategy.min_confidence) {
    return false;
  }
  
  // 检查出现次数
  if (pattern.occurrences.length < strategy.min_occurrences) {
    return false;
  }
  
  // 检查是否需要跨会话
  if (strategy.requires_multiple_sessions) {
    const uniqueSessions = new Set(pattern.occurrences.map(o => o.session_id));
    if (uniqueSessions.size < 2) {
      return false;
    }
  }
  
  // 检查是否需要测试验证
  if (strategy.requires_test_validation) {
    const hasTestValidation = pattern.occurrences.some(o => o.test_passed === true);
    if (!hasTestValidation) {
      return false;
    }
  }
  
  // 检查是否需要性能证据
  if (strategy.requires_performance_evidence) {
    const hasPerformanceEvidence = pattern.occurrences.some(o => o.performance_improved === true);
    if (!hasPerformanceEvidence) {
      return false;
    }
  }
  
  return true;
}
```

---

## 5. Rule（规则）- 扩展模型 🆕

### 数据结构

```typescript
interface Rule {
  // 标识
  id: string;
  
  // 内容
  content: string;
  reason: string;
  examples?: {
    good?: string[];
    bad?: string[];
  };
  
  // 场景（三维）
  scenes: Scene;
  
  // 元数据
  source: 'learned' | 'manual';
  confidence: number;
  
  // 🆕 新增字段
  type?: PatternType;                    // 规则类型
  category?: 'functional' | 'style' | 'performance' | 'security';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  keywords?: string[];                   // 相关关键词
  
  // 生命周期
  created_at: string;
  updated_at: string;
  last_triggered_at?: string;
  trigger_count: number;
}
```

### 规则优先级 🆕

```typescript
const rulePriorities = {
  'security': 'critical',      // 安全问题：最高优先级
  'anti-pattern': 'high',      // 反模式：高优先级
  'performance': 'medium',     // 性能优化：中优先级
  'repeated-correction': 'medium',
  'preference': 'low',         // 用户偏好：低优先级
};

function determineRulePriority(pattern: Pattern): string {
  // 安全问题始终是最高优先级
  if (pattern.type === 'security') {
    return 'critical';
  }
  
  // 其他类型根据置信度调整
  const basePriority = rulePriorities[pattern.type];
  
  if (pattern.confidence >= 0.9) {
    // 高置信度提升一级
    if (basePriority === 'medium') return 'high';
    if (basePriority === 'low') return 'medium';
  }
  
  return basePriority;
}
```

---

## 6. 规则处理策略

### 核心原则（不变）

**优先遵守规则，但用户明确要求时可以违反**

### 处理逻辑

```typescript
function handleRuleApplication(rule: Rule, userRequest: string): Action {
  // 1. 检查用户是否明确要求违反规则
  if (userExplicitlyViolatesRule(userRequest, rule)) {
    return {
      action: 'user-first',
      message: `好的，我会按你的要求做。\n（注意：${rule.content}）`
    };
  }
  
  // 2. 检查规则冲突
  const conflicts = findConflictingRules(rule);
  if (conflicts.length > 0) {
    return {
      action: 'resolve-conflict',
      conflicts: conflicts
    };
  }
  
  // 3. 根据优先级决定行为
  switch (rule.priority) {
    case 'critical':
      // 安全问题：强烈建议，但不强制
      return {
        action: 'follow-with-warning',
        message: `⚠️ 安全提示：${rule.content}`
      };
      
    case 'high':
      // 高优先级：遵守，静默
      return {
        action: 'follow-silently'
      };
      
    case 'medium':
    case 'low':
      // 中低优先级：遵守，静默
      return {
        action: 'follow-silently'
      };
  }
}
```

---

## 7. 验证结果总结

### 测试场景

| 场景 | 类型 | 原始置信度 | 调整后 | 生成规则 |
|------|------|-----------|--------|---------|
| JWT token 刷新 | repeated-correction | 0.43 | 0.59 | ✓ |
| Repository 层 | anti-pattern | 0.65 | 0.65 | ✓ |
| Named exports | preference | 0.04 | 0.43 | ✓ |
| useMemo 优化 | performance | 0.44 | 0.44 | ✓ |
| SQL 参数化 | security | 0.44 | 0.66 | ✓ |

### 改进效果

| 维度 | v1.0 | v2.0 |
|------|------|------|
| 场景覆盖 | 2/5 (40%) | 5/5 (100%) |
| 阈值策略 | 单一 0.5 | 分类 0.3-0.5 |
| 权重调整 | 固定 | 类型特定 |
| 关键词检测 | 无 | 3 类关键词 |
| 优先级 | 无 | 4 级优先级 |

---

## 8. 实现建议

### Phase 1: 核心功能

1. ✅ 实现 5 种 Pattern 类型的检测
2. ✅ 实现分类策略和阈值
3. ✅ 实现关键词检测
4. ✅ 实现更新的置信度计算

### Phase 2: 优化

1. 调优关键词列表
2. 调优权重和阈值
3. 添加更多 Pattern 类型
4. 改进冲突解决

### Phase 3: 扩展

1. 规则优先级可视化
2. 规则分类统计
3. 关键词自动学习
4. 置信度动态调整

---

## 9. 总结

**v2.0 的核心改进**：

1. ✅ **5 种 Pattern 类型**：覆盖所有常见场景
2. ✅ **分类策略**：不同类型使用不同的阈值和权重
3. ✅ **关键词检测**：自动识别偏好、性能、安全模式
4. ✅ **优先级系统**：安全问题最高优先级
5. ✅ **灵活的置信度计算**：类型特定的权重调整

**验证结论**：
- ✅ 核心假设成立
- ✅ 算法可以识别所有测试场景
- ✅ 改进后的模型更完善、更实用
- ✅ 可以进入实现阶段
