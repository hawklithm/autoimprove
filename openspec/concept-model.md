# AutoImprove 概念模型（最终版）

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
- 例子：`auth`, `api`, `database`, `ui`, `testing`, `performance`
- 检测：关键词、文件路径、代码模式

**业务域（Business Domain）**
- 定义：项目特定的业务模块
- 特点：项目特定，需要配置
- 例子：`user-management`, `billing`, `analytics`, `notification`
- 检测：混合方案（推断 + 配置）

### 场景示例

```typescript
// 例子 1：修复 React 组件中的 JWT 认证
{
  tech: ["react", "typescript"],
  functional: ["auth", "ui"],
  business: ["user-management"]
}

// 例子 2：优化 Prisma 查询性能
{
  tech: ["prisma", "postgresql"],
  functional: ["database", "performance"],
  business: ["analytics"]
}

// 例子 3：创建支付 API endpoint
{
  tech: ["node", "express"],
  functional: ["api"],
  business: ["billing"]
}
```

### 场景检测策略

**优先级（从高到低）**：
1. 用户显式指定（`/autoimprove-summarize react,auth`）
2. 用户输入关键词
3. 修改的文件路径
4. 文件内容分析
5. Git 历史
6. 项目配置

**置信度阈值**：0.6
- 低于 0.6：不包含
- 0.6-0.8：包含，但权重较低
- 0.8+：包含，高权重

**信号加权**：
```typescript
const weights = {
  explicit: 1.0,   // 用户显式指定
  keyword: 0.9,    // 用户输入关键词
  content: 0.8,    // 文件内容
  filepath: 0.7,   // 文件路径
  git: 0.6,        // Git 历史
  config: 0.8      // 项目配置
};
```

---

## 2. Rule（规则）- 简化模型（已更新）

### 数据结构

```typescript
interface Rule {
  // 标识
  id: string;                    // 唯一标识
  
  // 内容
  content: string;               // 规则内容（简洁）
  reason: string;                // 为什么有这条规则
  examples?: {                   // 可选：示例
    good?: string[];             // 正例
    bad?: string[];              // 反例
  };
  
  // 场景（三维）
  scenes: {
    tech?: string[];
    functional?: string[];
    business?: string[];
  };
  
  // 元数据
  source: 'learned' | 'manual';  // 来源
  confidence: number;            // 置信度（0-1，仅 learned）
  
  // 生命周期
  created_at: string;            // 创建时间
  updated_at: string;            // 更新时间
  last_triggered_at?: string;    // 最后触发时间
  trigger_count: number;         // 触发次数
}
```

### 规则示例

```yaml
# 例子 1：学到的规则
id: rule-001
content: "JWT token 刷新必须使用 refreshToken() 辅助函数，不要内联 JWT decode"
reason: "3 次会话中用户都把内联的 JWT decode 改成了 refreshToken() 调用"
examples:
  good:
    - "const newToken = await refreshToken(oldToken);"
  bad:
    - "const decoded = jwt.decode(token); const newToken = jwt.sign(...);"
scenes:
  tech: ["node", "typescript"]
  fu"auth", "api"]
  business: ["user-management"]
source: learned
confidence: 0.92
created_at: "2026-05-20T10:30:00Z"
updated_at: "2026-05-25T14:20:00Z"
last_triggered_at: "2026-05-28T09:15:00Z"
trigger_count: 5

---

# 例子 2：手写的规则
id: rule-002
content: "组件不超过 200 行，超过则拆分"
reason: "团队约定，保持组件可维护性"
scenes:
  tech: ["react"]
  functional: ["ui"]
source: manual
confidence: 1.0
created_at: "2026-05-01T00:00:00Z"
updated_at: "2026-05-01T00:00:00Z"
trigger_count: 0
```

### 规则处理策略

**核心原则**：优先遵守规则，但用户明确要求时可以违反

**具体行为**：

