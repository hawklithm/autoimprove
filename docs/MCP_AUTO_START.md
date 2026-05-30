# MCP Server 自动启动配置

## 概述

Claude Code 会在需要时自动启动和管理 MCP Server。你只需要配置一次，之后 MCP Server 会在 Claude Code 启动时自动运行。

## 配置步骤

### 方法 1: 使用 Claude Code CLI

如果你使用 Claude Code CLI，编辑配置文件：

```bash
# 编辑 Claude Code 配置
code ~/.claude/config.json
```

添加 MCP Server 配置：

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "python3",
      "args": [
        "/Users/adazhao/workspace/autoimprove/src/mcp-server/server.py"
      ],
      "env": {
        "PYTHONPATH": "/Users/adazhao/workspace/autoimprove/src/mcp-server"
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
4. 填写：
   - **Name**: `autoimprove-core`
   - **Command**: `python3`
   - **Args**: `/Users/adazhao/workspace/autoimprove/src/mcp-server/server.py`
   - **Environment Variables** (可选):
     - `PYTHONPATH`: `/Users/adazhao/workspace/autoimprove/src/mcp-server`

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

如果你使用 Python 虚拟环境，配置应该指向虚拟环境的 Python：

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "/Users/adazhao/workspace/autoimprove/venv/bin/python",
      "args": [
        "/Users/adazhao/workspace/autoimprove/src/mcp-server/server.py"
      ]
    }
  }
}
```

创建虚拟环境：

```bash
cd /Users/adazhao/workspace/autoimprove
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
      "args": ["/path/to/server.py"],
      "env": {
        "PYTHONPATH": "/path/to/src/mcp-server",
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
      "args": ["/path/to/autoimprove/server.py"]
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

`~/.claude/config.json`:

```json
{
  "mcpServers": {
    "autoimprove-core": {
      "command": "python3",
      "args": [
        "/Users/adazhao/workspace/autoimprove/src/mcp-server/server.py"
      ],
      "env": {
        "PYTHONPATH": "/Users/adazhao/workspace/autoimprove/src/mcp-server",
        "LOG_LEVEL": "INFO"
      }
    }
  },
  "skills": {
    "enabled": true,
    "paths": [
      "/Users/adazhao/workspace/autoimprove/src/skills"
    ]
  }
}
```

## 总结

✅ **配置一次，自动运行n✅ **Claude Code 管理生命周期**  
✅ **无需手动启动/停止**  
✅ **自动重启和错误恢复**

配置完成后，你只需要使用 `/autoimprove-*` 命令，MCP Server 会在后台自动运行！
