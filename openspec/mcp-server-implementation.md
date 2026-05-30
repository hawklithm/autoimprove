# MCP Server 实现设计

## 1. 技术栈

```typescript
// 核心依赖
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",  // MCP SDK
    "fastmcp": "^0.2.0",                     // FastMCP 框架
    "zod": "^3.22.0",                        // 参数验证
    "minimatch": "^9.0.0",                   // 文件路径匹配
    "diff": "^5.1.0",                        // 代码差异分析
    "@babel/parser": "^7.23.0",              // JavaScript/TypeScript AST
    "@babel/traverse": "^7.23.0",            // AST 遍历
    "tree-sitter": "^0.20.0",                // 多语言 AST（可选）
    "sqlite3": "^5.1.0"                      // 本地数据库（可选）
  }
}
```

## 2. 项目结构

```
packages/autoimprove-core/
├── src/
│   ├── index.ts                    # MCP Server 入口
│   ├── server.ts                   # Server 配置
│   ├── tools/                      # MCP Tools
│   │   ├── analyze-session.ts
│   │   ├── generate-rules.ts
│   │   ├── search-knowledge.ts
│   │   ├── update-rules.ts
│   │   └── list-scenes.ts
│   ├── resources/                  # MCP Resources
│   │   ├── rules-resource.ts
│   │   └── lessons-resource.ts
│   ├── analyzers/                  # 分析器
│   │   ├── session-analyzer.ts
│   │   ├── pattern-detector.ts
│   │   ├── repeated-correction.ts
│   │   ├── anti-pattern.ts
│   │   └── preference.ts
│   ├── storage/                    # 存储层
│   │   ├── storage-interface.ts
│   │   ├── file-storage.ts
│   │   └── index-manager.ts
│   ├── scene/                      # 场景检测
│   │   ├── scene-detector.ts
│   │   ├── tech-detector.ts
│   │   ├── functional-detector.ts
│   │   └── business-detector.ts
│   ├── utils/                      # 工具函数
│   │   ├── ast-utils.ts
│   │   ├── diff-utils.ts
│   │   ├── similarity.ts
│   │   └── confidence.ts
│   └── types/                      # 类型定义
│       ├── session.ts
│       ├── pattern.ts
│       ├── rule.ts
│       └── scene.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── package.json
└── tsconfig.json
```

## 3. MCP Server 入口

```typescript
// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdiverTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { Storage } from './storage/file-storage.js';

async function main() {
  // 1. 创建 MCP Server
  const server = new Server(
    {
      name: 'autoimprove-core',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // 2. 初始化存储
  const storage = new Storage();
  await storage.initialize();

  // 3. 注册 Tools
  registerTools(server, storage);

  // 4. 注册 Resources
  registerResover, storage);

  // 5. 启动 Server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('AutoImprove MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
```

## 4. Tool 实现

### Tool 1: analyze_session

```typescript
// src/tools/analyze-session.ts
import { z } from 'zod';
import { SessionAnalyzer } from '../analyzers/session-analyzer.js';
import { SceneDetector } from '../scene/scene-detector.js';

export const analyzeSessionTool = {
  name: 'analyze_session',
  description: '分析 Claude Code 会话，提取可能的规则模式',
  inputSchema: z.object({
    session_id: z.string().optional().describe('会话 ID，不提供则分析最近的会话'),
    scene: z.object({
      tech: z.array(z.string()).optional(),
      functional: z.array(z.string()).optional(),
      business: z.array(z.string()).optional(),
    }).optional().describe('场景标识，不提供则自动检测'),
    options: z.object({
      min_confidence: z.number().min(0).max(1).default(0.5).describe('最低置信度阈值'),
      include_low_confidence: z.bodefault(false).describe('是否包含低置信度模式'),
    }).optional(),
  }),
};

export async function handleAnalyzeSession(
  params: z.infer<typeof analyzeSessionTool.inputSchema>,
  storage: Storage
) {
  // 1. 获取会话数据
  const session = params.session_id
    ? await storage.getSession(params.session_id)
    : await storage.getLatestSession();

  if (!session) {
    throw new Error('Session not found');
  }

  // 2. 检测场景（如果未提供）
  let scenes = params.scene;
  if (!scenes) {
    const sceneDetector = new SceneDetector(storage);
    scenes = await sceneDetector.detect(session);
  }

  // 3. 分析会话
  const analyzer = new SessionAnalyzer(storage);
  const patterns = await analyzer.analyze(session, scenes);

  // 4. 过滤低置信度模式
  const minConfidence = params.options?.min_confidence ?? 0.5;
  const filteredPatterns = params.options?.include_low_confidence
    ? patterns
    : patterns.filter(p => p.confidence >= minConfidence);

  // 5. 搜索已有规则，检查重复
  const existingRules = await storage.searchRules({ scenes });
  const duplicates = await findDuplicates(filteredPatterns, existingRules);

  // 6. 返回结果
  r {
    session_id: session.id,
    scenes,
    patterns: filteredPatterns.map(p => ({
      type: p.type,
      description: p.description,
      confidence: p.confidence,
      occurrences: p.occurrences.length,
      is_duplicate: duplicates.has(p),
      similar_rules: duplicates.get(p) || [],
    })),
    summary: {
      total_patterns: patterns.length,
      high_confidence: patterns.filter(p => p.confidence >= 0.8).length,
      medium_confidence: patterns.filter(p => p.confidence >= 0.6 && p.confidence < 0.8).length,
      low_confidence: patterns.filter(p => p.confidence < 0.6).length,
      duplicates: duplicates.size,
    },
  };
}
```

