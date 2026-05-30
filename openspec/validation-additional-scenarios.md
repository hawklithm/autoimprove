# 核心假设验证：其他场景分析

## 场景 3：用户偏好（风格修改）

### 会话记录

```typescript
// Turn 1: Claude 生成代码（使用 default export）
// src/components/UserProfile.tsx
export default function UserProfile() {
  return <div>Profile</div>;
}

// Turn 2: 用户修改风格
User: "改成 named export，我们团队不用 default export"

// Turn 2: Claude 修改
export function UserProfile() {
  return <div>Profile</div>;
}

// Turn 3: 用户确认
User: "好的"

// 没有测试失败，只是风格调整
```

### 手动分析

#### 步骤 1: 识别 Pattern 类型

**特征**:
- 代码功能没有变化（语义等价）
- 没有测试失败
- 用户使用了"我们团队"、"习惯"等词汇
- 修改是风格性的，不是功能性的

**判断**: 这是 **Preference（用户偏好）** 类型

#### 步骤 2: 提取 Pattern

```typescript
{
  type: 'preference',
  description: '优先使用 named exports 而非 default exports',
  occurrences: [
    {
      session_id: 'session-003',
      timestamp: '2026-05-30T14:00:00Z',
      user_action: 'accept',  // 不是 explicit_correction，因为没有错误
      test_passed: undefined,  // 没有运行测试
      context: 'src/components/UserProfile.tsx'
    }
  ],
  first_seen: '2026-05-30T14:00:00Z',
  last_seen: '2026-05-30T14:00:00Z',
  confidence: 0
}
```

#### 步骤 3: 计算置信度

```typescript
// 因素 1: 频率得分
occurrences = 1
frequencyScore = min(1 / 10, 1.0) = 0.1

// 因素 2: 时间跨度得分
timeSpanDays = 0（单次会话）
timeSpanScore = 0

// 因素 3: 用户行为得分
explicitCorrections = 0（不是修正，是风格调整）
behaviorScore = 0 / 1 = 0

// 因素 4: 验证结果得分
passedValidations = 0（没有测试）
validationScore = 0

// 加权平均
confidence = 
  0.1 * 0.4 +   // 0.04
  0 * 0.2 +     // 0
  0 * 0.3 +     // 0
  0 * 0.1       // 0
  = 0.04
```

**结论**: 置信度 0.04，**远低于阈值**，不会生成规则。

#### 问题分析

**为什么置信度这么低？**

1. 单次出现
2. 不是"修正"，只是"调整"
3. 没有测试验证

**这合理吗？**

**不太合理**。用户明确表达了团队偏好（"我们团队不用 default export"），这是很强的信号，但我们的算法没有捕获到。

#### 改进方案

**方案 1: 识别偏好关键词**

```typescript
function detectPreferenceKeywords(userInput: string): number {
  const keywords = [
    '我们团队', '团队习惯', '我更喜欢', '我们约定',
    'we prefer', 'our team', 'we use', 'convention'
  ];
  
  const hasKeyword = keywords.some(kw => 
    userInput.toLowerCase().includes(kw)
  );
  
  return hasKeyword ? 0.8 : 0;  // 如果有关键词，直接给高分
}

// 重新计算
preferenceScore = detectPreferenceKeywords("我们团队不用 default export");
// = 0.8

confidence = 
  0.1 * 0.3 +      // 频率权重降低
  0 * 0.1 +        // 时间权重降低
  0.8 * 0.5 +      // 偏好关键词权重（新增）
  0 * 0.1          // 验证权重
  = 0.03 + 0 + 0.4 + 0
  = 0.43
```

仍然低于 0.5，但接近了。

**方案 2: 降低偏好类型的阈值**

```typescript
// 不同类型的模式使用不同的阈值
const thresholds = {
  'repeated-correction': 0.5,  // 需要多次出现
  'anti-pattern': 0.6,         // 需要测试验证
  'preference': 0.3            // 用户明确表达即可
};

if (confidence >= thresholds[pattern.type]) {
  // 生成规则
}
```

使用方案 2，置信度 0.43 > 0.3，**可以生成规则**。

#### 调整后的结果

```typescript
{
  id: 'rule-003',
  content: '优先使用 named exports 而非 default exports',
  reason: '用户明确表示"我们团队不用 default export"',
  scenes: {
    tech: ['react', 'typescript'],
    functional: ['ui'],
    business: []
  },
  source: 'learned',
  confidence: 0.43,
  created_at: '2026-05-30T14:05:00Z',
  updated_at: '2026-05-30T14:05:00Z',
  trigger_count: 0
}
```

---

## 场景 4：性能优化模式

### 会话记录

