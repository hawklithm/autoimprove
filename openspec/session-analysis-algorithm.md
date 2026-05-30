# 会话分析算法（Session Analysis Algorithm）

## 1. 核心目标

**输入**：一个 Session（包含对话、工具调用、文件修改、验证结果）
**输出**：一组 Pattern（可能成为规则的模式）

**关键挑战**：
1. 如何识别"重复修正"？
2. 如何区分"真正的模式"和"一次性的操作"？
3. 如何提取通用原则，而不是具体细节？

---

## 2. Pattern 的三种类型

### 类型 1：重复修正（Repeated Correction）

**定义**：用户在同一个会话中，多次修改同一段代码，朝着同一个方向改进。

**识别信号**：
- 同一个文件被编辑多次
- 每次编辑都在相同的代码区域
- 用户使用 "amend"、"fix"、"修正" 等词汇
- 测试从失败到通过

**例子**：
```
Turn 1: 用户："创建 token refresh 逻辑"
        Claude：[生成内联的 JWT decode 代码]
        
Turn 2: 用户："不对，应该用 refreshToken() 函数"
        Claude：[修改为调用 refreshToken()]
        
Turn 3: 用户："还要处理 token 过期的情况"
        Claude：[添加过期处理]

→ Pattern: "Token refresh 应该使用 refreshToken() 函数，并处理过期"
```

### 类型 2：反模式（Anti-Pattern）

**定义**：用户修正了一个错误，这个错误是 Claude 自己犯的，且可能再犯。

**识别信号**：
- 测试失败 → 用户修正 → 测试通过
- 用户明确指出错误："这是错的"、"不应该这样"
- 修改涉及常见的编程错误（空指针、类型错误、逻辑错误）

**例子**：
```
Turn 1: Claude：[生成直接修改 React state 的代码]
        测试失败
        
Turn 2: 用户："不要直接修改 state，用 setState"
        Claude：[修改为使用 setState]
        测试通过

→ Pattern: "不要直接修改 React state，必须使用 setState"
```

### 类型 3：偏好（Preference）

**定义**：用户的编码风格偏好，不是错误，但用户希望保持一致。

**识别信号**：
- 用户修改了可以工作的代码
- 修改不影响功能，只影响风格
- 用户使用 "我更喜欢"、"我们团队习惯" 等词汇

**例子**：
```
Turn 1: Claude：[生成使用 default export 的代码]
        
Turn 2: 用户："改成 named export"
        Claude：[修改为 named export]

→ Pattern: "优先使用 named exports"
```

---

## 3. 会话分析流程

### 整体流程

```typescript
async function analyzeSession(session: Session): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  
  // 步骤 1: 识别重复修正
  patterns.push(...detectRepeatedCorrections(session));
  
  // 步骤 2: 识别反模式
  patterns.push(...detectAntiPatterns(session));
  
  // 步骤 3: 识别偏好
  patterns.push(...detectPreferences(session));
  
  // 步骤 4: 去重和合并
  const merged = mergePatterns(patterns);
  
  // 步骤 5: 计算置信度
  const withConfidence = merged.map(p => ({
    ...p,
    confidence: calculateConfidence(p)
  }));
  
  // 步骤 6: 过滤低置信度
  return withConfidence.filter(p => p.confidence >= 0.5);
}
```

---

## 4. 重复修正检测

### 算法

```typescript
function detectRepeatedCorrections(session: Session): Pattern[] {
  const patterns: Pattern[] = [];
  
  // 1. 按文件分组编辑
  const editsByFile = groupEditsByFile(session.edits);
  
  for (const [filePath, edits] of editsByFile) {
    // 2. 检测同一区域的多次编辑
    const repeatedEdits = findRepeatedEdits(edits);
    
    for (const editGroup of repeatedEdits) {
      // 3. 分析编辑的方向性
      const direction = analyzeEditDirection(editGroup);
      
      if (direction.isConsistent) {
        // 4. 提取模式
        const pattern = extractPatternFromEdits(editGroup, direction);
        patterns.push(pattern);
      }
  n  
  return patterns;
}
```

### 详细实现

