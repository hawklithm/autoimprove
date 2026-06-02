#!/usr/bin/env node
/**
 * AutoImprove Lessons Skill
 *
 * View rules applicable to current scene
 */

import { readMCPResource, closeMCPClient } from "../mcp-client.js";

async function run() {
  try {
    console.log("📚 AutoImprove Lessons\n");

    // For now, show a generic scene
    // In a real implementation, would detect current scene from file context
    const scene = "react-auth";

    console.log(`Fetching lessons for scene: ${scene}\n`);

    try {
      const content = await readMCPResource(`knowledge://lessons/${scene}`);
      console.log(content);
    } catch (err: any) {
      if (err.message.includes("No lessons found")) {
        console.log(`No lessons found for scene: ${scene}`);
        console.log("\n💡 This means no rules match your current tech stack and domain");
        console.log("Run `/autoimprove-summarize` in sessions with this tech stack to build up rules");
      } else {
        throw err;
      }
    }
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}`);
  } finally {
    await closeMCPClient();
  }
}

run().catch(console.error);
