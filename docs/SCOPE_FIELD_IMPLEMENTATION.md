# Rule Scope Field Implementation

## 概述

为了让 LLM 能够判断规则的适用范围，我们在规则生成系统中添加了 **scope（作用域）** 字段。Scope 帮助系统区分规则的应用级别：全局通用原则、组织特定约定、还是项目特定实现。

## Scope 枚举值

系统中定义了三个明确的作用域级别（`models.ts`）：

```typescript
export enum RuleScope {
  GLOBAL = "global",           // 通用编程原则
  ORGANIZATION = "organization", // 公司/团队特定约定
  PROJECT = "project"          // 项目特定实现
}
```

### 1. **global** - 全局通用规则

**定义：** 适用于所有编程语言、框架和项目的通用编程原则

**示例：**
- "在处理前验证用户输入" - 安全基本原则
- "使用有意义的变量名" - 代码可读性原则
- "优雅处理错误" - 错误处理最佳实践
- "避免硬编码魔法数字" - 代码维护性原则

**判断标准：**
- 引用通用概念（输入验证、错误处理、命名约定）
- 不提及特定库、框架或项目结构
- 可以在任何语言/项目中应用
- 基于基础的软件工程原则

### 2. **organization** - 组织级规则

**定义：** 公司/团队特定的框架、约定或架构模式

**示例：**
- "使用公司 auth 中间件保护路由" - 公司标准库
- "遵循团队的 React 组件结构" - 团队约定
- "用 CompanyLogger 记录所有 API 调用" - 公司工具
- "遵循团队的 Git 提交消息格式" - 团队规范

**判断标准：**
- 提及 "公司"、"团队"、"我们的"
- 引用特定框架模式（约定但非通用）
- 提及共享库或组织标准
- 可应用于组织内多个项目，但不是通用原则

### 3. **project** - 项目级规则

**定义：** 特定于当前项目的实现细节、文件路径或本地约定

**示例：**
- "从 src/types/common.ts 导入类型" - 特定文件路径
- "使用 ProjectConfig 单例获取设置" - 项目特定类
- "调用 /api/v2/users 端点获取用户数据" - 项目 API
- "在 migrations/ 目录下添加数据库迁移文件" - 项目目录结构

**判断标准：**
- 提及特定文件路径（src/types/common.ts）
- 引用项目特定类名（ProjectConfig、UserService）
- 提及本地实现细节
- 引用此代码库独有的代码

## LLM Prompt 更新

### 输出格式要求

在 `llm-prompt-builder.ts` 的 `buildOutputFormat()` 方法中，我们添加了明确的 scope 字段要求：

```json
{
  "title": "...",
  "description": "...",
  "rationale": "...",
  "scope": "global",  // 必需字段
  "how_to_apply": [...],
  "when_to_use": [...],
  "exceptions": [...]
}
```

### Scope 判断指南

Prompt 中包含了详细的判断逻辑：

```markdown
## Scope Determination

REQUIRED: Every rule must include a "scope" field with one of these exact values:

**"global"**: Universal prong principles...
**"organization"**: Company/team-specific frameworks...
**"project"**: Specific to current project's implementation...

**How to decide:**
1. If the rule would apply to ANY project in ANY language → "global"
2. If the rule requires your company's framework/conventions → "organization"
3. If the rule references specific files/classes unique to this project → "project"

When in doubt, choose the BROADEST applicable scope.
```

### 示例对比

| 规则描述 | Scope | 原因 |
|---------|-------|------|
| "Always validate user input before processing" | `global` | 通用安全原则，适用所有项目 |
| "Use CompanyAuth middleware for protected routes" | `on` | 公司特定中间件，多项目共享 |
| "Import types from src/types/common.ts" | `project` | 特定文件路径，仅此项目 |
| "Handle errors with try-catch blocks" | `global` | 通用错误处理模式 |
| "Follow team's React component structure (Container/Presenter)" | `organization` | 团队约定，非 React 官方标准 |
| "Use ProjectConfig.get() to access settings" | `project` | 项目特定单例类 |