```typescript
interface EditGroup {
  file: string;
  region: CodeRegion;  // 代码区域（行号范围）
  edits: FileEdit[];
  turns: number[];     // 对应的对话轮次
}

interface CodeRegion {
  startLine: number;
  endLine: number;
}

function findRepeatedEdits(edits: FileEdit[]): EditGroup[] {
  const groups: EditGroup[] = [];
  
  // 按时间排序
  const sortedEdits = edits.sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  for (let i = 0; i < sortedEdits.length; i++) {
    const edit = sortedEdits[i];
    
    // 查找是否有现有组覆盖这个编辑区域
    let foundGroup = false;
    
    for (const group of groups) {
      if (regionsOverlap(group.region, edit.region)) {
        // 扩展组的区域
        group.region = mergeRegions(group.region, edit.region);
        group.edits.push(edit);
        foundGroup = true;
        break;
      }
    }
    
    if (!foundGroup) {
      // 创建新组
      groups.push({
        file: edit.file_path,
        region: edit.region,
        edits: [edit],
        turns: [edit.turn]
      });
    }
  }
  
  // 只返回有多次编辑的组
  return groups.filter(g => g.edits.length >= 2);
}

function analyzeEditDirection(group: EditGroup): {
  isConsistent: boolean;
  direction: string;
} {
  // 分析编辑的方向性
  // 例如：是否都在朝着同一个目标改进
  
  const changes = group.edits.map(e => analyzeChange(e));
  
  // 检查是否有一致的模式
  // 例如：都在添加错误处理、都在提取函数、都在改用某个 API
  
  const patterns = extractChangePatterns(changes);
  
  if (patterns.length === 1) {
    // 所有编辑都朝着同一个方向
    return {
      isConsistent: true,
      direction: patterns[0]
    };
  }
  
  return {
    isConsistent: false,
    direction: ''
  };
}

function extractPatternFromEdits(
  group: EditGroup,
  direction: { direction: string }
): Pattern {
  // 从编辑组中提取通用模式
  
  // 1. 获取最终状态的代码
  const finalCode = group.edits[group.edits.length - 1].new_content;
  
  // 2. 获取初始状态的代码
  const initialCode = group.edits[0].old_content;
  
  // 3. 分析差异
  const diff = analyzeDiff(initialCode, finalCode);
  
  // 4. 提取通用原则
  const principle = generalizePrinciple(diff, direction.direction);
  
  return {
    type: 'repeated-correction',
    description: principle,
    occurrences: [{
      session_id: group.edits[0].session_id,
      timestamp: group.edits[0].timestamp,
      user_action: 'explicit_correction',
      context: `${group.file}:${group.region.startLine}-${group.region.endLine}`
    }],
    first_seen: group.edits[0].timestamp,
    last_seen: group.edits[group.edits.length - 1].timestamp,
    confidence: 0  // 稍后计算
  };
}
```

### 通用化原则

这是最关键的部分：如何从具体的代码变化中提取通用原则？

```typescript
function generalizePrinciple(
  diff: CodeDiff,
  direction: string
): string {
  // 策略 1: 基于 AST 的模式匹配
  const astPattern = extractASTPattern(diff);
  
  if (astPattern) {
    return astPattern.generalize();
  }
  
  // 策略 2: 基于关键词的模式识别
  const keywords = extractKeywords(diff);
  
  if (keywords.length > 0) {
    return `使用 ${keywords.join(', ')} 而不是 ${diff.removed_keywords.join(', ')}`;
  }
  
  // 策略 3: 基于结构的模式
  const structuralChange = analyzeStructuralChange(diff);
  
  if (structuralChange) {
    return structuralChange.describe();
  }
  
  // 兜底：返回方向描述
  return direction;
}
```

**例子**：

```typescript
// 输入：具体的代码变化
const diff = {
  removed: `
    const decoded = jwt.decode(token);
    const newToken = jwt.sign({ userId: decoded.userId }, SECRET);
  `,
  added: `
    const newToken = await refreshToken(token);
  `
};

// 输出：通用原则
generalizePrinciple(diff, 'extract-to-function')
→ "Token refresh 应该使用 refreshToken() 辅助函数，不要内联 JWT decode"
```

---

## 5. 反模式检测

### 算法

