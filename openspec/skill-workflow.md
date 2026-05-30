# Skill 工作流程设计

## 1. Skill 概述

Skill 是 AutoImprove 的编排层，负责：
- 协调多个 MCP tools 的调用
- 处理复杂的业务逻辑
- 与用户交互（请求确认、展示结果）
- 提供友好的用户体验

## 2. Skill 定义

```yaml
# skill.yaml
name: autoimprove-summarizer
version: 0.1.0
description: |
  分析 Claude Code 会话并生成可复用的规则。
  从用户习惯、踩坑模式和项目约定中学习。

metadata:
  author: AutoImprove Team
  tags: [learning, rules, productivity]
  
tools:
  - analyze_session
  - generate_rules
  - search_knowledge
  - update_rules
  - list_scenes

prompts:
  system: |
    你是一个专门分析 Claude Code 使用模式的专家。
    你的目标是从会话中提取可复用的知识。
    
    核心原则：
    1. 关注出现 2+ 次的模式
    2. 优先处理用户的修正和修改
    3. 生成清晰、可执行的规则
    4. 所有规则变更都需要用户确认
    5. 避免重复或冲突的规则
    
    工作流程：
    1. 分析会话 → 提取模式
    2. 搜索已有规则 → 去重
    3. 生成规则草案 → 请求用户确认
    4. 保存规则 → 更新索引
```

## 3. 核心工作流程

### 流程 1: 会话总结（/autoimprove-summarize）

这是最核心的流程，用户完成一个任务后调用。

```
用户：/autoimprove-summarize [scene]
  ↓
Skill 启动
  ↓
步骤 1: 获取会话数据
  ├─ 从 Claude Code 获取当前会话
  ├─ 识别会话边界（任务开始/结束）
  └─ 提取对话、编辑、验证结果
  ↓
步骤 2: 检测场景
  ├─ 如果用户指定了 scene，直接使用
  ├─ 否则调用 MCP: analyze_session (自动检测)
  └─ 返回三维场景标签
  ↓
步骤 3: 分析会话
  ├─ 调用 MCP: analyze_session
  ├─ 提取 Pattern (重复修正、反模式、偏好)
  └─ 计算置信度
  ↓
步骤 4: 搜索已有规则
  ├─ 调用 MCP: search_knowledge
  ├─ 检查是否有相似规则
  └─ 标记重复项
  ↓
步骤 5: 生成规则草案
  ├─ 过滤低置信度模式 (< 0.5)
  ├─ 去除重复模式
  └─ 格式化为用户友好的展示
  ↓
步骤 6: 请求用户确认
  ├─ 展示规则草案
  ├─ 说明每条规则的原因和置信度
  ├─ 标记重复/冲突的规则
  └─ 等待用户确认
  ↓
步骤 7: 保存规则
  ├─ 调用 MCP: generate_rules
  ├─ 写入存储
  └─ 更新索引
  ↓
步骤 8: 反馈结果
  └─ 告知用户生成了多少条规则
```

### 详细实现

