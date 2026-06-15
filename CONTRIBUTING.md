# Contributing to AutoImprove

Thank you for your interest in contributing to AutoImprove! This document provides guidelines and instructions for contributing.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)

## 📖 Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md) (if available).

## 🚀 Getting Started

### Prerequisites

- **Node.js 18+** - [Download & Install](https://nodejs.org/)
- **Git** - [Download & Install](https://git-scm.com/)
- **Claude Code** - For testing MCP server integration

### Development Setup

1. **Fork the repository** on GitHub

2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/autoimprove.git
   cd autoimprove
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Build the project**:
   ```bash
   npm run build
   ```

5. **Run tests**:
   ```bash
   npm test
   ```

6. **Set up Claude Code integration** (for testing):
   ```bash
   ./setup.sh
   ```

### IDE Setup

We recommend using **Visual Studio Code** with the following extensions:
- ESLint
- Prettier
- TypeScript extension

## 💻 Development Workflow

### Branch Naming Convention

- `feature/xxx` - New features
- `fix/xxx` - Bug fixes
- `docs/xxx` - Documentation updates
- `refactor/xxx` - Code refactoring
- `test/xxx` - Test improvements

### Making Changes

1. **Create a new branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**

3. **Run type checking**:
   ```bash
   npm run build
   cd src/mcp-server-ts && npx tsc --noEmit
   ```

4. **Run linter**:
   ```bash
   npm run lint
   ```

5. **Run tests**:
   ```bash
   npm test
   ```

6. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add your feature"
   ```

   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `docs:` - Documentation changes
   - `style:` - Code style changes (formatting, etc.)
   - `refactor:` - Code refactoring
   - `test:` - Test updates
   - `chore:` - Build process or auxiliary tool changes

### Project Structure

```
autoimprove/
├── bin/                      # CLI entry point
│   └── autoimprove.js
├── src/
│   ├── cli/                  # CLI implementation
│   │   ├── commands/         # Command implementations
│   │   └── index.ts          # Commander.js setup
│   ├── mcp-server-ts/        # MCP server (TypeScript)
│   │   └── src/
│   │       ├── tools/        # MCP tools
│   │       └── index.ts      # Server entry
│   └── skills-ts/            # Claude Code skills
│       └── src/
├── templates/                # Template files
├── lib/                      # Compiled output (CLI)
├── dist/                     # Compiled output (MCP server)
└── package.json
```

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
cd src/mcp-server-ts && npm test -- --watch

# Run tests with coverage
cd src/mcp-server-ts && npm test -- --coverage
```

### Writing Tests

We use **Jest** for testing. Please write tests for:
- New features
- Bug fixes
- Edge cases

Test files should be co-located with the source files:
```
src/mcp-server-ts/src/tools/
├── analyze-session.ts
└── analyze-session.test.ts
```

### Test Coverage

Aim for **>80% test coverage** for new code.

## 📤 Pull Request Process

### Before Creating a PR

1. **Ensure all tests pass**:
   ```bash
   npm test
   npm run lint
   ```

2. **Update documentation** if needed

3. **Update CHANGELOG.md** with your changes

### Creating a PR

1. **Push your branch** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create a Pull Request** on GitHub

3. **Fill out the PR template** (if available)

4. **Link related issues** in the PR description

### PR Review Process

- All PRs must pass **CI checks** (GitHub Actions)
- At least **1 approval** is required
- Address all **review comments**

### After PR is Merged

- Delete your feature branch
- Pull latest changes from main
- Update your fork

## 🚢 Release Process

### Automated Release (Recommended)

The release process is **automated** via GitHub Actions:

1. **Update version** in `package.json`:
   ```bash
   npm version patch  # or minor, or major
   ```

2. **Update CHANGELOG.md** with the new version changes

3. **Commit and push** the version change:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: release v0.2.1"
   git push origin main
   ```

4. **GitHub Actions will automatically**:
   - Run CI checks (build, test, lint)
   - Publish to npm
   - Create a GitHub Release

### Manual Release (For Maintainers)

If needed, you can manually publish:

```bash
# Build and test
npm run build && npm test

# Publish to npm
npm publish

# Create Git tag
git tag v0.2.1
git push origin v0.2.1
```

## 🐛 Reporting Bugs

Please use the [GitHub Issues](https://github.com/yourusername/autoimprove/issues) tracker.

Include:
- Node.js version
- OS version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs

## 💡 Suggesting Enhancements

We welcome feature suggestions! Please:
1. Check existing issues to avoid duplicates
2. Create a new issue with the **enhancement** label
3. Describe the feature and its use case

## 📞 Questions?

Feel free to:
- Open a [Discussion](https://github.com/yourusername/autoimprove/discussions)
- Reach out to maintainers

Thank you for contributing to AutoImprove! 🎉