## 代码实现

### 1. GeneratedRule 接口更新

```typescript
export interface GeneratedRule {
  id: string;
  title: string;
  description: string;
  rationale: string;
  scope: "global" | "organization" | "project";  // 新增字段
  how_to_apply: string[];
  // ... 其他字段
}
```

### 2. 解析逻辑（llm-rule-generator.ts）

```typescript
private parseRuleResponse(response: string): {
  // ...
  scope: "global" | "organization" | "project";
} {
  const parsed = JSON.parse(jsonStr);

  // 验证并标准化 scope 字段
  const validScopes = ["global", "organization", "project"];
  let scope: "global" | "organization" | "project";

  if (!parsed.scope) {
    logger.warn("Missing scope field, defaulting to 'global'");
    scope = "global";
  } else if (!validScopes.includes(parsed.scope)) {
    logger.warn(`Invalid scope '${parsed.scope}', defaulting to 'global'`);
    scope = "global";
  } else {
    scope = parsed.scope;
  }

  return {
    // ...
    scope: scope,
  };
}
```

**错误处理：**
- 如果 LLM 未返回 scope 字段 → 默认为 `"global"`
- 如果 LLM 返回无效值 → 默认为 `"global"` 并记录警告
- 记录到日志便于追踪 LLM 是否正确理解 scope 要求

### 3. 存储格式转换

```typescript
convertToStorageFormat(rule: GeneratedRule): {
  indexEntry: RuleIndexEntry;
  content: RuleContent;
} {
  const indexEntry: RuleIndexEntry = {
    id: rule.id,
    // ...
    scope: rule.scope as RuleScope  // 转换为 RuleScope 枚举
  };

  // content 不包含 scope（仅在 index 中用于匹配）
  const content: RuleContent = {
    id: rule.id,
    content: formattedContent,
    // ... scope 不在 content 中
  };

  return { indexEntry, content };
}
```

**设计决策：**
- **Scope 存储在 `indexEntry` 中**：用于规则匹配和过滤
- **Scope 不存储在 `content` 中**：content 是全文内容，不需要结构化字段

### 4. RuleIndexEntry 结构

```typescript
export interface RuleIndexEntry {
  id: string;
  type: PatternType;
  priority: Priority;
  confidence: number;
  scenes: Scene;
  keywords: string[];
  created_at: string;
  updated_at: string;
  scope?: RuleScope;           // 规则适用范围
  scope_context?: {            // 额外作用域元数据
    organization_id?: string;  // 例如：公司域名、组织标识
    project_id?: string;       // 例如：项目名、仓库路径
    project_path?: string;     // 学习该规则的项目绝对路径
  };
}
```

## 测试覆盖

创建了 `tests/scope-parsing.test.ts`，包含 10 个测试用例：

### 测试覆盖场景

1. ✅ 解析有效的 `"global"` scope
2. ✅ 解析有效的 `"organization"` scope
3. ✅ 解析有效的 `"project"` scope
4. ✅ Scope 缺失时默认为 `"global"`
5. ✅ Scope 无效时默认为 `"global"`
6. ✅ 处理 markdown 代码块中的 scope
7. ✅ `convertToStorageFormat()` 包含 scope
8. ✅ 存储格式处理 `"global"` scope
9. ✅ 存储格式处理 `"project"` scope
10. ✅ Content 不包含 scope（仅 index 包含）

### 运行测试

```bash
npm test -- tests/scope-parsing.test.ts

# 结果：10 passed (10)
```

## 应用场景

### 1. 规则过滤

根据 scope 过滤规则：

```typescript
// 只加载 global 和 organization 级别的规则
const rules = allRules.filter(r => 
  r.scope === RuleScope.GLOBAL || 
  r.scope === RuleScope.ORGANIZATION
);
```

### 2. 规则匹配优先级

