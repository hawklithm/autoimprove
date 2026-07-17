#!/usr/bin/env node

import { callMCPTool, closeMCPClient } from "../mcp-client.js";

async function run() {
  const keywords = process.argv.slice(2).join(",") || undefined;
  try {
    const result = await callMCPTool("search_knowledge", { keywords });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeMCPClient();
  }
}

run().catch((error) => {
  console.error(`AutoImprove check failed: ${error.message}`);
  process.exitCode = 1;
});
