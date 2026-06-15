# GitHub Actions 设置指南

本文档说明如何为 AutoImprove 项目配置 GitHub Actions 工作流。

## 📋 工作流概述

我们创建了以下两个 GitHub Actions 工作流：

### 1. CI 工作流 (`.github/workflows/ci.yml`)

**触发条件：**
- 推送到 `main`、`master`、`develop` 分支
- 针对这些分支的 Pull Request

**执行任务：**
- ✅ 多版本 Node.js 测试 (18.x, 20.x, 22.x)
- ✅ 项目构建
- ✅ 运行测试
- ✅ 代码 lint 检查
- ✅ TypeScript 类型检查
- ✅ 安全漏洞审计

### 2. 发布工作流 (`.github/workflows/publish.yml`)

**触发条件：**
- 推送到 `main` 或 `master` 分支（且版本号变更时）
- 推送版本标签 (`v*`)
- 手动触发 (workflow_dispatch)

**执行任务：**
- ✅ 构建项目
- ✅ 运行测试
- ✅ 发布到 npm
- ✅ 创建 GitHub Release（仅限标签触发）

## 🔧 配置步骤

### 步骤 1: 更新 package.json

首先，更新 `package.json` 中的仓库信息：

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_USERNAME/autoimprove.git"
  },
  "bugs": {
    "url": "https://github.com/YOUR_USERNAME/autoimprove/issues"
  },
  "homepage": "https://github.com/YOUR_USERNAME/autoimprove#readme"
}
```

将 `YOUR_USERNAME` 替换为您的 GitHub 用户名。

### 步骤 2: 创建 npm 访问令牌

1. **登录 npm**：
   ```bash
   npm login
   ```

2. **创建访问令牌**：
   - 访问 [npm token 页面](https://www.npmjs.com/settings/tokens)
   - 点击 "Generate New Token"
   - 选择 "Granular Access Token"
   - 设置权限：
     - ✅ Read and write
     - 选择 `autoimprove` 包（或允许所有包）
   - 设置过期时间（建议：无过期）
   - 点击 "Generate Token"
   - **复制令牌**（只显示一次！）

### 步骤 3: 配置 GitHub Secret

1. **进入 GitHub 仓库设置**：
   - 访问 `https://github.com/YOUR_USERNAME/autoimprove/settings`
   - 点击 "Secrets and variables" → "Actions"

2. **添加 NPM_TOKEN**：
   - 点击 "New repository secret"
   - Name: `NPM_TOKEN`
   - Secret: 粘贴您的 npm 访问令牌
   - 点击 "Add secret"

3. **配置环境（可选但推荐）**：
   - 进入 "Environments" 设置
   - 创建名为 `npm` 的环境
   - 添加保护规则（如需要审批）

### 步骤 4: 推送代码到 GitHub

```bash
# 初始化 Git 仓库（如果还没有）
git init
git remote add origin https://github.com/YOUR_USERNAME/autoimprove.git

# 添加所有文件
git add .

# 提交
git commit -m "feat: add GitHub Actions workflows"

# 推送到 main 分支
git branch -M main
git push -u origin main
```

### 步骤 5: 验证工作流

1. **检查 CI 工作流**：
   - 进入 GitHub 仓库
   - 点击 "Actions" 标签
   - 查看 "CI - Build, Test & Lint" 工作流是否运行

2. **检查发布工作流**（需要版本变更）：
   - 修改 `package.json` 中的版本号
   - 提交并推送
   - 查看 "Publish to npm" 工作流是否触发

## 🚀 发布流程

### 自动发布（推荐）

1. **更新版本号**：
   ```bash
   # 修补版本 (0.2.0 → 0.2.1)
   npm version patch

   # 次要版本 (0.2.0 → 0.3.0)
   npm version minor

   # 主要版本 (0.2.0 → 1.0.0)
   npm version major
   ```

2. **更新 CHANGELOG.md**（记录本次变更）

3. **提交并推送**：
   ```bash
   git push origin main --follow-tags
   ```

4. **GitHub Actions 会自动**：
   - 运行 CI 检查
   - 发布到 npm
   - 创建 GitHub Release

### 手动发布（紧急情况）

如果需要手动发布：

```bash
# 构建和测试
npm run build && npm test

# 发布到 npm
npm publish

# 创建 Git 标签
git tag v0.2.1
git push origin v0.2.1
```

## 🔍 常见问题

### CI 检查失败

**问题**: CI 工作流失败

**解决方法**:
1. 检查日志，查看具体错误
2. 在本地重现问题：
   ```bash
   npm ci
   npm run build
   npm test
   npm run lint
   ```
3. 修复问题并提交

### npm 发布失败

**问题**: "401 Unauthorized" 或 "403 Forbidden"

**解决方法**:
1. 检查 `NPM_TOKEN` secret 是否正确
2. 确认令牌未过期
3. 确认令牌有正确的权限
4. 尝试重新生成令牌

### 版本未自动发布

**问题**: 推送到 main 后未触发发布

**原因**: 发布工作流只在版本号变更时触发

**解决方法**:
1. 确认 `package.json` 中的版本号已变更
2. 检查 `check-version` job 的输出
3. 手动触发工作流（使用 workflow_dispatch）

## 📊 工作流徽章

README.md 中已经添加了以下徽章：

```markdown
[![CI](https://github.com/yourusername/autoimprove/actions/workflows/ci.yml/badge.svg)](https://github.com/yourusername/autoimprove/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/yourusername/autoimprove/actions/workflows/publish.yml/badge.svg)](https://github.com/yourusername/autoimprove/actions/workflows/publish.yml)
[![npm version](https://badge.fury.io/js/autoimprove.svg)](https://www.npmjs.com/package/autoimprove)
```

**记得将 `yourusername` 替换为您的 GitHub 用户名！**

## 🔗 相关链接

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [npm 发布文档](https://docs.npmjs.com/cli/v10/commands/npm-publish)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [语义化版本](https://semver.org/lang/zh-CN/)

## 📞 需要帮助？

如果遇到问题，请：
1. 查看 [GitHub Actions 日志](https://github.com/YOUR_USERNAME/autoimprove/actions)
2. 在 [Issues](https://github.com/YOUR_USERNAME/autoimprove/issues) 中搜索类似问题
3. 创建新的 Issue，附带详细错误信息