```typescript
// autoimprove-summarizer.ts
export class AutoImproveSummarizer {
  private mcp: MCPClient;
  
  constructor(mcp: MCPClient) {
    this.mcp = mcp;
  }
  
  async summarize(options: {
    scene?: Scene;
    session_id?: string;
  }): Promise<SummaryResult> {
    // 步骤 1: 获取会话数据
    const session = await this.getSession(options.session_id);
    
    // 步骤 2 & 3: 分析会话（包含场景检测）
    const analysis = await this.mcp.call('analyze_session', {
      session_id: session.id,
      scene: options.scene,
      options: {
        min_confidence: 0.5,
        include_low_confidence: false,
      },
    });
    
    // 步骤 4: 搜索已有规则
    const existingRules = await this.mcp.call('search_knowledge', {
      scenes: analysis.scenes,
      type: 'rules',
      limit: 50,
    });
    
    // 步骤 5: 生成规则草案
    const draft = this.generateDraft(analysis.patterns, existingRules);
    
    // 步骤 6: 请求用户确认
    const confirmed = await this.requestUserConfirmation(draft);
    
    if (!confirmed.approved) {
      return {
        status: 'cancelled',
        message: '用户取消了规则生成',
      };
    }
    
    // 步骤 7: 保存规则
    const result = await this.mcp.call('generate_rules', {
      session_id: session.id,
      patterns: confirmed.selected_patterns,
      user_confirmation: true,
      options: {
        merge_similar: true,
        update_existing: true,
      },
    });
    
    // 步骤 8: 反馈结果
    return {
      status: 'success',
      generated_rules: result.generated_rules,
      summary: result.summary,
    };
  }
  
  private async getSession(session_id?: string): Promise<Session> {
    // 从 Claude Code 获取会话数据
    // 这部分需要 Claude Code 提供 API
    
    if (session_id) {
      return await claudeCode.getSession(session_id);
    }
    
    // 获取当前会话
    return await claudeCode.getCurrentSession();
  }
  
  private generateDraft(
    patterns: Pattern[],
    existingRules: Rule[]
  ): RuleDraft {
    const draft: RuleDraft = {
      new_rules: [],
      duplicate_rules: [],
      conflicting_rules: [],
    };
    
    for (const pattern of patterns) {
      // 检查重复
      const duplicate = this.findDuplicate(pattern, existingRules);
      if (duplicate) {
        draft.duplicate_rules.push({
          pattern,
          existing_rule: duplicate,
          action: 'skip',  // 默认跳过重复规则
        });
        continue;
      }
      
      // 检查冲突
      const conflict = this.findConflict(pattern, existingRules);
      if (conflict) {
        draft.conflicting_rules.push({
          pattern,
          conflicting_rule: conflict,
          action: 'ask',  // 需要用户决定
        });
        continue;
      }
      
      // 新规则
      draft.new_rules.push({
        pattern,
        action: 'create',
      });
    }
    
    return draft;
  }
  
  private async requestUserConfirmation(
    draft: RuleDraft
  ): Promise<ConfirmationResult> {
    // 格式化展示给用户
    const message = this.formatDraftForUser(draft);
    
    // 请求确认（通过 Claude Code 的交互机制）
    const response = await claudeCode.askUser({
      message,
      options: [
        { label: '全部确认', value: 'all' },
        { label: '选择性确认', value: 'selective' },
        { label: '取消', value: 'cancel' },
      ],
    });
    
    if (response === 'cancel') {
      return { approved: false, selected_patterns: [] };
    }
    
    if (response === 'all') {
      return {
        approved: true,
        selected_patterns: [
          ...draft.new_rules.map(r => r.pattern),
          ...draft.conflicting_rules.map(r => r.pattern),
        ],
      };
    }
    
    // 选择性确认
    const selected = await this.selectiveConfirmation(draft);
    return {
      approved: true,
      selected_patterns: selected,
    };
  }
  
  private formatDraftForUser(draft: RuleDraft): string {
    let message = '📊 会话分析完成\n\n';
    
    // 新规则
    if (draft.new_rules.length > 0) {
      message += `发现 ${draft.new_rules.length} 条新规则：\n\n`;
      
      for (const [i, item] of draft.new_rules.entries()) {
        message += `${i + 1}. **${item.pattern.description}**\n`;
        message += `   置信度: ${(item.pattern.confidence * 100).toFixed(0)}%\n`;
        message += `   类型: ${this.translateType(item.pattern.type)}\n\n`;
      }
    }
    
    // 重复规则
    if (draft.duplicate_rules.length > 0) {
      message += `\n⚠️  发现 ${draft.duplicate_rules.length} 条重复规则（将跳过）：\n\n`;
      
      for (const item of draft.duplicate_rules) {
        message += `- ${item.pattern.description}\n`;
        message += `  已有规则: ${item.existing_rule.content}\n\n`;
      }
    }
    
    // 冲突规则
    if (draft.conflicting_rules.length > 0) {
      message += `\n⚠️  发现 ${draft.conflicting_rules.length} 条冲突规则：\n\n`;
      
      for (const item of draft.conflicting_rules) {
        message += `- 新规则: ${item.pattern.description}\n`;
        message += `  冲突规则: ${item.conflicting_rule.content}\n`;
        message += `  建议: 保留新规则，删除旧规则\n\n`;
      }
    }
    
    message += '\n是否确认生成这些规则？';
    
    return message;
  }
  
  private translateType(type: string): string {
    const map = {
      'repeated-correction': '重复修正',
      'anti-pattern': '反模式',
      'preference': '用户偏好',
    };
    return map[type] || type;
  }
}
```

### 流程 2: 查看规则（/autoimprove-rules）

```
用户：/autoimprove-rules [scene]
  ↓
Skill 启动
  ↓
步骤 1: 确定场景
  ├─ 如果用户指定了 scene，使用指定场景
  ├─ 否则检测当前工作场景
  └─ 或者显示所有规则
  ↓
步骤 2: 搜索规则
  ├─ 调用 MCP: search_knowledge
  └─ 按场景过滤
  ↓
步骤 3: 格式化展示
  ├─ 按场景分组
  ├─ 按置信度排序
  └─ 高亮重要规则
  ↓
步骤 4: 提供操作选项
  └─ 允许用户编辑/删除规则
```

