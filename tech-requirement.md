AutoImprove：Claude Code 智能进化工具包 —— 完整技术方案

1. 项目概述

AutoImprove 是一个面向 Claude Code 的智能进化工具包，通过 MCP Server + Skill + Plugin 三位一体架构，实现：

• 会话自动分析 → 提取用户习惯/踩坑模式

• 规则沉淀 → 生成可复用的项目规范

• 知识供给 → 后续会话精准注入上下文

• 用户可控 → 所有规则变更需用户确认

核心价值主张

"Teach Claude to improve itself, one session at a time."

2. 系统架构


┌─────────────────────────────────────────────────────────────┐
│                    Claude Code (宿主环境)                    │
├─────────────────────────────────────────────────────────────┤
│  Plugin Layer (斜杠命令入口)                                │
│  ├── /autoimprove-summarize [scene]                        │
│  ├── /autoimprove-rules [scene]                           │
│  ├── /autoimprove-lessons [scene] [query]                 │
│  └── /autoimprove-status                                  │
├─────────────────────────────────────────────────────────────┤
│  Skill Layer (复杂逻辑处理)                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  autoimprove-summarizer                            │   │
│  │  • 会话分析  • 规则生成  • 去重检测  • 用户确认   │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  MCP Client (Stdio/HTTP 通信)                             │
└─────────────────────────────────────────────────────────────┘
                           ↕
┌─────────────────────────────────────────────────────────────┐
│              MCP Server: autoimprove-core                  │
├─────────────────────────────────────────────────────────────┤
│  Tools (Claude 可调用的能力)                               │
│  ├── analyze_session(session_id?, scene)                   │
│  ├── generate_rules(scene, patterns, user_confirmation)    │
│  ├── search_knowledge(scene, query, type)                 │
│  ├── update_rules(scene, rule_content, reason)            │
│  └── list_scenes()                                       │
├─────────────────────────────────────────────────────────────┤
│  Resources (Claude 可直接引用的知识库)                      │
│  ├── knowledge://rules/{scene}/project                    │
│  ├── knowledge://rules/{scene}/anti-patterns              │
│  ├── knowledge://rules/{scene}/preferences                │
│  └── knowledge://lessons/{scene}/latest                   │
├─────────────────────────────────────────────────────────────┤
│  Storage Layer (本地文件存储)                              │
│  ~/.autoimprove/                                          │
│  ├── rules/                                              │
│  │   ├── project.md (项目约定)                           │
│  │   ├── anti-patterns.md (踩坑记录)                     │
│  │   └── preferences.md (用户偏好)                        │
│  ├── lessons/                                            │
│  │   └── {scene}/                                        │
│  │       ├── latest.md                                   │
│  │       └── YYYY-MM-DD-session-xxx.md                   │
│  ├── sessions/                                           │
│  │   └── {session_id}.json                               │
│  └── config.json                                         │
└─────────────────────────────────────────────────────────────┘


3. 核心组件设计

3.1 MCP Server (autoimprove-core)

技术栈

• Runtime: Node.js 18+

• Framework: FastMCP

• Storage: 文件系统 (Markdown + JSON)

• Vector Search: 可选 (sqlite-vec 或 simple keyword search)

核心数据结构

// 会话数据结构
interface Session {
  id: string;
  timestamp: string;
  scene?: string;
  user_input: string;
  assistant_output: string;
  tool_calls: ToolCall[];
  edits: FileEdit[];
  validation: {
    test_exit_code?: number;
    lint_exit_code?: number;
    build_exit_code?: number;
    user_action: 'accept' | 'amend' | 'undo' | 'manual_fix';
  };
  metadata: {
    cwd: string;
    git_remote?: string;
    branch?: string;
    claude_version: string;
  };
}

// 规则数据结构
interface Rule {
  id: string;
  type: 'project' | 'anti-patterns' | 'preferences';
  scene: string;
  content: string;
  reason: string;
  created_at: string;
  updated_at: string;
  confidence: number; // 0-1, 基于出现频率
}

// 场景定义
interface Scene {
  name: string;
  description: string;
  rules_count: number;
  last_updated: string;
}


MCP Tools 实现

// analyze_session tool
server.tool('analyze_session', {
  session_id: z.string().optional(),
  scene: z.string().describe('场景标识，如 react, auth, api')
}, async ({ session_id, scene }) => {
  const session = session_id 
    ? await storage.getSession(session_id)
    : await storage.getLatestSession();
    
  const analysis = await analyzer.analyze(session, scene);
  
  return {
    patterns: analysis.patterns,
    suggestions: analysis.suggestions,
    confidence: analysis.confidence,
    needs_user_confirmation: analysis.needs_user_confirmation
  };
});

// generate_rules tool
server.tool('generate_rules', {
  scene: z.string(),
  patterns: z.array(z.object({
    type: z.enum(['project', 'anti-patterns', 'preferences']),
    content: z.string(),
    reason: z.string()
  })),
  user_confirmation: z.boolean()
}, async ({ scene, patterns, user_confirmation }) => {
  if (!user_confirmation) {
    throw new Error('User confirmation required');
  }
  
  const results = [];
  for (const pattern of patterns) {
    const rule = await storage.appendRule(scene, pattern);
    results.push(rule);
  }
  
  return { generated_rules: results };
});