### Tool 2: generate_rules

```typescript
// src/tools/generate-rules.ts
import { z } from 'zod';

export const generateRulesTool = {
  name: 'generate_rules',
  description: '从分析的模式生成规则，需要用户确认',
  inputSchema: z.object({
    session_id: z.string().describe('会话 ID'),
    patterns: z.array(z.object({
      type: z.enum(['repeated-correction', 'anti-pattern', 'preference']),
      description: z.string(),
      confidence: z.number(),
    })).describe('要生成规则的模式列表'),
    user_confirmation: z.boolean().describe('用户是否确认生成这些规则'),
    options: z.object({
      merge_similar: z.boolean().default(true).describe('是否合并相似的规则'),
      update_existing: z.boolean().default(true).describe('是否更新已有规则'),
    }).optional(),
  }),
};

export async function handleGenerateRules(
  params: z.infer<typeof generateRulesTool.inputSchema>,
  storage: Storage
) {
  // 1. 检查用户确认
  if (!params.user_confirmation) {
    throw new Error('User confirmation required to generate rules');
  }

  // 2. 获取会话数据（用于提取场景等信息）
  const session = await storage.getSession(params.session_id);
  if (!session) {
    throw new Error('Session not found');
  }

  const results = [];

  // 3. 为每个 Pattern 生成规则
  for (const pattern of params.patterns) {
    // 3.1 检查是否有相似的已有规则
    const similarRules = await storage.findSimilarRules(pattern.description);

    if (similarRules.length > 0 && params.options?.update_existing) {
      // 更新已有规则
      const existingRule = similarRules[0];
      const updatedRule = await storage.updateRule(existingRule.id, {
        confidence: Math.min(existingRule.confidence + 0.1, 1.0),
        trigger_count: existingRule.trigger_count + 1,
        updated_at: new Date().toISOString(),
      });

      results.push({
        action: 'updated',
        rule: updatedRule,
      });
    } else {
      // 创建新规则
      const newRule = await storage.createRule({
        content: pattern.description,
        reason: `从会话 ${session.id} 中学到`,
        scenes: session.scenes,
        source: 'learned',
        confidence: pattern.confidence,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        trigger_count: 0,
      });

      results.push({
        action: 'created',
        rule: newRule,
      });
    }
  }

  // 4. 返回结果
  return {
    generated_rules: results,
    summary: {
      created: results.filter(r => r.action === 'created').length,
      updated: results.filter(r => r.action === 'updated').length,
    },
  };
}
```

### Tool 3: search_knowledge

