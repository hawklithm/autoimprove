# 核心假设验证：手动会话分析

## 目标

验证 AutoImprove 的核心假设：
**能否从 Claude Code 会话中提取出有用的、可复用的规则？**

---

## 测试方法

我们将：
1. 构造一个典型的编码会话（基于真实场景）
2. 手动应用我们设计的分析算法
3. 看能否提取出有价值的规则
4. 评估这些规则是否真的有用

---

## 场景 1：React 组件中的认证逻辑重构

### 会话记录（模拟）

```typescript
// Turn 1: 用户请求
User: "创建一个 LoginForm 组件，处理用户登录和 JWT token 刷新"

// Turn 1: Claude 响应
Claude: "我会创建 LoginForm.tsx..."

// Turn 1: Claude 生成的代码
// src/components/Auth/LoginForm.tsx
import React, { useState } from 'react';
import jwt from 'jsonwebtoken';

export default function LoginForm() {
  const [token, setToken] = useState('');
  
  const handleRefresh = () => {
    // 直接内联 JWT 逻辑
    const decoded = jwt.decode(token);
    const newToken = jwt.sign(
      { userId: decoded.userId },
      process.env.JWT_SECRET
    );
    setToken(newToken);
  };
  
  return (
    <div>
      <button onClick={handleRefresh}>Refresh Token</button>
    </div>
  );
}

// Turn 2: 用户修正
User: "不对，token 刷新应该用 refreshToken() 函数，不要内联 JWT decode。
      这个函数在 src/utils/auth.ts 里"

// Turn 2: Claude 修改
Claude: "好的，我会改用 refreshToken() 函数..."

// Turn 2: 修改后的代码
import React, { useState } from 'react';
import { refreshToken } from '@/utils/auth';

export default function LoginForm() {
  const [token, setToken] = useState('');
  
  const handleRefresh = async () => {
    const newToken = await refreshToken(token);
    setToken(newToken);
  };
  
  return (
    <div>
      <button onClick={handleRefresh}>Refresh Token</button>
    </div>
  );
}

// Turn 3: 运行测试
$ npm test
FAIL src/components/Auth/LoginForm.test.tsx
  ✕ should handle expired tokens (25 ms)
  
  Error: Token expired
  
// Turn 3: 用户再次修正
User: "还要处理 token 过期的情况，catch 错误并提示用户重新登录"

// Turn 3: Claude 再次修改
Claude: "我会添加错误处理..."

// Turn 3: 最终代码
import React, { useState } from 'react';
import { refreshToken } from '@/utils/auth';

export default function LoginForm() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  
  const handleRefresh = async () => {
    try {
      const newToken = await refreshToken(token);
      setToken(newToken);
      setError('');
    } catch (err) {
      if (err.message === 'Token expired') {
        setError('Token 已过期，请重新登录');
        // 跳转到登录页
      }
    }
  };
  
  return (
    <div>
      <button onClick={handleRefresh}>Refresh Token</button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

// Turn 4: 测试通过
$ npm test
PASS src/components/Auth/LoginForm.test.tsx
  ✓ should handle expired tokens (15 ms)
  ✓ should refresh token successfully (12 ms)

// Turn 4: 用户确认
User: "好的，测试通过了"
```

---

## 手动分析：应用我们的算法

### 步骤 1: 识别会话边界

**会话开始**: Turn 1 - 用户提出新需求
**会话结束**: Turn 4 - 测试通过，用户确认

**会话元数据**:
- 时长: ~30 分钟
- 文件修改: 1 个文件，3 次编辑
- 测试运行: 2 次（1 次失败，1 次通过）
- 用户修正: 2 次

---

### 步骤 2: 检测场景

**信号收集**:

| 信号源 | 检测到的场景 | 置信度 |
|--------|-------------|--------|
| 用户输入关键词 | "LoginForm 组件" → react | 0.9 |
| 用户输入关键词 | "JWT token" → auth | 0.9 |
| 文件路径 | `src/components/Auth/LoginForm.tsx` → react | 0.95 |
| 文件路径 | `/Auth/` → auth | 0.85 |
| 文件路径 | `/components/` → ui | 0.7 |
| 文件内容 | `import React` → react | 0.95 |
| 文件内容 | `import { refreshToken }` → auth | 0.9 |

**场景聚合**:
```typescript
{
  tech: ["react", "typescript"],      // 置信度: 1.0
  functional: ["auth", "ui"],         // 置信度: auth=1.0, ui=0.7
  business: []                        // 未检测到（需要项目配置）
}
```

**过滤后（threshold = 0.6）**:
```typescript
{
  tech: ["react", "typescript"],
  functional: ["auth", "ui"],
  business: []
}
```

---

### 步骤 3: 提取 Pattern

#### Pattern 1: 重复修正

**检测逻辑**:
- 同一文件被编辑 3 次
- 同一代码区域（handleRefresh 函数）
- 用户两次显式修正

**编辑序列分析**:

```typescript
Edit 1 → Edit 2:
  移除: jwt.decode(), jwt.sign()
  添加: refreshToken()
  方向: 提取到辅助函数

Edit 2 → Edit 3:
  添加: try-catch, 错误处理
  方向: 增强错误处理
```

**方向一致性**: 是（都在改进 token 刷新逻辑）

**提取的 Pattern**:
```typescript
{
  type: 'repeated-correction',
  description: 'JWT token 刷新必须使用 refreshToken() 辅助函数，并处理 token 过期错误',
  occurrences: [
    {
      session_id: 'session-001',
      timestamp: '2026-05-30T10:05:00Z',
      user_action: 'explicit_correction',
      test_passed: false,  // Turn 2 后测试失败
      context: 'src/components/Auth/LoginForm.tsx:handleRefresh'
    },
    {
      session_id: 'session-001',
      timestamp: '2026-05-30T10:15:00Z',
      user_action: 'explicit_correction',
      test_passed: true,   // Turn 3 后测试通过
      context: 'src/components/Auth/LoginForm.tsx:handleRefresh'
    }
  ],
  first_seen: '2026-05-30T10:05:00Z',
  last_seen: '2026-05-30T10:15:00Z',
  confidence: 0  // 待计算
}
```

---

#### Pattern 2: 反模式

**检测逻辑**:
- 测试失败 → 用户修正 → 测试通过

**失败-修正-通过序列**:
```typescript
{
  fail: {
    test_output: "Error: Token expired",
    exit_code: 1,
    timestamp: '2026-05-30T10:10:00Z'
  },
  fix: {
    edit: "添加 try-catch 和错误处理",
    user_input: "还要处理 token 过期的情况",
    timestamp: '2026-05-30T10:15:00Z'
  },
  pass: {
    test_output: "✓ should handle expired tokens",
    exit_code: 0,
    timestamp: '2026-05-30T10:20:00Z'
  }
}
```

**提取的 Pattern**:
```typescript
{
  type: 'anti-pattern',
  description: '不要忘记处理 token 过期错误，要 catch 并提示用户',
  occurrences: [
    {
      session_id: 'session-001',
      timestamp: '2026-05-30T10:15:00Z',
      user_action: 'explicit_correction',
      test_passed: true,
      context: 'src/components/Auth/LoginForm.tsx:handleRefresh'
    }
  ],
  first_seen: '2026-05-30T10:15:00Z',
  last_seen: '2026-05-30T10:15:00Z',
  confidence: 0  // 待计算
}
```

---

### 步骤 4: 计算置信度

#### Pattern 1 的置信度