3.2 Skill (autoimprove-summarizer)

Skill 定义

# skill.yaml
name: autoimprove-summarizer
description: |
  Analyze Claude Code sessions and generate actionable rules.
  Learn from user habits, anti-patterns, and project conventions.
  All rule changes require explicit user confirmation.

metadata:
  version: "0.1.0"
  author: "AutoImprove Team"
  tags: ["learning", "rules", "productivity"]

tools:
  - analyze_session
  - generate_rules
  - search_knowledge
  - update_rules
  - list_scenes

prompts:
  system: |
    You are an expert at analyzing Claude Code usage patterns.
    Your goal is to extract reusable knowledge from sessions.
    
    Guidelines:
    1. Focus on patterns that appear 2+ times
    2. Prioritize user corrections and amendments
    3. Generate clear, actionable rules
    4. Always ask user confirmation before writing rules
    5. Avoid duplicate or conflicting rules


核心逻辑流程

// summarizer 主逻辑
class AutoImproveSummarizer {
  async summarizeSession(options: SummarizeOptions): Promise<SummaryResult> {
    // 1. 获取会话数据
    const session = await this.getSession(options.session_id);
    
    // 2. 调用 MCP 分析会话
    const analysis = await this.mcp.analyze_session({
      session_id: session.id,
      scene: options.scene || this.detectScene(session)
    });
    
    // 3. 搜索已有知识，避免重复
    const existing = await this.mcp.search_knowledge({
      scene: options.scene,
      query: analysis.patterns.map(p => p.content).join(' '),
      type: 'all'
    });
    
    // 4. 去重和合并
    const merged = this.mergeWithExisting(analysis.patterns, existing);
    
    // 5. 生成规则草案
    const draft = this.generateDraft(merged, session);
    
    // 6. 请求用户确认
    const confirmed = await this.requestUserConfirmation(draft);
    
    // 7. 写入规则（通过 MCP）
    if (confirmed) {
      return await this.mcp.generate_rules({
        scene: options.scene,
        patterns: draft.patterns,
        user_confirmation: true
      });
    }
    
    return { status: 'cancelled_by_user' };
  }
  
  private detectScene(session: Session): string {
    // 基于文件路径、git remote、branch 等自动检测场景
    const indicators = [
      { pattern: /react|jsx|tsx/, scene: 'react' },
      { pattern: /auth|login|jwt/, scene: 'auth' },
      { pattern: /api|endpoint|route/, scene: 'api' },
      { pattern: /prisma|schema|migration/, scene: 'database' }
    ];
    
    for (const indicator of indicators) {
      if (indicator.pattern.test(session.user_input)) {
        return indicator.scene;
      }
    }
    
    return 'general';
  }
}


3.3 Plugin (斜杠命令)

插件配置

// .claude/plugins/autoimprove/plugin.json
{
  "name": "autoimprove",
  "version": "0.1.0",
  "description": "Auto-improvement toolkit for Claude Code",
  "commands": [
    {
      "name": "autoimprove-summarize",
      "description": "Analyze current session and generate rules",
      "arguments": [
        {
          "name": "scene",
          "description": "Scene identifier (react, auth, api, etc.)",
          "required": false
        }
      ],
      "handler": "autoimprove-summarizer.summarize"
    },
    {
      "name": "autoimprove-rules",
      "description": "View current rules for a scene",
      "arguments": [
        {
          "name": "scene",
          "description": "Scene identifier",
          "required": false
        }
      ],
      "handler": "autoimprove-summarizer.showRules"
    },
    {
      "name": "autoimprove-lessons",
      "description": "Search learned lessons",
      "arguments": [
        {
          "name": "scene",
          "description": "Scene identifier",
          "required": true
        },
        {
          "name": "query",
          "description": "Search query",
          "required": true
        }
      ],
      "handler": "autoimprove-summarizer.searchLessons"
    },
    {
      "name": "autoimprove-status",
      "description": "Show AutoImprove status",
      "handler": "autoimprove-summarizer.status"
    }
  ]
}


4. 存储设计

4.1 目录结构


~/.autoimprove/
├── config.json                 # 全局配置
├── rules/                     # 规则库
│   ├── project.md            # 项目约定
│   ├── anti-patterns.md     # 踩坑记录
│   └── preferences.md       # 用户偏好
├── lessons/                  # 场景化知识库
│   ├── react/
│   │   ├── latest.md
│   │   └── 2026-01-21-session-abc.md
│   ├── auth/
│   │   ├── latest.md
│   │   └── 2026-01-20-session-def.md
│   └── api/
│       └── latest.md
├── sessions/                # 会话存档
│   ├── abc.json
│   └── def.json
└── cache/                  # 临时缓存
    └── embeddings/         # 向量缓存（可选）


4.2 规则文件格式

# AutoImprove Rules: React

## Project Conventions
- Use functional components with hooks
- Prefer named exports over default exports
- Keep components under 200 lines
- Use TypeScript strict mode

