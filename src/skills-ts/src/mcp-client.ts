/**
 * MCP Client helper for Skills to call MCP Server
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { homedir } from "os";
import { readFileSync } from "fs";
import { join } from "path";

let mcpClient: Client | null = null;

interface MCPServerConfig {
  command: string;
  args: string[];
}

interface MCPConfig {
  mcpServers?: {
    "autoimprove-core"?: MCPServerConfig;
  };
  projects?: {
    [projectPath: string]: {
      mcpServers?: {
        "autoimprove-core"?: MCPServerConfig;
      };
    };
  };
}

/**
 * Find autoimprove-core configuration in Claude config files
 */
function findServerConfig(): MCPServerConfig | null {
  // Try multiple config locations
  const configPaths = [
    join(homedir(), ".claude.json"),           // User-level config
    join(homedir(), ".claude", "config.json"), // Legacy location
  ];

  for (const configPath of configPaths) {
    try {
      const config: MCPConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      // Check user-level mcpServers
      if (config.mcpServers?.["autoimprove-core"]) {
        return config.mcpServers["autoimprove-core"];
      }

      // Check project-level configurations
      if (config.projects) {
        for (const projectConfig of Object.values(config.projects)) {
          if (projectConfig.mcpServers?.["autoimprove-core"]) {
            return projectConfig.mcpServers["autoimprove-core"];
          }
        }
      }
    } catch (error) {
      // Config file doesn't exist or can't be parsed, try next
      continue;
    }
  }

  return null;
}

/**
 * Initialize MCP client connection
 */
export async function initMCPClient(): Promise<Client> {
  if (mcpClient) {
    return mcpClient;
  }

  const serverConfig = findServerConfig();

  if (!serverConfig) {
    throw new Error(
      "AutoImprove MCP Server not configured. " +
      "Please run './setup.sh' or use 'claude mcp add autoimprove-core -s user -- node /path/to/dist/index.js'"
    );
  }

  // Create transport - StdioClientTransport handles spawning internally
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
  });

  // Create and connect client
  mcpClient = new Client(
    {
      name: "autoimprove-skill-client",
      version: "0.1.0",
    },
    {
      capabilities: {},
    }
  );

  await mcpClient.connect(transport);

  return mcpClient;
}

/**
 * Call an MCP tool
 */
export async function callMCPTool<T = any>(
  toolName: string,
  params: Record<string, any> = {}
): Promise<T> {
  const client = await initMCPClient();

  try {
    // Use a generous per-call timeout. Some tools (e.g. analyze_session with
    // ONNX embedding-based signal extraction, or generate_rules with LLM
    // enhancement) can take well over the SDK's default 60s and would
    // otherwise fail with a misleading "Request timed out" error.
    const result = await client.callTool({
      name: toolName,
      arguments: params,
    }, undefined, { timeout: 600000 });

    // Parse the result
    if (result.content && Array.isArray(result.content) && result.content.length > 0) {
      const textContent = result.content[0];
      if (textContent.type === "text" && "text" in textContent) {
        try {
          return JSON.parse(textContent.text) as T;
        } catch (parseError) {
          throw new Error(
            `Failed to parse MCP tool response: ${parseError}`
          );
        }
      }
    }

    throw new Error(
      `Invalid MCP tool response format for tool '${toolName}'`
    );
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`MCP tool '${toolName}' failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Read an MCP resource
 */
export async function readMCPResource(uri: string): Promise<string> {
  const client = await initMCPClient();

  try {
    const result = await client.readResource({ uri });

    if (result.contents && result.contents.length > 0) {
      const textContent = result.contents[0];
      if (textContent.mimeType === "text/markdown" && "text" in textContent) {
        return textContent.text;
      }
    }

    throw new Error(`Invalid MCP resource response format for URI '${uri}'`);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`MCP resource '${uri}' failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Cleanup MCP client connection
 */
export async function closeMCPClient(): Promise<void> {
  if (mcpClient) {
    try {
      await mcpClient.close();
    } catch (error) {
      // Ignore close errors
    } finally {
      mcpClient = null;
    }
  }
}
