# AutoImprove NPM Package 改造方案

## 🎯 目标

将 AutoImprove 改造成可通过 `npm install -g autoimprove` 全局安装的包。

## 📊 当前结构分析

### 现状
```
autoimprove/
├── src/
│   ├── mcp-server-ts/     # 独立的 package.json
│   └── skills-ts/         # 独立的 package.json
├── scripts/               # 工具脚本
├── templates/             # 模板文件
├── setup.sh              # 手动安装脚本
└── (无根 package.json)
```

### 问题
1. ❌ 无根 package.json，无法作为 npm 包发布
2. ❌ 多个子包，结构复杂
3. ❌ 依赖手动执行 setup.sh
4. ❌ 无全局可执行命令
5. ❌ 构建过程分散

---

## 🏗️ 改造方案

### 方案 A：Monorepo 结构（推荐用于复杂项目）

**优点**：
- ✅ 保持模块化
- ✅ 可独立发布子包
- ✅ 适合后续扩展

**缺点**：
- ⚠️ 配置复杂
- ⚠️ 用户安装步骤多

**结构**：
```
autoimprove/
├── package.json                    # 根包（聚合）
├── packages/
│   ├── cli/                       # 新增：CLI 入口
│   │   ├── package.json
│   │   └── bin/
│   │       └── autoimprove.js
│   ├── mcp-server/                # 原 src/mcp-server-ts
│   │   └── package.json
│   └── skills/                    # 原 src/skills-ts
│       └── package.json
└── lerna.json / pnpm-workspace.yaml
```

**安装方式**：
```bash
npm install -g autoimprove-cli
# 或
npm install -g @autoimprove/cli
```

---

### 方案 B：单包结构（推荐，简单直接）⭐

**优点**：
- ✅ 简单直接
- ✅ 一条命令安装
- ✅ 易于发布和维护

**缺点**：
- ⚠️ 所有代码打包在一起
- ⚠️ 单一版本号

**结构**：
```
autoimprove/
├── package.json                    # 根包（唯一）
├── bin/
│   └── autoimprove.js             # CLI 入口
├── lib/                           # 编译后的代码
│   ├── mcp-server/
│   └── skills/
├── src/                           # 源代码
│   ├── mcp-server/
│   ├── skills/
│   └── cli/                       # 新增：CLI 逻辑
├── templates/
└── scripts/
```

**安装方式**：
```bash
npm install -g autoimprove
autoimprove setup    # 等价于原来的 setup.sh
autoimprove status
autoimprove summarize
```

---

## 📦 方案 B 详细实施步骤（推荐）

### 1. 创建根 package.json

```json
{
  "name": "autoimprove",
  "version": "0.2.0",
  "description": "Learn coding patterns from Claude Code sessions and auto-apply rules",
  "author": "Your Name <your.email@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/autoimprove.git"
  },
  "keywords": [
    "claude",
    "mcp",
    "ai",
    "code-analysis",
    "patterns",
    "rules",
    "autoimprove"
  ],
  "engines": {
    "node": ">=18.0.0"
  },
  "bin": {
    "autoimprove": "./bin/autoimprove.js"
  },
  "main": "./lib/index.js",
  "types": "./lib/index.d.ts",
  "files": [
    "bin/",
    "lib/",
    "templates/",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "prebuild": "npm run clean",
    "build": "tsc -p tsconfig.build.json",
    "clean": "rm -rf lib",
    "prepare": "npm run build",
    "test": "vitest run",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4",
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8",
    "eslint": "^8.0.0"
  }
}
```

### 2. 创建 CLI 入口

**`bin/autoimprove.js`**:
```javascript
#!/usr/bin/env node
require('../lib/cli/index.js');
```

**`src/cli/index.ts`**:
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { setup } from './commands/setup';
import { status } from './commands/status';
import { summarize } from './commands/summarize';
import { rules } from './commands/rules';

const program = new Command();

program
  .name('autoimprove')
  .description('Learn coding patterns from Claude Code sessions')
  .version('0.2.0');

program
  .command('setup')
  .description('Install and configure AutoImprove')
  .option('--force', 'Force reinstall')
  .action(setup);

program
  .command('status')
  .description('Check AutoImprove system health')
  .action(status);

program
  .command('summarize')
  .description('Analyze Claude Code sessions')
  .option('--all', 'Analyze all sessions')
  .option('--enhance', 'Use AI enhancement')
  .action(summarize);

program
  .command('rules')
  .description('Manage knowledge rules')
  .option('--category <type>', 'Filter by category')
  .action(rules);

program.parse();
```

### 3. 整合构建配置

**`tsconfig.build.json`**:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./lib",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": [
    "src/**/*"
  ],
  "exclude": [
    "node_modules",
    "**/*.test.ts",
    "**/*.spec.ts"
  ]
}
```

### 4. 目录重组

```bash
# 当前
src/mcp-server-ts/src/  → src/mcp-server/
src/skills-ts/src/      → src/skills/

# 新增
src/cli/
  ├── index.ts
  ├── commands/
  │   ├── setup.ts
  │   ├── status.ts
  │   ├── summarize.ts
  │   └── rules.ts
  └── utils/
```

### 5. 实现 setup 命令