```typescript
// Turn 1: Claude 生成代码（使用 useEffect 获取数据）
function UserList() {
  const [users, setUsers] = useState([]);
  
  useEffect(() => {
    fetch('/api/users')
      .then(res => res.json())
      .then(data => setUsers(data));
  }, []);
  
  return (
    <div>
      {users.map(user => <UserCard key={user.id} user={user} />)}
    </div>
  );
}

// Turn 2: 用户运行性能分析
$ npm run analyze
Warning: Component re-renders 50 times on data change

// Turn 3: 用户修正
User: "users.map 会导致大量重渲染，用 useMemo 优化一下"

// Turn 3: Claude 修改
function UserList() {
  const [users, setUsers] = useState([]);
  
  useEffect(() => {
    fetch('/api/users')
      .then(res => res.json())
      .then(data => setUsers(data));
  }, []);
  
  const userCards = useMemo(
    () => users.map(user => <UserCard key={user.id} user={user} />),
    [users]
  );
  
  return <div>{userCards}</div>;
}

// Turn 4: 再次分析
$ npm run analyze
✓ Component re-renders optimized

// Turn 5: 用户确认
User: "好多了"
```

### 手动分析

#### 步骤 1: 识别 Pattern 类型

**特征**:
- 有性能问题（不是功能错误）
- 用户主动发现并修正
- 有性能分析工具的验证

**判断**: 这是 **Repeated Correction** 类型（虽然只有一次，但有明确的问题→解决）

#### 步骤 2: 提取 Pattern

```typescript
{
  type: 'repeated-correction',
  description: '列表渲染要用 useMemo 优化，避免不必要的重渲染',
  occurrences: [
    {
      session_id: 'session-004',
      timestamp: '2026-05-30T15:00:00Z',
      user_action: 'explicit_correction',
      test_passed: undefined,  // 不是测试，是性能分析
      performance_improved: true,  // 新字段：性能改善
      context: 'src/components/UserList.tsx'
    }
  ],
  first_seen: '2026-05-30T15:00:00Z',
  last_seen: '2026-05-30T15:00:00Z',
  confidence: 0
}
```

#### 步骤 3: 计算置信度

```typescript
// 因素 1: 频率得分
occurrences = 1
frequencyScore = 0.1

// 因素 2: 时间跨度得分
timeSpanDays = 0
timeSpanScore = 0

// 因素 3: 用户行为得分
explicitCorrections = 1
behaviorScore = 1.0

// 因素 4: 验证结果得分
// 这里没有测试，但有性能改善
performanceImproved = true
validationScore = 1.0  // 性能改善等同于测试通过

// 加权平均
confidence = 
  0.1 * 0.4 +   // 0.04
  0 * 0.2 +     // 0
  1.0 * 0.3 +   // 0.3
  1.0 * 0.1     // 0.1
  = 0.44
```

**结论**: 置信度 0.44，**低于阈值 0.5**，不会生成规则。

#### 问题分析

**为什么置信度不够？**

单次出现，即使有明确的性能改善。

**这合理吗？**

**不太合理**。性能优化通常是一次性的（发现问题→优化→解决），不太可能在多个会话中重复出现相同的性能问题。

#### 改进方案

**方案: 识别性能优化模式**

```typescript
function isPerformanceOptimization(pattern: Pattern): boolean {
  // 检查是否有性能相关的关键词
  const perfKeywords = [
    'useMemo', 'useCallback', 'React.memo',
    '重渲染', '性能', 'optimize', 'performance'
  ];
  
  const hasKeyword = perfKeywords.some(kw =>
    pattern.description.toLowerCase().includes(kw)
  );
  
  // 检查是否有性能改善的证据
  const hasEvidence = pattern.occurrences.some(o =>
    o.performance_improved === true
  );
  
  return hasKeyword && hasEvidence;
}

// 如果是性能优化，降低阈值
if (isPerformanceOptimization(pattern)) {
  min_confidence = 0.4;  // 降低到 0.4
}

// 0.44 > 0.4，可以生成规则
```

#### 调整后的结果

```typescript
{
  id: 'rule-004',
  content: '列表渲染要用 useMemo 优化，避免不必要的重渲染',
  reason: '性能分析显示 users.map 导致 50 次重渲染，使用 useMemo 后优化',
  scenes: {
    tech: ['react'],
    functional: ['ui', 'performance'],
    business: []
  },
  source: 'learned',
  confidence: 0.44,
  created_at: '2026-05-30T15:10:00Z',
  updated_at: '2026-05-30T15:10:00Z',
  trigger_count: 0
}
```

---

## 场景 5：安全相关的修正

### 会话记录