```typescript
// src/tools/search-knowledge.ts
import { z } from 'zod';

export const searchKnowledgeTool = {
  name: 'search_knowledge',
  description: '搜索已有的规则和知识',
  inputSchema: z.object({
    query: z.string().describe('搜索查询'),
    scenes: z.object({
      tech: z.array(z.string()).optional(),
      functional: z.array(z.string()).optional(),
      business: z.array(z.string()).optional(),
    }).optional().describe('限制搜索的场景'),
    type: z.enum(['all', 'rules', 'lessons']).default('all').describe('搜索类型'),
    limit: z.number().min(1).max(50).default(10).describe('返回结果数量'),
  }),
};

export async function handleSearchKnowledge(
  params: z.infer<typeof searchKnowledgeTool.inputSchema>,
  storage: Storage
) {
  const results = [];

  // 1. 搜索规则
  if (params.type === 'all' || params.type === 'rules') {
    const rules = await storage.searchRules({
      query: params.query,
      scenes: params.scenes,
      limit: params.limit,
    });

    results.push(...rules.map(rule => ({
      type: 'rule',
      id: rule.id,
      content: rule.content,
      reason: rule.reason,
      scenes: rule.scenes,
      confidence: rule.confidence,
      source: rule.source,
    })));
  }

  // 2. 搜索 lessons（可选功能）
  if (params.type === 'all' || params.type === 'lessons') {
    const lessons = await storage.searchLessons({
      query: params.query,
      scenes: params.scenes,
      limit: params.limit,
    });

    results.push(...lessons.map(lesson => ({
      type: 'lesson',
      id: lesson.id,
      title: lesson.title,
      content: lesson.content,
      scenes: lesson.scenes,
    })));
  }

  // 3. 按相关性排序
  const sorted = sortByRelevance(results, params.query);

  return {
    results: sorted.slice(0, params.limit),
    total: sorted.length,
  };
}
```

### Tool 4: update_rules

```typescript
// src/tools/update-rules.ts
import { z } from 'zod';

export const updateRulesTool = {
  name: 'update_rules',
  description: '更新或删除规则',
  inputSchema: z.object({
    rule_id: z.string().describe('规则 ID'),
    action: z.enum(['update', 'delete', 'archive']).describe('操作类型'),
    updates: z.object({
      content: z.string().optional(),
      reason: z.string().optional(),
      scenes: z.object({
        tech: z.array(z.string()).optional(),
        functional: z.array(z.string()).optional(),
        business: z.array(z.string()).optional(),
      }).optional(),
      confidence: z.number().min(0).max(1).optional(),
    }).optional().describe('更新的字段（仅 action=update 时需要）'),
  }),
};

export async function handleUpdateRules(
  params: z.infer<typeof updateRulesTool.inputSchema>,
  storage: Storage
) {
  const rule = await storage.getRule(params.rule_id);
  if (!rule) {
    throw new Error('Rule not found');
  }

  switch (params.action) {
    case 'update':
      if (!params.updates) {
        throw new Error('Updates required for update action');
      }
      const updated = await storage.updateRule(params.rule_id, {
        ...params.updates,
        updated_at: new Date().toISOString(),
      });
      return { action: 'updated', rule: updated };

    case 'delete':
      await storage.deleteRule(params.rule_id);
      return { action: 'deleted', rule_id: params.rule_id };

    case 'archive':
      const archived = await storage.archiveRule(params.rule_id);
      return { action: 'archived', rule: archived };

    default:
      throw new Error(`Unknown action: ${params.action}`);
  }
}
```

### Tool 5: list_scenes

```typescript
// src/tools/list-scenes.ts
import { z } from 'zod';

export const listScenesTool = {
  name: 'list_scenes',
  description: '列出所有已知的场景及其统计信息',
  inputSchema: z.object({
    dimension: z.enum(['tech', 'functional', 'business', 'all']).default('all').describe('场景维度'),
  }),
};

export async function handleListScenes(
  params: z.infer<typeof listScenesTool.inputSchema>,
  storage: Storage
) {
  const allRules = await storage.getAllRules();

  // 统计每个场景的规则数量
  const sceneStats = {
    tech: new Map<string, number>(),
    functional: new Map<string, number>(),
    business: new Map<string, number>(),
  };

  for (const rule of allRules) {
    if (rule.scenes.tech) {
      for (const scene of rule.scenes.tech) {
        sceneStats.tech.set(scene, (sceneStats.tech.get(scene) || 0) + 1);
      }
    }
    if (rule.scenes.functional) {
      for (const scene of rule.scenes.functional) {
        sceneStats.functional.set(scene, (sceneStats.functional.get(scene) || 0) + 1);
      }
    }
    if (rule.scenes.business) {
      for (const scene of rule.scenes.business) {
        sceneStats.business.set(scene, (sceneStats.business.get(scene) || 0) + 1);
      }
    }
  }

  // 格式化结果
  const formatDimension = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([scene, count]) => ({ scene, rule_count: count }))
      .sort((a, b) => b.rule_count - a.rule_count);

  const result: any = {};

  if (params.dimension === 'all' || params.dimension === 'tech') {
    result.tech = formatDimension(sceneStats.tech);
  }
  if (params.dimension === 'all' || params.dimension === 'functional') {
    result.functional = formatDimension(sceneStats.functional);
  }
  if (params.dimension === 'all' || params.dimension === 'business') {
    result.business = formatDimension(sceneStats.business);
  }

  return result;
}
```