**`src/cli/commands/setup.ts`**:
```typescript
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export async function setup(options: { force?: boolean }) {
  console.log('🚀 Setting up AutoImprove...\n');

  // 1. Check Claude Code CLI
  if (!await hasClaudeCLI()) {
    console.error('❌ Claude Code CLI not found');
    console.error('   Install from: https://claude.ai/download');
    process.exit(1);
  }

  // 2. Initialize storage
  const storageDir = join(homedir(), '.autoimprove');
  if (!existsSync(storageDir) || options.force) {
    await initStorage(storageDir);
  }

  // 3. Configure MCP server
  await configureMCPServer();

  // 4. Install skills
  await installSkills();

  // 5. Configure Claude.md
  await configureClaudeMd();

  console.log('\n✅ Setup complete!');
  console.log('Run: autoimprove status');
}

// ... 实现各个函数
```

### 6. 更新 .npmignore

```
# Source files (only ship compiled lib/)
src/
tsconfig*.json
vitest.config.ts

# Development
.git/
.github/
.vscode/
.idea/
*.log
node_modules/

# Documentation (keep README, remove others)
docs/
openspec/
prototype/
CLAUDE.md
*.md
!README.md

# Scripts
debug.sh
uninstall.sh
setup.sh

# Build artifacts
dist/
*.tsbuildinfo

# Tests
**/*.test.ts
**/*.spec.ts
tests/

# Environment
.env*
```

### 7. 发布前检查清单

```bash
# 1. 测试构建
npm run build

# 2. 测试本地安装
npm link
autoimprove --version
autoimprove --help

# 3. 测试功能
autoimprove setup
autoimprove status

# 4. 取消本地链接
npm unlink -g

# 5. 测试打包
npm pack
# 检查生成的 autoimprove-0.2.0.tgz 内容
tar -tzf autoimprove-0.2.0.tgz

# 6. 发布到 npm (首次需要登录)
npm login
npm publish

# 如果包名已被占用，可以使用 scoped package
npm publish --access public
# 包名改为: @yourusername/autoimprove
```

---

## 🚀 发布后的用户体验

### 安装
```bash
# 全局安装
npm install -g autoimprove

# 或使用 npx (无需全局安装)
npx autoimprove setup
```

### 使用
```bash
# 首次配置
autoimprove setup

# 日常使用
autoimprove status
autoimprove summarize --enhance
autoimprove rules --category security

# 查看帮助
autoimprove --help
autoimprove summarize --help
```

### 升级
```bash
npm update -g autoimprove
```

### 卸载
```bash
npm uninstall -g autoimprove
# 可选：清理配置
rm -rf ~/.autoimprove ~/.claude/skills/autoimprove-*
```

---

## 📋 实施清单

### Phase 1: 结构调整
- [ ] 创建根 package.json
- [ ] 移动 src 目录结构
- [ ] 创建 bin/ 目录和 CLI 入口
- [ ] 创建统一的 tsconfig.build.json

### Phase 2: CLI 开发
- [ ] 实现 src/cli/index.ts (Commander.js)
- [ ] 实现 setup 命令
- [ ] 实现 status 命令
- [ ] 实现 summarize 命令
- [ ] 实现 rules 命令

### Phase 3: 整合构建
- [ ] 合并子包的 dependencies
- [ ] 实现统一构建脚本
- [ ] 测试构建产物

### Phase 4: 发布准备
- [ ] 创建 .npmignore
- [ ] 更新 README.md (添加 npm 安装说明)
- [ ] 添加 CHANGELOG.md
- [ ] 设置 GitHub repository

### Phase 5: 测试发布
- [ ] npm link 本地测试
- [ ] npm pack 检查打包内容
- [ ] 发布到 npm (或先发布到私有 registry 测试)

---

## 💡 额外建议

### 1. 使用 Scoped Package
如果 `autoimprove` 包名已被占用：
```json
{
  "name": "@yourusername/autoimprove"
}
```

用户安装：
```bash
npm install -g @yourusername/autoimprove
```

### 2. 提供多种安装方式

**通过 npx（无需全局安装）**:
```bash
npx @yourusername/autoimprove setup
```

**通过 GitHub**:
```bash
npm install -g github:yourusername/autoimprove
```

### 3. CI/CD 自动发布

**`.github/workflows/publish.yml`**:
```yaml
name: Publish to NPM
on:
  release:
    types: [created]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 4. 添加 postinstall 提示

```json
{
  "scripts": {
    "postinstall": "node scripts/postinstall.js"
  }
}
```

**`scripts/postinstall.js`**:
```javascript
console.log(`
✨ AutoImprove installed successfully!

📖 Get started:
   autoimprove setup

📚 Documentation:
   https://github.com/yourusername/autoimprove

💬 Need help?
   autoimprove --help
`);
```

---

## 🔄 向后兼容

保留 `setup.sh` 作为备用方案：
```bash
# NPM 方式（推荐）
npm install -g autoimprove
autoimprove setup

# 手动方式（向后兼容）
git clone https://github.com/yourusername/autoimprove
cd autoimprove
./setup.sh
```

---

## 📊 预期效果对比

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 安装步骤 | 5步（clone, npm install × 2, build × 2, setup.sh） | 1步（npm install -g） |
| 用户体验 | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| 可发现性 | ❌ 需要 GitHub | ✅ NPM registry |
| 升级便利性 | ⚠️ 手动 git pull + rebuild | ✅ npm update |
| 分发方式 | GitHub only | NPM + GitHub |

---

## 🎯 推荐行动计划

**Week 1**: Phase 1-2（结构调整 + CLI 开发）
**Week 2**: Phase 3-4（构建整合 + 发布准备）
**Week 3**: Phase 5（测试 + 发布）

**首次发布建议**: 
- 先发布为 `0.2.0-beta.1`
- 征集用户反馈
- 修复问题后发布正式版 `0.2.0`