```typescript
// Turn 1: Claude 生成代码（直接拼接 SQL）
function getUserByEmail(email: string) {
  const query = `SELECT * FROM users WHERE email = '${email}'`;
  return db.query(query);
}

// Turn 2: 用户立即修正
User: "不要直接拼接 SQL，这会导致 SQL 注入！用参数化查询"

// Turn 2: Claude 修改
function getUserByEmail(email: string) {
  const query = 'SELECT * FROM users WHERE email = ?';
  return db.query(query, [email]);
}

// Turn 3: 用户确认
User: "对，这样安全"
```

### 手动分析

#### 步骤 1: 识别 Pattern 类型

**特征**:
- 安全漏洞
- 用户立即发现并修正
- 用户明确指出风险（"SQL 注入"）
- 没有测试失败（因为功能正常）

**判断**: 这是 **Anti-Pattern** 类型（安全反模式）

#### 步骤 2: 提取 Pattern

```typescript
{
  type: 'anti-pattern',
  description: '不要直接拼接 SQL，必须使用参数化查询防止 SQL 注入',
  occurrences: [
    {
      session_id: 'session-005',
      timestamp: '2026-05-30T16:00:00Z',
      user_action: 'explicit_correction',
      test_passed: undefined,
      security_issue: 'sql-injection',  // 新字段：安全问题类型
      context: 'src/services/userService.ts:getUserByEmail'
    }
  ],
  first_seen: '2026-05-30T16:00:00Z',
  last_seen: '2026-05-30T16:00:00Z',
  confidence: 0
}
```

#### 步骤 3: 计算置信度

```typescript
// 因素 1: 频率得分
occurrences = 1
frequencyScore = 0.1

// 因素 2: 时间跨度得分
timeSpanDays = 0
timeSpanScore = 0

// 因素 3: 用户行为得分
explicitCorrections = 1
behaviorScore = 1.0

// 因素 4: 验证结果得分
// 没有测试，但有安全问题修复
securityIssueFixed = true
validationScore = 1.0  // 安全修复等同于测试通过

// 加权平均
confidence = 
  0.1 * 0.4 +   // 0.04
  0 * 0.2 +     // 0
  1.0 * 0.3 +   // 0.3
  1.0 * 0.1     // 0.1
  = 0.44
```

**结论**: 置信度 0.44，**低于阈值 0.5**。

#### 问题分析

**为什么置信度不够？**

单次出现，即使是严重的安全问题。

**这合理吗？**

**非常不合理**！安全问题应该是最高优先级，即使只出现一次也应该生成规则。

#### 改进方案

**方案: 识别安全相关的模式**

```typescript
function isSecurityIssue(pattern: Pattern): boolean {
  // 检查安全关键词
  const securityKeywords = [
    'sql injection', 'xss', 'csrf', 'injection',
    '注入', '安全', 'security', 'vulnerability',
    'sanitize', 'escape', 'validate'
  ];
  
  const hasKeyword = securityKeywords.some(kw =>
    pattern.description.toLowerCase().includes(kw) ||
    pattern.occurrences.some(o => 
      o.user_input?.toLowerCase().includes(kw)
    )
  );
  
  // 检查是否有安全问题标记
  const hasSecurityFlag = pattern.occurrences.some(o =>
    o.security_issue !== undefined
  );
  
  return hasKeyword || hasSecurityFlag;
}

// 如果是安全问题，大幅降低阈值
if (isSecurityIssue(pattern)) {
  min_confidence = 0.3;  // 降低到 0.3
  
  // 并且提高置信度（安全问题加权）
  confidence = confidence * 1.5;  // 0.44 * 1.5 = 0.66
}

// 0.66 > 0.3，可以生成规则
```

#### 调整后的结果

```typescript
{
  id: 'rule-005',
  content: '不要直接拼接 SQL，必须使用参数化查询防止 SQL 注入',
  reason: '用户指出直接拼接 SQL 会导致 SQL 注入漏洞',
  scenes: {
    tech: ['node', 'sql'],
    functional: ['api', 'database', 'security'],
    business: []
  },
  source: 'learned',
  confidence: 0.66,  // 安全问题加权后
  created_at: '2026-05-30T16:05:00Z',
  updated_at: '2026-05-30T16:05:00Z',
  trigger_count: 0,
  priority: 'high'  // 新字段：安全问题标记为高优先级
}
```

---

## 综合分析

### 验证结果总结