## 5. Resource 实现

### Resource 1: Rules

```typescript
// src/resources/rules-resource.ts
export function registerRulesResource(server: Server, storage: Storage) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const rules = await storage.getAllRules();

    return {
      resources: rules.map(rule => ({
        uri: `knowledge://rules/${rule.id}`,
        name: rule.content.substring(0, 50) + '...',
        description: `Rule: ${rule.content}`,
        mimeType: 'text/markdown',
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const match = uri.match(/^knowledge:\/\/rules\/(.+)$/);

    if (!match) {
      throw new Error('Invalid resource URI');
    }

    const ruleId = match[1];
    const rule = await storage.getRule(ruleId);

    if (!rule) {
      throw new Error('Rule not found');
    }

    // 读取规则的详细内容
    const content = await storage.getRuleContent(ruleId);

    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: content,
        },
      ],
    };
  });
}
```

## 6. 存储层实现

```typescript
// src/storage/file-storage.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { Rule, Session, Pattern } from '../types/index.js';

export class Storage {
  private baseDir: string;
  private indexCache: Map<string, any>;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.env.HOME!, '.autoimprove');
    this.indexCache = new Map();
  }

  async initialize() {
    // 创建目录结构
    await fs.mkdir(path.join(this.baseDir, 'rules/content'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'cache'), { recursive: true });

    // 加载索引
    await this.loadIndex();
  }

  private async loadIndex() {
    const indexPath = path.join(this.baseDir, 'rules/index.json');

    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);
      this.indexCache.set('rules', index);
    } catch (error) {
      // 索引不存在，创建空索引
      this.indexCache.set('rules', { version: '0.1.0', rules: [] });
      await this.saveIndex();
    }
  }

  private async saveIndex() {
    const indexPath = path.join(this.baseDir, 'rules/index.json');
    const index = this.indexCache.get('rules');
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  }

  async createRule(rule: Omit<Rule, 'id'>): Promise<Rule> {
    const id = `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullRule: Rule = { id, ...rule };

    // 1. 写入详细内容
    await this.writeRuleContent(fullRule);

    // 2. 更新索引
    const index = this.indexCache.get('rules');
    index.rules.push({
      id: fullRule.id,
      content: fullRule.content,
      scenes: fullRule.scenes,
      source: fullRule.source,
      confidence: fullRule.confidence,
      created_at: fullRule.created_at,
      updated_at: fullRule.updated_at,
      last_triggered_at: fullRule.last_triggered_at,
      trigger_count: fullRule.trigger_count,
      content_file: `content/${id}.md`,
    });

    await this.saveIndex();

    return fullRule;
  }

  private async writeRuleContent(rule: Rule) {
    const contentPath = path.join(this.baseDir, `rules/content/${rule.id}.md`);

    const markdown = `---
id: ${rule.id}
created_at: ${rule.created_at}
updated_at: ${rule.updated_at}
---

# ${rule.content}

## 原因

${rule.reason}

${rule.examples ? `
## 正例

\`\`\`typescript
${rule.examples.good?.join('\n\n')}
\`\`\`

## 反例

\`\`\`typescript
${rule.examples.bad?.join('\n\n')}
\`\`\`
` : ''}

## 场景

- 技术栈: ${rule.scenes.tech?.join(', ') || '无'}
- 功能域: ${rule.scenes.functional?.join(', ') || '无'}
- 业务域: ${rule.scenes.business?.join(', ') || '无'}

## 元数据

- 来源: ${rule.source}
- 置信度: ${rule.confidence}
- 触发次数: ${rule.trigger_count}
${rule.last_triggered_at ? `- 最后触发: ${rule.last_triggered_at}` : ''}
`;

    await fs.writeFile(contentPath, markdown);
  }

  async searchRules(params: {
    query?: string;
    scenes?: Scene;
    limit?: number;
  }): Promise<Rule[]> {
    const index = this.indexCache.get('rules');
    let rules = index.rules;

    // 按场景过滤
    if (params.scenes) {
      rules = rules.filter((rule: any) => this.matchesScenes(rule.scenes, params.scenes!));
    }

    // 按查询过滤
    if (params.query) {
      const query = params.query.toLowerCase();
      rules = rules.filter((rule: any) =>
        rule.content.toLowerCase().includes(query)
      );
    }

    // 限制数量
    if (params.limit) {
      rules = rules.slice(0, params.limit);
    }

    return rules;
  }

  private matchesScenes(ruleScenes: Scene, queryScenes: Scene): boolean {
    // 检查是否有任何维度匹配
    const techMatch = !queryScenes.tech || queryScenes.tech.some(t =>
      ruleScenes.tech?.includes(t)
    );
    const functionalMatch = !queryScenes.functional || queryScenes.functional.some(f =>
      ruleScenes.functional?.includes(f)
    );
    const businessMatch = !queryScenes.business || queryScenes.business.some(b =>
      ruleScenes.business?.includes(b)
    );

    return techMatch && functionalMatch && businessMatch;
  }

  // ... 其他方法
}
```

## 7. 测试

```typescript
// tests/integration/analyze-session.test.ts
import { describe, it, expect } from 'vitest';
import { Storage } from '../../src/storage/file-storage.js';
import { handleAnalyzeSession } from '../../src/tools/analyze-session.js';

describe('analyze_session tool', () => {
  it('should analyze a session and extract patterns', async () => {
    const storage = new Storage('/tmp/autoimprove-test');
    await storage.initialize();

    // 创建测试会话
    const session = {
      id: 'test-session',
      timestamp: new Date().toISOString(),
      scenes: {
        tech: ['react'],
        functional: ['auth'],
      },
      turns: [
        {
          user_input: '创建 LoginForm',
          assistant_output: '...',
          timestamp: new Date().toISOString(),
        },
        {
          user_input: '改用 refreshToken() 函数',
          assistant_output: '...',
          timestamp: new Date().toISOString(),
        },
      ],
      edits: [
        {
          file_path: 'src/LoginForm.tsx',
          region: { startLine: 10, endLine: 20 },
          old_content: 'const token = jwt.decode(...)',
          new_content: 'const token = await refreshToken(...)',
          timestamp: new Date().toISOString(),
          turn: 2,
        },
      ],
      validation: {
        test_exit_code: 0,
        final_user_action: 'accept',
      },
      metadata: {
        cwd: '/test',
        branch: 'main',
        claude_version: '4.7',
      },
    };

    await storage.saveSession(session);

    // 分析会话
    const result = await handleAnalyzeSession(
      { session_id: 'test-session' },
      storage
    );

    // 验证结果
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.patterns[0].type).toBe('repeated-correction');
    expect(result.patterns[0].confidence).toBeGreaterThan(0.5);
  });
});
```

## 8. 部署和使用

### 安装

```bash
npm install -g autoimprove
autoimprove init
```

### 配置 Claude Code

```json
// .claude/settings.json
{
  "mcpServers": {
    "autoimprove": {
      "command": "autoimprove-server",
      "args": [],
      "env": {
        "AUTOIMPROVE_HOME": "/Users/adazhao/.autoimprove"
      }
    }
  }
}
```

### 使用

```typescript
// 在 Claude Code 中
// Claude 可以调用 MCP tools

// 分析当前会话
const result = await mcp.analyze_session({});

// 生成规则
await mcp.generate_rules({
  session_id: result.session_id,
  patterns: result.patterns,
  user_confirmation: true,
});

// 搜索规则
const rules = await mcp.search_knowledge({
  query: 'token refresh',
  scenes: { functional: ['auth'] },
});
```

## 9. 性能优化

1. **索引缓存**：将 index.json 加载到内存
2. **延迟加载**：规则内容按需加载
3. **并行处理**：会话分析的多个步骤并行执行
4. **增量更新**：只分析新的会话，不重复分析历史

## 10. 下一步

MCP Server 实现完成后，我们需要：

1. **Skill 工作流程**：如何协调多个 MCP tools
2. **用户交互设计**：如何展示结果并请求确认
3. **Plugin 实现**：斜杠命令的具体实现

你想继续哪个方面？