```typescript
function detectAntiPatterns(session: Session): Patter{
  const patterns: Pattern[] = [];
  
  // 1. 查找测试失败 → 修正 → 测试通过的序列
  const failFixPassSequences = findFailFixPassSequences(session);
  
  for (const sequence of failFixPassSequences) {
    // 2. 分析失败的原因
    const failureReason = analyzeFailureReason(sequence);
    
    // 3. 分析修正的方式
    const fix = analyzeFix(sequence);
    
    // 4. 生成反模式规则
    const pattern = {
      type: 'anti-pattern',
      description: `不要 ${failureReason.antiPattern}，应该 ${fix.correctPattern}`,
      occurrences: [{
        session_id: session.id,
        timestamp: sequence.fix.timestamp,
        user_action: 'explicit_correction',
        test_passed: true,
        context: sequence.context
      }],
      first_seen: sequence.fix.timestamp,
      last_seen: sequence.fix.timestamp,
      confidence: 0
    };
    
    patterns.push(pattern);
  }
  
  return patterns;
}
```

### 失败-修正-通过序列

```typescript
interface FailFixPassSequence {
  fail: {
    test_output: string;
    exit_code: number;
    timestamp: string;
  };
  fix: {
    edit: FileEdit;
    user_input: string;
    timestamp: string;
  };
  pass: {
    test_output: string;
    exit_code: number;
    timestamp: string;
  };
  context: string;
}

function findFailFixPassSequences(session: Session): FailFixPassSequence[] {
  const sequences: FailFixPassSequence[] = [];
  
  // 遍历会话中的所有测试运行
  const testRuns = session.tool_calls.filter(tc => tc.tool === 'Bash' && tc.command.includes('test'));
  
  for (let i = 0; i < testRuns.length - 1; i++) {
    const currentRun = testRuns[i];
    const nextRun = testRuns[i + 1];
    
    // 检查是否是失败 → 通过
    if (currentRun.exit_code !== 0 && nextRun.exit_code === 0) {
      // 查找中间的编辑
      const editsBetween = session.edits.filter(e =>
        new Date(e.timestamp) > new Date(currentRun.timestamp) &&
        new Date(e.timestamp) < new Date(nextRun.timestamp)
      );
      
      if (editsBetween.length > 0) {
        sequences.push({
          fail: {
            test_output: currentRun.output,
            exit_code: currentRun.exit_code,
            timestamp: currentRun.timestamp
          },
          fix: {
            edit: editsBetween[0],  // 简化：只取第一个编辑
            user_input: findUserInputBefore(session, editsBetween[0]),
            timestamp: editsBetween[0].timestamp
          },
          pass: {
            test_output: nextRun.output,
            exit_code: nextRun.exit_code,
            timestamp: nextRun.timestamp
          },
          context: editsBetween[0].file_path
        });
      }
    }
  }
  
  return sequences;
}
```

### 失败原因分析

```typescript
function analyzeFailureReason(sequence: FailFixPassSequence): {
  antiPattern: string;
  category: string;
} {
  const testOutput = sequence.fail.test_output;
  
  // 常见的错误模式
  const errorPatterns = [
    {
      pattern: /TypeError.*Cannot read property.*of undefined/,
      antiPattern: '访问可能为 undefined 的属性',
      category: 'null-safety'
    },
    {
      pattern: /state.*directly/i,
      antiPattern: '直接修改 state',
      category: 'react-state'
    },
    {
      pattern: /Missing dependency/i,
      antiPattern: 'useEffect 缺少依赖',
      category: 'react-hooks'
    },
    {
      pattern: /Expected.*but got/,
      antiPattern: '类型不匹配',
      category: 'type-error'
    }
  ];
  
  for (const { pattern, antiPattern, category } of errorPatterns) {
    if (pattern.test(testOutput)) {
      return { antiPattern, category };
    }
  }
  
  // 兜底：从用户输入中提取
  const userInput = sequence.fix.user_input.toLowerCase();
  if (userInput.includes('不要') || userInput.includes('不应该')) {
    return {
      antiPattern: extractAntiPatternFromUserInput(userInput),
      category: 'user-specified'
    };
  }
  
  return {
    antiPattern: '未知错误',
    category: 'unknown'
  };
}
```

---

## 6. 偏好检测

### 算法