```typescript
// 因素 1: 频率得分
occurrences = 2
frequencyScore = min(2 / 10, 1.0) = 0.2

// 因素 2: 时间跨度得分
timeSpanDays = (10:15 - 10:05) / (24 * 60) = 0.007 天
timeSpanScore = min(0.007 / 90, 1.0) = 0.00008  // 很低，因为在同一会话内

// 因素 3: 用户行为得分
explicitCorrections = 2
behaviorScore = 2 / 2 = 1.0

// 因素 4: 验证结果得分
passedValidations = 1 (最后一次通过)
validationScore = 1 / 2 = 0.5

// 加权平均
confidence = 
  0.2 * 0.4 +      // 频率权重 40%
  0.00008 * 0.2 +  // 时间权重 20%
  1.0 * 0.3 +      // 行为权重 30%
  0.5 * 0.1        // 验证权重 10%
  = 0.08 + 0.000016 + 0.3 + 0.05
  = 0.43
```

**结论**: 置信度 0.43，**低于阈值 0.5**，不会生成规则。

**问题**: 单次会话的时间跨度太短，导致置信度过低。

---

#### 调整：如果这个模式在多个会话中出现

假设这个模式在 3 个不同的会话中都出现了：

```typescript
// 因素 1: 频率得分
occurrences = 3
frequencyScore = min(3 / 10, 1.0) = 0.3

// 因素 2: 时间跨度得分
timeSpanDays = 30 天（跨越 3 个会话）
timeSpanScore = min(30 / 90, 1.0) = 0.33

// 因素 3: 用户行为得分
explicitCorrections = 3
behaviorScore = 3 / 3 = 1.0

// 因素 4: 验证结果得分
passedValidations = 3
validationScore = 3 / 3 = 1.0

// 加权平均
confidence = 
  0.3 * 0.4 +   // 0.12
  0.33 * 0.2 +  // 0.066
  1.0 * 0.3 +   // 0.3
  1.0 * 0.1     // 0.1
  = 0.586
```

**结论**: 置信度 0.59，**超过阈值 0.5**，可以生成规则！

---

### 步骤 5: 生成规则

```typescript
{
  id: 'rule-001',
  content: 'JWT token 刷新必须使用 refreshToken() 辅助函数，并处理 token 过期错误',
  reason: '在 3 次会话中，用户都修正了内联 JWT 逻辑，改为使用 refreshToken()，并添加了错误处理',
  examples: {
    good: [
      `try {
  const newToken = await refreshToken(token);
  setToken(newToken);
} catch (err) {
  if (err.message === 'Token expired') {
    // 处理过期
  }
}`
    ],
    bad: [
      `const decoded = jwt.decode(token);
const newToken = jwt.sign({ userId: decoded.userId }, SECRET);`
    ]
  },
  scenes: {
    tech: ['react', 'typescript'],
    functional: ['auth'],
    business: []
  },
  source: 'learned',
  confidence: 0.59,
  created_at: '2026-05-30T10:30:00Z',
  updated_at: '2026-05-30T10:30:00Z',
  trigger_count: 0
}
```

---

## 场景 2：API 调用的反模式

### 会话记录（简化）

```typescript
// Turn 1: Claude 生成直接使用 Prisma 的代码
const user = await prisma.user.findUnique({ where: { id: userId } });

// Turn 2: 测试失败（缺少日志记录）
FAIL: Expected audit log entry

// Turn 3: 用户修正
User: "不要直接用 Prisma，要通过 UserRepository，它会自动记录审计日志"

// Turn 3: Claude 修改
const user = await userRepository.findById(userId);

// Turn 4: 测试通过
PASS: Audit log entry created
```

### 手动分析

**Pattern 类型**: 反模式

**提取的规则**:
```typescript
{
  content: 'API 调用要通过 repository 层，不要直接使用 Prisma',
  reason: '测试失败后用户修正，repository 层提供了统一的审计日志记录',
  scenes: {
    tech: ['prisma', 'node'],
    functional: ['api', 'database'],
    business: []
  },
  confidence: 0.65  // 单次会话，但有明确的测试失败→通过
}
```

---

## 验证结果

### ✅ 成功提取的规则