```typescript
async showRules(options: { scene?: Scene }): Promise<void> {
  // 1. 确定场景
  const scene = options.scene || await this.detectCurrentScene();
  
  // 2. 搜索规则
  const rules = await this.mcp.call('search_knowledge', {
    scenes: scene,
    type: 'rules',
    limit: 100,
  });
  
  // 3. 格式化展示
  const formatted = this.formatRulesForDisplay(rules, scene);
  
  // 4. 显示给用户
  await claudeCode.display({
    title: '当前规则',
    content: formatted,
    actions: [
      { label: '编辑规则', action: 'edit' },
      { label: '删除规则', action: 'delete' },
      { label: '导出规则', action: 'export' },
    ],
  });
}

private formatRulesForDisplay(rules: Rule[], scene: Scene): string {
  let output = `# AutoImprove 规则\n\n`;
  
  if (scene) {
    output += `**当前场景**: `;
    if (scene.tech) output += `技术栈: ${scene.tech.join(', ')} `;
    if (scene.functional) output += `功能域: ${scene.functional.join(', ')} `;
    if (scene.business) output += `业务域: ${scene.business.join(', ')}`;
    output += `\n\n`;
  }
  
  output += `共 ${rules.length} 条规则\n\n`;
  
  // 按来源分组
  const learned = rules.filter(r => r.source === 'learned');
  const manual = rules.filter(r => r.source === 'manual');
  
  if (learned.length > 0) {
    output += `## 学到的规则 (${learned.length})\n\n`;
    for (const rule of learned) {
      output += `### ${rule.content}\n\n`;
      output += `- **原因**: ${rule.reason}\n`;
      output += `- **置信度**: ${(rule.confidence * 100).toFixed(0)}%\n`;
      output += `- **触发次数**: ${rule.trigger_count}\n`;
      if (rule.last_triggered_at) {
        output += `- **最后触发**: ${new Date(rule.last_triggered_at).toLocaleDateString()}\n`;
      }
      output += `\n`;
    }
  }
  
  if (manual.length > 0) {
    output += `## 手写的规则 (${manual.length})\n\n`;
    for (const rule of manual) {
      output += `### ${rule.content}\n\n`;
      output += `- **原因**: ${rule.reason}\n\n`;
    }
  }
  
  return output;
}
```

### 流程 3: 搜索知识（/autoimprove-lessons）

```
用户：/autoimprove-lessons [scene] [query]
  ↓
Skill 启动
  ↓
步骤 1: 解析参数
  ├─ 场景（可选）
  └─ 查询关键词
  ↓
步骤 2: 搜索
  ├─ 调用 MCP: search_knowledge
  └─ 按相关性排序
  ↓
步骤 3: 展示结果
  ├─ 显示匹配的规则
  ├─ 显示相关的会话
  └─ 提供详细信息链接
```

```typescript
async searchLessons(options: {
  scene?: Scene;
  query: string;
}): Promise<void> {
  // 搜索
  const results = await this.mcp.call('search_knowledge', {
    query: options.query,
    scenes: options.scene,
    type: 'all',
    limit: 20,
  });
  
  // 格式化
  const formatted = this.formatSearchResults(results, options.query);
  
  // 显示
  await claudeCode.display({
    title: `搜索结果: "${options.query}"`,
    content: formatted,
  });
}
```

### 流程 4: 状态查看（/autoimprove-status）

```
用户：/autoimprove-status
  ↓
Skill 启动
  ↓
步骤 1: 收集统计信息
  ├─ 调用 MCP: list_scenes
  ├─ 统计规则数量
  ├─ 统计会话数量
  └─ 计算覆盖率
  ↓
步骤 2: 展示状态
  ├─ 总体统计
  ├─ 场景分布
  ├─ 最近活动
  └─ 健康度评分