## Anti-Patterns (Learned from Sessions)
### 2026-01-21: Direct State Mutation
**Problem**: Modified state directly instead of using setter
**Rule**: Always use state setters, never mutate state objects
**Confidence**: 0.95 (seen 3 times)

### 2026-01-20: Missing Dependency Array
**Problem**: useEffect missing dependencies caused infinite loops
**Rule**: Always include all dependencies in useEffect dependency array
**Confidence**: 0.88 (seen 2 times)

## User Preferences
- Prefer composition over inheritance
- Write tests alongside components
- Use explicit return types for functions


5. 安装与配置

5.1 一键安装

# 安装 AutoImprove
npx create-autoimprove@latest

# 或手动安装
npm install -g autoimprove
autoimprove init


5.2 项目配置

// .autoimprove.json (项目级配置)
{
  "version": "0.1.0",
  "scenes": {
    "react": {
      "description": "React frontend development",
      "auto_detect": ["react", "jsx", "tsx"],
      "rules_files": ["project.md", "anti-patterns.md"]
    },
    "auth": {
      "description": "Authentication and authorization",
      "auto_detect": ["auth", "jwt", "login"],
      "rules_files": ["security.md", "patterns.md"]
    }
  },
  "mcp_server": {
    "command": "autoimprove-server",
    "args": [],
    "env": {}
  },
  "confirmation_required": true,
  "max_rules_per_session": 5
}


5.3 Claude Code 集成

// .claude/settings.json
{
  "mcpServers": {
    "autoimprove": {
      "command": "autoimprove-server",
      "args": [],
      "env": {}
    }
  },
  "plugins": [
    "./plugins/autoimprove"
  ]
}


6. 使用示例

6.1 基础使用

# 在当前会话中
> refactor auth logic
> fix tests
> /autoimprove-summarize auth


Claude 响应：

📊 Analyzing session (scene: auth)...

Detected patterns:
1. Repeated amend-loop on token refresh logic (confidence: 0.92)
2. Direct Prisma client usage (confidence: 0.85)
3. Missing error handling in API routes (confidence: 0.78)

Existing rules found:
- anti-patterns.md: "Never edit Prisma schema without migration"

Proposed new rules:

### Auth: Token Refresh Pattern
Always use `refreshToken()` helper; never inline JWT decode.
Reason: 3 amend-loops in session 2026-01-21

### Auth: API Error Handling
Wrap all API calls with try-catch; return structured errors.
Reason: Missing error handling in 2 similar sessions

Add these rules? [y/N]


6.2 知识查询

> /autoimprove-lessons auth "token refresh"


Claude 响应：

🔍 Searching lessons for scene 'auth'...

Found 3 relevant lessons:

1. **Token Refresh Pattern** (confidence: 0.92)
   Always use `refreshToken()` helper; never inline JWT decode.
   Source: 2026-01-21-session-abc.md

2. **JWT Expiry Handling** (confidence: 0.85)
   Check token expiry 5 minutes before actual expiry.
   Source: 2026-01-20-session-def.md

3. **Refresh Token Rotation** (confidence: 0.78)
   Rotate refresh tokens on each successful refresh.
   Source: 2026-01-19-session-ghi.md


7. 开发路线图

Phase 1 (v0.1.0) - MVP
MCP Server 基础框架

会话分析和规则生成

基础斜杠命令

文件系统存储

Phase 2 (v0.2.0) - 增强功能
向量搜索 (sqlite-vec)

规则去重和合并算法

多场景支持

规则置信度计算

Phase 3 (v0.3.0) - 协作功能
规则导出/导入

团队共享规则库

Git 集成 (自动提交规则变更)

Web UI 管理界面

Phase 4 (v1.0.0) - 生态集成
VS Code 扩展

Cursor/Windsurf 兼容

CI/CD 集成

企业级功能

8. 技术风险与应对

风险 影响 应对措施

规则冲突 中 置信度评分 + 用户确认

隐私泄露 高 本地存储 + 敏感信息过滤

性能问题 低 异步处理 + 缓存

误生成规则 中 严格的去重算法 + 人工审核

9. 贡献指南

# Contributing to AutoImprove

## Development Setup
1. Clone the repository
2. Install dependencies: `pnpm install`
3. Build packages: `pnpm build`
4. Run tests: `pnpm test`

## Package Structure
- `packages/autoimprove-core`: MCP Server
- `packages/autoimprove-skill`: Skill implementation
- `packages/autoimprove-plugin`: Claude Code plugin
- `packages/create-autoimprove`: 一键安装工具

## Testing
- Unit tests: `pnpm test:unit`
- Integration tests: `pnpm test:integration`
- E2E tests: `pnpm test:e2e`


10. 许可证与治理

• License: MIT

• Governance: 社区驱动，核心团队维护

• Code of Conduct: Contributor Covenant

• Security: 负责任披露政策

这个方案涵盖了从架构设计到具体实现的完整技术细节。你可以直接使用这个方案作为开发蓝图，或者根据具体需求进行调整。需要我进一步细化某个部分吗？比如 MCP Server 的具体实现代码，或者 Skill 的详细逻辑？