```typescript
// Project scope 规则优先级最高（最具体）
function calculateRelevance(rule: RuleIndexEntry): number {
  let score = baseScore;
  
  if (rule.scope === RuleScope.PROJECT) {
    score += 0.3;  // 项目特定规则加分
  } else if (rule.scope === RuleScope.ORGANIZATION) {
    score += 0.2;  // 组织规则次之
  } else {
    score += 0.1;  // 全局规则基础分
  }
  
  return score;
}
```

### 3. 跨项目共享

```typescript
// 导出 global + organization 规则供其他项目使用
function exportSharedRules(): RuleIndexEntry[] {
  return rules.filter(r => 
    r.scope === RuleScope.GLOBAL || 
    r.scope === RuleScope.ORGANIZATION
  );
}

// 只保留当前项目的 project 规则
function exportProjectRules(projectPath: string): RuleIndexEntry[] {
  return rules.filter(r => 
    r.scope === RuleScope.PROJECT &&
    r.scope_context?.project_path === projectPath
  );
}
```

### 4. 规则导出到 claude-index.md

```typescript
// 不同 scope 显示不同标签
function formatRuleForClaudeIndex(rule: RuleIndexEntry): string {
  const scopeLabel = {
    global: "[Global]",
    organization: "[Org]",
    project: "[Project]"
  }[rule.scope || "global"];
  
  return `${scopeLabel} ${rule.id}: ${rule.title}`;
}

// 输出示例：
// [Global] rule-001: Validate user input before processing
// [Org] rule-002: Use CompanyAuth middleware for protected routes
// [Project] rule-003: Import types from src/types/common.ts
```

## 向后兼容

### 处理旧规则

```typescript
// 旧规则没有 scope 字段时，默认为 "global"
function loadRuleIndex(): RuleIndex {
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  
  index.rules.forEach(rule => {
    if (!rule.scope) {
      rule.scope = RuleScope.GLOBAL;  // 向后兼容
    }
  });
  
  return index;
}
```

### 迁移策略

1. **新规则**：LLM 自动生成 scope 字段
2. **旧规则**：加载时默认为 `"global"`
3. **手动规则**：用户可手动编辑 `rules/index.json` 指定 scope

## 未来扩展

### 1. Scope Context

```typescript
// 为 organization scope 添加组织信息
{
  "scope": "organization",
  "scope_context": {
    "organization_id": "company.com",
    "team": "frontend"
  }
}

// 为 project scope 添加项目路径
{
  "scope": "project",
  "scope_context": {
    "project_id": ove",
    "project_path": "/Users/ada/workspace/autoimprove"
  }
}
```

### 2. 跨项目规则同步

```typescript
// 自动同步 organization 规则到团队其他项目
function syncOrganizationRules() {
  const orgRules = rules.filter(r => r.scope === RuleScope.ORGANIZATION);
  
  // 推送到团队共享规则库
  uploadToTeamRuleRepository(orgRules);
}
```

### 3. Scope 验证工具

```bash
# CLI 工具验证规则 scope 是否正确
./autoimprove-cli validate-scopes

# 输出：
# ✓ rule-001 (global): Correctly scoped - no project-specific refs
# ⚠ rule-002 (organization): May be 'project' - references src/auth/middleware.ts
# ✗ rule-003 (global): Should be 'project' - references ProjectConfig class
```

## 总结

通过添加 **scope** 字段，我们实现了：

1. ✅ **明确的作用域枚举** - 三个清晰的级别：global/organization/project
2. ✅ **LLM Prompt 指导** - 详细的判断逻辑和示例帮助 LLM 正确分类
3. ✅ **完整的解析和验证** - 处理缺失/无效值，默认为 "global"
4. ✅ **存储集成** - Scope 存储在 indexEntry 中用于匹配
5. ✅ **测试覆盖** - 10 个测试用例验证各种场景
6. ✅ **向后兼容** - 旧规则自动默认为 "global"
7. ✅ **扩展性** - 支持 scope_context 存储额外元数据

现在 LLM 生成的每条规则都会包含明确的作用域信息，帮助系统更精准地匹配和应用规则。