```

```typescript
async showStatus(): Promise<void> {
  // 1. 收集统计
  const scenes = await this.mcp.call('list_scenes', { dimension: 'all' });
  const rules = await this.mcp.call('search_knowledge', { type: 'rules', limit: 1000 });
  
  // 2. 计算统计
  const stats = {
    total_rules: rules.results.length,
    learned_rules: rules.results.filter(r => r.source === 'learned').length,
    manual_rules: rules.results.filter(r => r.source === 'manual').length,
    high_confidence: rules.results.filter(r => r.confidence >= 0.8).length,
    scenes: {
      tech: scenes.tech.length,
      functional: scenes.functional.length,
      business: scenes.business.length,
    },
  };
  
  // 3. 格式化展示
  const formatted = `
# AutoImprove 状态

## 总体统计

- **总规则数**: ${stats.total_rules}
  - 学到的规则: ${stats.learned_rules}
  - 手写的规则: ${stats.manual_rules}
- **高置信度规则**: ${stats.high_confidence} (>= 80%)

## 场景覆盖

- **技术栈**: ${stats.scenes.tech} 个
- **功能域**: ${stats.scenes.functional} 个
- **业务域**: ${stats.scenes.business} 个

## 场景详情

### 技术栈
${scenes.tech.map(s => `- ${s.scene}: ${s.rule_count} 条规则`).join('\n')}

### 功能域
${scenes.functional.map(s => `- ${s.scene}: ${s.rule_count} 条规则`).join('\n')}

### 业务域
${scenes.business.map(s => `- ${s.scene}: ${s.rule_count} 条规则`).join('\n')}
`;
  
  await claudeCode.display({
    title: 'AutoImprove 状态',
    content: formatted,
  });
}
```

## 4. 错误处理

```typescript
class AutoImproveSummarizer {
  async summarize(options: SummarizeOptions): Promise<SummaryResult> {
    try {
      // 主流程
      return await this.doSummarize(options);
    } catch (error) {
      // 错误分类处理
      if (error instanceof SessionNotFoundError) {
        return {
          status: 'error',
          message: '未找到会话数据。请确保在完成任务后立即运行此命令。',
        };
      }
      
      if (error instanceof MCPConnectionError) {
        return {
          status: 'error',
          message: 'MCP Server 连接失败。请检查 AutoImprove 是否正确安装。',
        };
      }
      
      if (error instanceof StorageError) {
        return {
          status: 'error',
          message: '存储错误。请检查 ~/.autoimprove 目录的权限。',
        };
      }
      
      // 未知错误
      console.error('AutoImprove error:', error);
      return {
        status: 'error',
        message: `发生未知错误: ${error.message}`,
      };
    }
  }
}
```

## 5. 性能优化

### 缓存策略

```typescript
class AutoImproveSummarizer {
  private cache: Map<string, any>;
  private cacheTimeout: number = 5 * 60 * 1000; // 5 分钟
  
  private async getCached<T>(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.value;
    }
    
    const value = await fetcher();
    this.cache.set(key, { value, timestamp: Date.now() });
    
    return value;
  }
  
  async searchRules(scene: Scene): Promise<Rule[]> {
    const cacheKey = `rules:${JSON.stringify(scene)}`;
    return this.getCached(cacheKey, () =>
      this.mcp.call('search_knowledge', { scenes: scene, type: 'rules' })
    );
  }
}
```

### 并行处理

```typescript
async summarize(options: SummarizeOptions): Promise<SummaryResult> {
  // 并行执行独立的操作
  const [analysis, existingRules, sceneStats] = await Promise.all([
    this.mcp.call('analyze_session', { session_id: options.session_id }),
    this.mcp.call('search_knowledge', { type: 'rules' }),
    this.mcp.call('list_scenes', { dimension: 'all' }),
  ]);
  
  // 继续处理...
}
```

## 6. 测试

```typescript
// tests/skill/summarizer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AutoImproveSummarizer } from '../../src/skill/summarizer.js';

describe('AutoImproveSummarizer', () => {
  it('should summarize a session and generate rules', async () => {
    // Mock MCP client
    const mockMCP = {
      call: vi.fn(),
    };
    
    // Mock responses
    mockMCP.call.mockImplementation((arams) => {
      if (tool === 'analyze_session') {
        return {
          session_id: 'test',
          scenes: { tech: ['react'], functional: ['auth'] },
          patterns: [
            {
              type: 'repeated-correction',
              description: 'Use refreshToken()',
              confidence: 0.85,
            },
          ],
        };
      }
      
      if (tool === 'search_knowledge') {
        return { results: [] };
      }
      
      if (tool === 'generate_rules') {
        return {
          generated_rules: [{ action: 'created', rule: { id: 'rule-1' } }],
          summary: { created: 1, updated: 0 },
        };
      }
    });
    
    // Mock user confirmation
    const mockClaudeCode = {
      askUser: vi.fn().mockResolvedValue('all'),
    };
    
    // Test
    const summarizer = new AutoImproveSummarizer(mockMCP);
    const result = await summarizer.summarize({});
    
    expect(result.status).toBe('success');
    expect(result.summary.created).toBe(1);
  });
});
```

## 7. 下一步

Skill 工作流程设计完成后，我们需要：

1. **用户交互设计**：详细的 UI/UX 设计
2. **Plugin 实现**：斜杠命令的具体实现
3. **集成测试**：端到端的测试流程

你想继续哪个方面？