```typescript
function detectPreferences(session: Session): Pattern[] {
  const patterns: Pattern[] = [];
  
  // 1. 查找功能正常但被修改的代码
  const styleChanges = findStyleChanges(session);
  
  for (const change of styleChanges) {
    // 2. 分析修改的性质
    const preference = analyzePreference(change);
    
    if (preference) {
      patterns.push({
        type: 'preference',
        description: preference.description,
        occurrences: [{
          session_id: session.id,
          timestamp: change.timestamp,
          user_action: 'accept',
          context: change.context
        }],
        first_seen: change.timestamp,
        last_seen: change.timestamp,
        confidence: 0
      });
    }
  }
  
  return patterns;
}

function findStyleChanges(session: Session): StyleChange[] {
  const changes: StyleChange[] = [];
  
  for (const edit of session.edits) {
    // 检查是否是风格修改
    // 特征：
    // - 没有测试失败
    // - 用户使用 "改成"、"换成"、"更喜欢" 等词
    // - 修改不影响 AST 的语义
    
    const userInput = findUserInputBefore(session, edit);
    
    if (isStyleChange(edit, userInput)) {
      changes.push({
        edit,
        userInput,
        timestamp: edit.timestamp,
        context: edit.file_path
      });
    }
  }
  
  return changes;
}

function isStyleChange(edit: FileEdit, userInput: string): boolean {
  // 检查用户输入中的关键词
  const styleKeywords = [
    '改成', '换成', '更喜欢', '习惯', '风格',
    'prefer', 'change to', 'use instead'
  ];
  
  const hasStyleKeyword = styleKeywords.some(kw => 
    userInput.toLowerCase().includes(kw)
  );
  
  if (!hasStyleKeyword) return false;
  
  // 检查是否是语义等价的修改
  // 例如：default export → named export
  //      function → arrow function
  //      单引号 → 双引号
  
  return isSemanticEquivalent(edit.old_content, edit.new_content);
}
```

---

## 7. Pattern 合并和去重

### 问题

同一个模式可能在会话中多次出现，或者与历史 Pattern 重复。

### 算法

```typescript
async function mergePatterns(
  newPatterns: Pattern[],
  existingPatterns?: Pattern[]
): Promise<Pattern[]> {
  const merged: Pattern[] = [];
  
  // 1. 新 Pattern 之间的去重
  const dedupedNew = deduplicatePatterns(newPatterns);
  
  // 2. 与已有 Pattern 的合并
  if (existingPatterns) {
    for (const newPattern of dedupedNew) {
      const similar = findSimilarPattern(newPattern, existingPatterns);
      
      if (similar) {
        // 合并：增加出现次数，更新时间
        merged.push(mergePattern(similar, newPattern));
      } else {
        // 新模式
        merged.push(newPattern);
      }
    }
  } else {
    merged.push(...dedupedNew);
  }
  
  return merged;
}

function findSimilarPattern(
  pattern: Pattern,
  patterns: Pattern[]
): Pattern | null {
  for (const existing of patterns) {
    // 相似度判断
    const similarity = calculateSimilarity(pattern, existing);
    
    if (similarity > 0.8) {
      return existing;
    }
  }
  
  return null;
}

function calculateSimilarity(p1: Pattern, p2: Pattern): number {
  // 策略 1: 文本相似度（简单）
  const textSim = textSimilarity(p1.description, p2.description);
  
  // 策略 2: 语义相似度（使用 embeddings，可选）
  // const semanticSim = await semanticSimilarity(p1.description, p2.description);
  
  // 策略 3: 上下文相似度
  const contextSim = contextSimilarity(
    p1.occurrences[0].context,
    p2.occurrences[0].context
  );
  
  // 加权平均
  return textSim * 0.6 + contextSim * 0.4;
}

function textSimilarity(s1: string, s2: string): number {
  // 简单的 Jaccard 相似度
  const words1 = new Set(s1.toLowerCase().split(/\s+/));
  const words2 = new Set(s2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}
```

---

## 8. 完整示例

### 输入：一个真实的 Session