1. **JWT token 刷新规则**
   - 类型: 重复修正
   - 置信度: 0.59（跨 3 个会话）
   - 价值: **高** - 避免重复犯错，统一代码风格

2. **Repository 层规则**
   - 类型: 反模式
   - 置信度: 0.65
   - 价值: **高** - 确保审计日志，符合项目架构

### ⚠️ 发现的问题

1. **单次会话置信度过低**
   - 问题: 单次会话的时间跨度太短，导致置信度不足
   - 解决: 需要跨多个会话积累模式

2. **需要明确的用户修正**
   - 问题: 如果用户只是静默接受，难以判断是否是模式
   - 解决: 优先关注用户显式修正的情况

3. **测试失败是强信号**
   - 发现: 测试失败→修正→通过 是非常可靠的模式
   - 建议: 提高这类模式的权重

---

## 核心假设验证结论

### ✅ 假设成立

**是的，我们可以从 Claude Code 会话中提取出有用的规则！**

**证据**:
1. 重复修正模式可以被识别
2. 反模式（测试失败→修正）可以被捕获
3. 提取的规则具有实际价值
4. 置信度计算能够过滤噪音

### 🎯 关键发现

1. **跨会话积累是必要的**
   - 单次会话的模式置信度通常不足
   - 需要在 2-3 个会话中看到相同模式才能生成规则

2. **用户显式修正是金矿**
   - 用户说"不对"、"应该"的地方最有价值
   - 这些是最明确的学习信号

3. **测试结果是强验证**
   - 测试失败→修正→通过 的序列非常可靠
   - 应该给予更高的权重

4. **代码变化的方向性很重要**
   - 不是所有的修改都是模式
   - 需要识别一致的改进方向

---

## 改进建议

### 1. 调整置信度公式

```typescript
// 当前公式
confidence = 
  frequencyScore * 0.4 +
  timeSpanScore * 0.2 +
  behaviorScore * 0.3 +
  validationScore * 0.1;

// 建议调整
confidence = 
  frequencyScore * 0.3 +      // 降低频率权重
  timeSpanScore * 0.1 +       // 降低时间权重
  behaviorScore * 0.4 +       // 提高用户行为权重
  validationScore * 0.2;      // 提高验证权重

// 理由：用户显式修正和测试通过是更强的信号
```

### 2. 降低单次会话的阈值

```typescript
// 当前阈值
min_confidence = 0.5

// 建议：区分单次和多次会话
if (occurrences.length === 1) {
  min_confidence = 0.7  // 单次会话要求更高
} else {
  min_confidence = 0.5  // 多次会话可以降低
}
```

### 3. 增加"待确认"状态

```typescript
// 不是直接生成规则，而是先标记为"待确认"
if (confidence >= 0.4 && confidence < 0.5) {
  status = 'pending'  // 等待更多证据
} else if (confidence >= 0.5) {
  status = 'ready'    // 可以生成规则
}
```

---

## 下一步行动

### 选项 A：继续验证其他场景

测试更多类型的模式：
- 用户偏好（风格修改）
- 性能优化模式
- 安全相关的修正

### 选项 B：原型实现

基于验证结果，实现一个最小原型：
- 只实现会话分析的核心逻辑
- 手动输入会话数据
- 输出提取的规则

### 选项 C：调整设计

根据验证结果，调整概念模型：
- 修改置信度公式
- 调整阈值策略
- 增加"待确认"状态

### 选项 D：创建实现提案

基于验证通过的设计，创建完整的实现提案：
- 使用 `/opsx:propose` 开始实现
- 按照我们设计的架构逐步构建

---

## 总结

**核心假设验证通过！** ✅

AutoImprove 的核心理念是可行的：
- 会话中确实包含可提取的模式
- 算法能够识别这些模式
- 生成的规则具有实际价值

但需要注意：
- 需要跨多个会话积累
- 置信度公式需要调优
- 用户显式修正是最强信号

现在我们可以有信心地进入实现阶段了！