1. **默认遵守规则**（静默）
   ```
   用户："创建一个新组件"
   Claude：[遵守所有相关规则，不说明]
  ``

2. **用户明确要求时，用户优先**（提醒）
   ```
   用户："直接用 Prisma，不要用 repository"
   Claude："好的，我会直接使用 Prisma。
           （注意：项目规范建议通过 repository 层访问数据库）"
   ```

3. **规则冲突时，智能选择**（说明）
   ```
   规则 1（旧）："使用 default exports"
   规则 2（新）："使用 named exports"
   
   Claude："我会使用 named exports（根据最近的项目规范）。
           
           我发现一条旧规则建议使用 default exports，
           可能已经过时了。要我删除旧规则吗？"
   ```

4. **规则不确定时，询问**
   ```
   规则："测试要和源文件一起"
   用户："创建 UserService"（没说要不要测试）
   
   Claude："我会创建 UserService.ts。
           项目规范建议同时创建测试，要我创建吗？"
   ```

**冲突解决优先级**：
```typescript
function resolveConflict(rules: Rule[]): Rule {
  // 1. 手写规则优先于学到的规则
  const manualRules = rules.filter(r => r.source === 'manual');
  if (manualRules.length > 0) return selectBest(manualRules);
  
  // 2. 置信度更高的优先
  const byConfidence = rules.sort((a, b) => b.confidence - a.confidence);
  
  // 3. 更新的优先
  const byRecency = byConfidence.filter(r => 
    r.confidence >= byConfidence[0].confidence - 0.1
  ).sort((a, b) => 
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  
  // 4. 更常用的优先
  return byRecency.sort((a, b) => b.trigger_count - a.trigger_count)[0];
}
```

---

## 3. Pattern（模式）- 临时概念

### 定义

Pattern 是从 Session 中观察到的现象，是生成 Rule 的中间产物。

**重要**：Pattern 不持久化，只在分析过程中存在。

### 数据结构

```typescript
interface Pattern {
  // 模式内容
 epeated-correction' | 'anti-pattern' | 'preference';
  description: string;
  
  // 证据
  occurrences: PatternOccurrence[];
  
  // 时间跨度
  first_seen: string;
  last_seen: string;
  
  // 置信度（临时计算）
  confidence: number;
}

interface PatternOccurrence {
  session_id: string;
  timestamp: string;
  user_action: 'explicit_correction' | 'amend' | 'undo' | 'accept';
  test_passed?: boolean;
  context: string;  // 简短的上下文描述
}
```

### Pattern → Rule 转换

```typescript
async function generateRuleFromPattern(pattern: Pattern): Promise<Rule> {
  // 1. 提炼规则内容（去除具体细节，保留通用原则）
  const contetGeneralPrinciple(pattern.description);
  
  // 2. 生成原因说明
  const reason = `在 ${pattern.occurrences.length} 次会话中观察到此模式`;
  
  // 3. 提取场景
  const scenes = extractScenes(pattern.occurrences);
  
  // 4. 计算置信度
  const confidence = calculateConfidence(pattern);
  
  return {
    id: generateId(),
    content,
    reason,
    scenes,
    source: 'learned',
    confidence,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    trigger_count: 0
  };
}
```

---

## 4. Session（会话）- 任务级

### 定义

Session 是一个完整的工作任务，从用户提出需求到任务完成。

### 边界判断

**任务开始**：
- 用户提出新的需求
- 与上一个任务明显不同

**任务结束**（满足任一条件）：
- 用户明确表示完成（"done", "完成了", "好的"）
- 测试/构建通过，且用户没有进一步修改
- 用户开始一个完全不同的话题
- 时间间隔超过 30 分钟

### 数据结构

```typescript
interface Session {
  // 标识
  id: string;
  timestamp: string;
  
  // 场景（自动检测或用户指定）
  scenes: Scene;
  
  // 对话内容（多轮）
  turns: ConversationTurn[];
  
  // 操作记录
  tool_calls: ToolCall[];
  edits: FileEdit[];
  
  // 验证结果
  validation: {
    test_exit_code?: number;
    lint_exit_code?: number;
    build_exit_code?: number;
    final_user_action: 'accept' | 'amend' | 'undo' | 'manual_fix' | 'abandoned';
  };
  
  // 元数据
  metadata: {
    cwd: string;
    git_remote?: string;
    branch?: string;
    claude_version: string;
  };
}

interface ConversationTurn {
  user_input: string;
  assistant_output: string;
  timestamp: string;
}
```

---

## 5. Confidence（置信度）- 多因素计算

### 计算公式

```typescript
function calculateConfidence(pattern: Pattern): number {
  // 因素 1：频率得分（出现次数，上限 10 次）
  const frequencyScore = Math.min(pattern.occurrences.length / 10, 1.0);
  
  // 因素 2：时间跨度得分（跨越的天数，上限 90 天）
  const timeSpanDays = daysBetween(pattern.first_seen, pattern.last_seen);
  const timeSpanScore = Math.min(timeSpanDays / 90, 1.0);
  
  // 因素 3：用户行为得分
  const explicitCorrections = pattern.occurrences.filter(
    o => o.user_action === 'explicit_correction'
  ).length;
  const behaviorScore = explicitCorrections / pattern.occurrences.length;
  
  // 因素 4：验证结果得分
  const passedValidations = pattern.occurrences.filter(
    o => o.test_passed === true
  ).length;
  const validationScore = passedValidations / pattern.occurrences.length;
  
  // 加权平均
  const confidence = 
    frequencyScore * 0.4 +      // 频率最重要
    timeSpanScore * 0.2 +       // 时间分布
    behaviorScore * 0.3 +       // 用户行为
    validationScore * 0.1;      // 验证结果
  
  return confidence;
}
```

### 置信度阈值

| 置信度 | 行为 |
|--------|------|
| >= 0.9 | 高置信度，可以考虑自动应用（未来功能） |
| >= 0.7 | 中等置信度，生成规则，需要用户确认 |
| >= 0.5 | 低置信度，作为建议，不生成规则 |
| < 0.5  | 忽略，可能是噪音 |

### 置信度衰减

规则的置信度会随时间衰减：

```typescript
function decayConfidence(rule: Rule): number {
  if (rule.source === 'manual') {
    return rule.confidence;  // 手写规则不衰减
  }
  
  const daysSinceLastTrigger = daysBetween(
    rule.last_triggered_at || rule.created_at,
    new Date().toISOString()
  );
  
  // 90 天未触发，置信度降低 50%
  const decayFactor = Math.max(0.5, 1 - (daysSinceLastTrigger / 180));
  
  return rule.confidence * decayFactor;
}
```

---

## 6. 规则生命周期

```
┌─────────────────────────────────────────────┐
│           规则生命周期                       │
├─────────────────────────────────────────────┤
│                                             │
│  创建 (Created)                             │
│  ├─ 从 Pattern 生成                         │
│  ├─ 用户手写                                │
│  └─ 需要用户确认（learned 规则）             │
│       ↓                                     │
│  激活 (Active)                              │
│  ├─ 被加载到会话上下文                       │
│  ├─ 影响 Claude 的行为                      │
│  └─ 记录触发次数和时间                       │
│       ↓                                     │
│  更新 (Updated)                             │
│  ├─ 新的 Pattern 强化规则 → 提高 confidence │
│  ├─ 规则内容修正                            │
│  └─ 场景调整                                │
│       ↓                                     │
│  衰减 (Decaying)                            │
│  ├─ 长期未触发 → confidence 降低             │
│  ├─ 提示用户："这条规则可能已过时"            │
│  └─ 用户可以选择保留或删除                   │
│       ↓                                     │
│  归档/删除 (Archived/Deleted)                │
│  ├─ 用户主动删除                            │
│  ├─ confidence < 0.3 自动归档               │
│  └─ 归档的规则可以恢复                       │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 7. 存储结构（方案 C）

### 目录结构

```
~/.autoimprove/
├── config.json                 # 全局配置
├── rules/
│   ├── index.json             # 规则索引（快速加载）
│   └── content/               # 规则详细内容
│       ├── rule-001.md
│       ├── rule-002.md
│       └── ...
├── lessons/                   # 场景化知识库（可选）
│   ├── react/
│   │   └── latest.md
│   └── auth/
│       └── latest.md
├── sessions/                  # 会话存档
│   ├── 2026-05-30-abc.json
│   └── 2026-05-29-def.json
└── cache/                     # 临时缓存
    └── scene-detection/       # 场景检测缓存
```

### 规则索引（index.json）

```json
{
  "version": "0.1.0",
  "rules": [
    {
      "id": "rule-001",
      "content": "JWT token 刷新必须使用 refreshToken() 辅助函数",
      "scenes": {
        "tech": ["node", "typescript"],
        "functional": ["auth", "api"],
        "business": ["user-management"]
      },
      "source": "learned",
      "confidence": 0.92,
      "created_at": "2026-05-20T10:30:00Z",
      "updated_at": "2026-05-25T14:20:00Z",
      "last_triggered_at": "2026-05-28T09:15:00Z",
      "trigger_count": 5,
      "content_file": "content/rule-001.md"
    },
    {
      "id": "rule-002",
      "content": "组件不超过 200 行，超过则拆分",
      "scenes": {
        "tech": ["react"],
        "functional": ["ui"]
      },
      "source": "manual",
      "confidence": 1.0,
      "created_at": "2026-05-01T00:00:00Z",
      "updated_at": "2026-05-01T00:00:00Z",
      "trigger_count": 0,
      "content_file": "content/rule-002.md"
    }
  ]
}
```

### 规则内容文件（rule-001.md）

```markdown
---
id: rule-001
created_at: 2026-05-20T10:30:00Z
updated_at: 2026-05-25T14:20:00Z
---

# JWT Token 刷新规则

## 规则内容

JWT token 刷新必须使用 `refreshToken()` 辅助函数，不要内联 JWT decode。

## 原因

在 3 次会话中，用户都把内联的 JWT decode 改成了 `refreshToken()` 调用。
这表明项目有统一的 token 刷新逻辑，应该复用而不是重复实现。

## 正例

```typescript
// ✓ 好的做法
const newToken = await refreshToken(oldToken);
```

## 反例

```typescript
// ✗ 避免这样做
const decoded = jwt.decode(token);
const newToken = jwt.sign({
  userId: decoded.userId,
  // ... 重复的逻辑
}, SECRET);
```

## 相关会话

- 2026-05-20: session-abc (用户修正了 3 次)
- 2026-05-23: session-def (用户修正了 2 次)
- 2026-05-25: session-ghi (用户修正了 1 次)

## 触发历史

- 2026-05-28 09:15: 在创建新的 API endpoint 时应用
- 2026-05-27 14:30: 在重构 auth 逻辑时应用
- ...
```

---

## 8. 概念关系图

```
┌─────────────────────────────────────────────────────────┐
│                   AutoImprove 概念模型                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  User (用户)                                            │
│    ↓ 发起                                               │
│  Session (会话) [任务级]                                │
│    ├─ 多轮对话                                          │
│    ├─ 工具调用                                          │
│    ├─ 文件修改                                          │
│    └─ 验证结果                                          │
│         ↓ 分析                                          │
│  Pattern (模式) [临时，不持久化]                         │
│    ├─ 重复修正                                          │
│    ├─ 踩坑记录                                          │
│    └─ 用户偏好                                          │
│         ↓ 提炼                                          │
│  Rule (规则) [持久化]                                    │
│    ├─ 内容 + 原因                                       │
│    ├─ 场景标签（三维）                                   │
│    ├─ 置信度                                            │
│    └─ 生命周期                                          │
│         ↓ 组织                                          │
│  Scene (场景) [三维标签系统]                             │
│    ├─ 技术栈 (tech)                                     │
│    ├─ 功能域 (functional)                               │
│    └─ 业务域 (business)                                 │
│         ↓ 注入                                          │
│  Future Session (后续会话)                              │
│    └─ 规则影响 Claude 行为                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 9. 核心设计原则

1. **用户可控**：所有规则变更需要用户确认
2. **智能但不强制**：优先遵守规则，但用户明确要求时可以违反
3. **平衡提醒**：违反规则时提醒，遵守规则时静默
4. **持续演进**：规则会随时间更新、衰减、归档
5. **场景化组织**：三维场景模型，精确过滤相关规则
6. **混合检测**：自动推断 + 用户配置，开箱即用且可精细调整

---

## 10. 与现有系统的关系

### 与 Claude Code Memory 的关系

AutoImprove 和 Memory 是**互补**的：

| 维度 | Memory | AutoImprove |
|------|--------|-------------|
| 目标 | 记住用户信息和项目上下文 | 学习编码模式和项目规范 |
| 内容 | 用户角色、偏好、项目信息 | 编码规则、反模式、最佳实践 |
| 来源 | 用户明确告知 | 从会话中自动学习 |
| 结构 | 自由文本 | 结构化规则 |
| 生命周期 | 长期稳定 | 动态演进 |

**可能的集成**：
- AutoImprove 生成的规则可以写入 Memory（作为 feedback memory）
- Memory 中的用户偏好可以影响 AutoImprove 的规则生成

### 与 CLAUDE.md 的关系

AutoImprove 可以**补充** CLAUDE.md：

- CLAUDE.md：静态的项目指令和约定
- AutoImprove：动态学习的规则和模式

**可能的集成**：
- 高置信度的规则可以建议用户写入 CLAUDE.md
- CLAUDE.md 中的约定可以作为 manual 规则导入 AutoImprove

---

## 总结

这个概念模型的核心特点：

1. **三维场景模型**：tech + functional + business
2. **简化的规则结构**：去掉了 authority 和 scope
3. **智能规则处理**：优先遵守，灵活处理，平衡提醒
4. **混合业务域检测**：推断 + 配置
5. **规则生命周期管理**：创建、激活、更新、衰减、归档
6. **索引+内容分离存储**：快速加载，按需读取

这个模型在**灵活性**和**复杂度**之间取得了平衡，既能满足实际需求，又不会过度设计。