```typescript
const session: Session = {
  id: 'session-abc',
  timestamp: '2026-05-30T10:00:00Z',
  scenes: {
    tech: ['react', 'typescript'],
    functional: ['auth', 'ui'],
    business: ['user-management']
  },
  turns: [
    {
      user_input: '创建一个 LoginForm 组件，处理 JWT token 刷新',
      assistant_output: '我会创建 LoginForm.tsx...',
      timestamp: '2026-05-30T10:00:00Z'
    },
    {
      user_input: '不对，token 刷新应该用 refreshToken() 函数，不要内联 JWT decode',
      assistant_output: '好的，我会修改为使用 refreshToken()...',
      timestamp: '2026-05-30T10:05:00Z'
    },
    {
      user_input: '还要处理 token 过期的情况',
      assistant_output: '我会添加过期处理...',
      timestamp: '2026-05-30T10:10:00Z'
    }
  ],
  edits: [
    {
      file_path: 'src/components/Auth/LoginForm.tsx',
      region: { startLine: 15, endLine: 25 },
      old_content: `
        const decoded = jwt.decode(token);
        const newToken = jwt.sign({ userId: decoded.userId }, SECRET);
      `,
      new_content: `
        const newToken = await refreshToken(token);
      `,
      timestamp: '2026-05-30T10:05:30Z',
      turn: 2
    },
    {
      file_path: 'src/components/Auth/LoginForm.tsx',
      region: { startLine: 15, endLine: 30 },
      old_content: `
        const newToken = await refreshToken(token);
      `,
      new_content: `
        const newToken = await refreshToken(token);
        if (isTokenExpired(newToken)) {
          throw new Error('Token expired');
        }
      `,
      timestamp: '2026-05-30T10:10:30Z',
      turn: 3
    }
  ],
  validation: {
    test_exit_code: 0,
    final_user_action: 'accept'
  },
  metadata: {
    cwd: '/Users/adazhao/workspace/myapp',
    branch: 'feature/auth-refactor',
    claude_version: '4.7'
  }
};
```

### 输出：提取的 Pattern

```typescript
const patterns: Pattern[] = [
  {
    type: 'repeated-correction',
    description: 'JWT token 刷新必须使用 refreshToken() 辅助函数，不要内联 JWT decode，并且要处理 token 过期',
    occurrences: [
      {
        session_id: 'session-abc',
        timestamp: '2026-05-30T10:05:30Z',
        user_action: 'explicit_correction',
        test_passed: true,
        context: 'src/components/Auth/LoginForm.tsx:15-30'
      }
    ],
    first_seen: '2026-05-30T10:05:30Z',
    last_seen: '2026-05-30T10:10:30Z',
    confidence: 0.75  // 单次会话，置信度中等
  }
];
```

### 转换为 Rule

```typescript
const rule: Rule = {
  id: 'rule-001',
  content: 'JWT token 刷新必须使用 refreshToken() 辅助函数',
  reason: '用户在会话中修正了 2 次，从内联 JWT decode 改为使用 refreshToken()，并添加了过期处理',
  examples: {
    good: ['const newToken = await refreshToken(token);'],
    bad: ['const decoded = jwt.decode(token); const newToken = jwt.sign(...);']
  },
  scenes: {
    tech: ['typescript', 'node'],
    functional: ['auth', 'api'],
    business: ['user-management']
  },
  source: 'learned',
  confidence: 0.75,
  created_at: '2026-05-30T10:15:00Z',
  updated_at: '2026-05-30T10:15:00Z',
  trigger_count: 0
};
```

---

## 9. 实现注意事项

### 性能优化

1. **增量分析**：不要每次都分析整个会话历史，只分析新的会话
2. **缓存**：缓存 AST 解析结果、相似度计算结果
3. **异步处理**：会话分析可以在后台异步进行

### 准确性提升

1. **使用 AST**：不要只做文本匹配，使用 AST 理解代码结构
2. **上下文感知**：考虑代码的上下文（函数、类、模块）
3. **用户反馈**：允许用户修正错误的 Pattern

### 可扩展性

1. **插件化**：不同语言、框架的 Pattern 检测可以作为插件
2. **可配置**：允许用户配置 Pattern 检测的敏感度
3. **可解释**：生成的 Pattern 要能解释为什么被识别出来

---

## 10. 下一步

会话分析算法设计完成后，我们需要：

1. **MCP Server 实现**：如何将这个算法封装成 MCP tool
2. **Skill 工作流程**：如何协调多个 MCP tools 完成完整的分析流程
3. **用户交互设计**：如何向用户展示分析结果并请求确认

你想继续探讨哪个方面？
