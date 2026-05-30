# MCP Server 自动启动配置

## 概述

Claude Code 会在需要时自动启动和管理 MCP Server。你只需要配置一次，之后 MCP Server 会在 Claude Code 启动时自动运行。

## 前置准备

### 1. 获取项目路径

```bash
# 进入项目目录
cd /path/to/autoimprove

# 获取绝对路径
pwd
# 输出示例: /home/user/projects/autoimprove
```

记下这个路径，后续配置中将用 `<PROJECT_ROOT>` 表示。

### 2. 安装依赖

```bash
cd <PROJECT_ROOT>/src/mcp-server
pip install -e .
```

## 配置步骤

### 方法 1: 使用 Claude Code CLI

如果你使用 Claude Code CLI，编辑配置文件：

```bash
# 编辑 Claude Code 配置
code ~/.claude/config.json
```

添加 MCP Server 配置（**替换 `<PROJECT_ROOT>` 为实际路径**）：

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "python3",
      "args": [
        "<PROJECT_ROOT>/src/mcp-server/server.py"
      ],
      "env": {
        "PYTHONPATH": "<PROJECT_ROOT>/src/mcp-server"
      }
    }
  }
}
```

**示例**（假设项目在 `/home/user/projects/autoimprove`）：

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "python3",
      "args": [
        "/home/user/projects/autoimprove/src/mcp-server/server.py"
      ],
      "env": {
        "PYTHONPATH": "/home/user/projects/autoimprove/src/mcp-server"
      }
    }
  }
}
```

### 方法 2: 使用 Claude Code Desktop

如果你使用 Claude Code Desktop App：

1. 打开 **Settings** (设置)
2. 找到 **MCP Servers** 部分
3. 点击 **Add Server**
4. 填写（**替换 `<PROJECT_ROOT>` 为实际路径**）：
   - **Name**: `autoimprove-core`
   - **Command**: `python3`
   - **Args**: `<PROJECT_ROOT>/src/mcp-server/server.py`
   - **Environment Variables** (可选):
     - `PYTHONPATH`: `<PROJECT_ROOT>/src/mcp-server`

### 方法 3: 使用 claude.ai/code (Web)

Web 版本的 MCP Server 配置在项目设置中：

1. 打开项目设置
2. 找到 **MCP Servers** 标签
3. 添加服务器配置（同上）

## 自动启动机制

配置完成后，MCP Server 会：

1. ✅ **自动启动**: Claude Code 启动时自动启动 MCP Server
2. ✅ **自动重启**: 如果 Server 崩溃，会自动重启
3. ✅ **自动停止**: Claude Code 关闭时自动停止 Server
4. ✅ **进程管理**: Claude Code 负责管理 Server 生命周期

## 验证配置

### 1. 检查 Server 是否运行

在 Claude Code 中运行：

```bash
/autoimprove-status
```

如果看到系统状态，说明 MCP Server 已成功启动。

### 2. 查看 MCP Server 日志

```bash
# Claude Code CLI
claude mcp logs autoimprove-core

# 或查看系统日志
tail -f ~/.claude/logs/mcp-autoimprove-core.log
```

### 3. 测试 MCP Tools

在 Claude Code 中，你可以直接使用 MCP tools：

```python
# Claude 会自动调用 MCP Server
# 例如在对话中说：
"分析这个会话并生成规则"
```

Claude 会自动调用 `analyze_session` 和 `generate_rules` tools。

## 使用虚拟环境（推荐）

如果你使用 Python 虚拟环境，配置应该指向虚拟环境的 Python（**替换 `<PROJECT_ROOT>` 为实际路径**）：

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "<PROJECT_ROOT>/venv/bin/python",
      "args": [
        "<PROJECT_ROOT>/src/mcp-server/server.py"
      ]
    }
  }
}
```

创建虚拟环境：

```bash
cd <PROJECT_ROOT>
python3 -m venv venv
source venv/bin/activate
pip install -e src/mcp-server
```

## 故障排除

### Server 没有启动

1. **检查 Python 路径**
   ```bash
   which python3
   # 确保路径正确
   ```

2. **检查依赖安装**
   ```bash
   cd src/mcp-server
   pip install -e .
   ```

3. **手动测试 Server**
   ```bash
   cd src/mcp-server
   python3 server.py
   # 应该看到 "Starting AutoImprove MCP Server"
   ```

### Server 启动但无法连接

1. **检查配置文件路径**
   - 确保 `args` 中的路径是绝对路径
   - 确保文件存在且可执行

2. **检查权限**
   ```bash
   chmod +x src/mcp-server/server.py
   ```

3. **查看错误日志**
   ```bash
   # Claude Code 会记录 MCP Server 的错误
   cat ~/.claude/logs/mcp-autoimprove-core.log
   ```

### Server 频繁重启

1. **检查代码错误**
   - 运行测试确保代码正常
   ```bash
   cd src/mcp-server
   pytest tests/ -v
   ```

2. **检查依赖冲突**
   ```bash
   pip list | grep fastmcp
   # 确保 fastmcp 版本正确
   ```

## 高级配置

### 添加环境变量

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "python3",
      "args": ["<PROJECT_ROOT>/src/mcp-server/server.py"],
      "env": {
        "PYTHONPATH": "<PROJECT_ROOT>/src/mcp-server",
        "LOG_LEVEL": "DEBUG",
        "AUTOIMPROVE_STORAGE": "/custom/path"
      }
    }
  }
}
```

### 配置多个 MCP Servers

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "python3",
      "args": ["<PROJECT_ROOT>/autoimprove/src/mcp-server/server.py"]
    },
    "other-server": {
      "command": "node",
      "args": ["<OTHER_PROJECT_ROOT>/other/server.js"]
    }
  }
}
```

## 更新配置

修改配置后，需要重启 Claude Code：

```bash
# CLI
claude restart

# Desktop App
重启应用

# Web
刷新页面
```

## 示例：完整配置文件

`~/.claude/config.json` (替换 `<PROJECT_ROOT>` 为实际路径):

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "python3",
      "args": [
        "<PROJECT_ROOT>/src/mcp-server/server.py"
      ],
      "env": {
        "PYTHONPATH": "<PROJECT_ROOT>/src/mcp-server",
        "LOG_LEVEL": "INFO"
      }
    }
  },
  "skills": {
    "enabled": true,
    "paths": [
      "<PROJECT_ROOT>/src/skills"
    ]
  }
}
```
    },
    "other-server": {
      "command": "node",
      "args": ["/path/to/other/server.js"]
    }
  }
}
```

## 更新配置

修改配置后，需要重启 Claude Code：

```bash
# CLI
claude rart

# Desktop App
重启应用

# Web
刷新页面
```

## 示例：完整配置文件

`~/.claude/config.json` (替换 `<PROJECT_ROOT>` 为实际路径):

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "python3",
      "args": [
        "<PROJECT_ROOT>/src/mcp-server/server.py"
      ],
      "env": {
        "PYTHONPATH": "<PROJECT_ROOT>/src/mcp-server",
        "LOG_LEVEL": "INFO"
      }
    }
  },
  "skills": {
    "enabled": true,
    "paths": [
      "<PROJECT_ROOT>/src/skills"
    ]
  }
}
```

## 总结

✅ **配置一次，自动运行n✅ **Claude Code 管理生命周期**  
✅ **无需手动启动/停止**  
✅ **自动重启和错误恢复**

配置完成后，你只需要使用 `/autoimprove-*` 命令，MCP Server 会在后台自动运行！