| 场景 | Pattern 类型 | 原始置信度 | 调整后置信度 | 是否生成规则 | 需要的改进 |
|------|-------------|-----------|-------------|-------------|-----------|
| JWT token 刷新 | 重复修正 | 0.43 → 0.59 | 0.59 | ✓（跨会话） | 需要多次出现 |
| Repository 层 | 反模式 | 0.65 | 0.65 | ✓ | 测试验证有效 |
| Named exports | 用户偏好 | 0.04 → 0.43 | 0.43 | ✓（降低阈值） | 识别偏好关键词 |
| useMemo 优化 | 性能优化 | 0.44 | 0.44 | ✓（降低阈值） | 识别性能模式 |
| SQL 参数化 | 安全反模式 | 0.44 → 0.66 | 0.66 | ✓（安全加权） | 识别安全问题 |

### 关键发现

#### 1. 不同类型的模式需要不同的处理策略

```typescript
const strategies = {
  'repeated-correction': {
    min_confidence: 0.5,
    requires_multiple_occurrences: true,
    weight_adjustment: 1.0
  },
  
  'anti-pattern': {
    min_confidence: 0.5,
    requires_test_validation: true,
    weight_adjustment: 1.0
  },
  
  'preference': {
    min_confidence: 0.3,  // 降低阈值
    detect_keywords: ['我们团队', '习惯', 'prefer'],
    weight_adjustment: 1.0
  },
  
  'performance': {
    min_confidence: 0.4,  // 降低阈值
    detect_keywords: ['useMemo', 'useCallback', '性能'],
    requires_performance_evidence: true,
    weight_adjustment: 1.0
  },
  
  'security': {
    min_confidence: 0.3,  // 最低阈值
    detect_keywords: ['injection', 'xss', 'csrf', '安全'],
    weight_adjustment: 1.5,  // 提高权重
    priority: 'high'
  }
};
```

#### 2. 需要扩展 Pattern 数据结构

```typescript
interface Pattern {
  type: 'repeated-correction' | 'anti-pattern' | 'preference' | 'performance' | 'security';
  description: string;
  occurrences: PatternOccurrence[];
  first_seen: string;
  last_seen: string;
  confidence: number;
  
  // 新增字段
  category?: 'functional' | 'style' | 'performance' | 'security';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  keywords?: string[];  // 检测到的关键词
}

interface PatternOccurrence {
  session_id: string;
  timestamp: string;
  user_action: 'explicit_correction' | 'amend' | 'undo' | 'accept';
  context: string;
  
  // 扩展字段
  test_passed?: boolean;
  performance_improved?: boolean;
  security_issue?: string;  // 'sql-injection', 'xss', 'csrf', etc.
  user_input?: string;  // 保存用户的原始输入，用于关键词检测
}
```

#### 3. 置信度计算需要更灵活

```typescript
function calculateConfidence(pattern: Pattern): number {
  // 基础置信度
  let confidence = 
    frequencyScore * 0.3 +
    timeSpanScore * 0.1 +
    behaviorScore * 0.4 +
    validationScore * 0.2;
  
  // 根据类型调整
  const strategy = strategies[pattern.type];
  
  // 关键词加成
  if (strategy.detect_keywords) {
    const hasKeyword = detectKeywords(pattern, strategy.detect_keywords);
    if (hasKeyword) {
      confidence += 0.2;  // 关键词加成
    }
  }
  
  // 权重调整
  confidence *= strategy.weight_adjustment;
  
  // 上限 1.0
  return Math.min(confidence, 1.0);
}
```

---

## 最终结论

### ✅ 所有场景都可以处理

通过适当的调整，我们的算法可以识别：
1. ✓ 重复修正模式（需要跨会话）
2. ✓ 反模式（测试验证）
3. ✓ 用户偏好（关键词检测 + 降低阈值）
4. ✓ 性能优化（性能证据 + 降低阈值）
5. ✓ 安全问题（安全加权 + 最低阈值）

### 🔧 需要的改进

1. **分类策略**：不同类型的模式使用不同的阈值和权重
2. **关键词检测**：识别偏好、性能、安全相关的关键词
3. **数据结构扩展**：添加 category、priority、keywords 等字段
4. **置信度公式**：更灵活的计算方式，支持类型特定的调整

### 📊 改进后的效果

| 改进前 | 改进后 |
|--------|--------|
| 只能识别 2/5 场景 | 可以识别 5/5 场景 |
| 单一阈值 0.5 | 分类阈值 0.3-0.5 |
| 固定权重 | 类型特定权重 |
| 无优先级 | 安全问题高优先级 |

---

## 下一步建议

现在我们已经验证了多种场景，可以：

**A. 更新设计文档**
- 将这些发现整合到概念模型中
- 更新置信度计算公式
- 添加分类策略

**B. 实现最小原型**
- 基于改进后的算法实现原型
- 用真实数据测试

**C. 创建实现提案**
- 退出 explore 模式
- 使用 `/opsx:propose` 开始实现

我建议选择 **A（更新设计文档）**，把这些重要的发现记录下来，然后再进入实现阶段。
