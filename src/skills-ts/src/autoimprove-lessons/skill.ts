#!/usr/bin/env node
/**
 * AutoImprove Lessons Skill
 *
 * View rules applicable to current scene.
 *
 * Workflow:
 * 1. Call list_scenes to get all known scene combinations
 * 2. Use detect_scene_enhanced with current file context to find matching scenes
 * 3. If a matching scene is found, query lessons for that scene
 * 4. If no scene matches, show a helpful message
 *
 * Usage: autoimprove-lessons [file_paths] [user_input]
 *   file_paths: Comma-separated file paths for context detection (optional)
 *   user_input: User input text for context detection (optional)
 */

import { callMCPTool, readMCPResource, closeMCPClient } from "../mcp-client.js";

interface Scene {
  tech: string[];
  functional: string[];
  business: string[];
}

interface SceneEntry {
  tech: string[];
  functional: string[];
  business: string[];
  ruleCount: number;
  ruleIds: string[];
}

interface ListScenesResult {
  success: boolean;
  scenes: SceneEntry[];
  tech: Record<string, number>;
  functional: Record<string, number>;
  business: Record<string, number>;
  totalRules: number;
}

interface DetectedScene {
  scene: Scene;
  weight: number;
  reasons: string[];
}

interface DetectSceneResult {
  success: boolean;
  scenes: DetectedScene[];
}

async function run() {
  const args = process.argv.slice(2);
  const filePaths = args[0] || "";
  const userInput = args[1] || "";

  try {
    console.log("📚 AutoImprove Lessons\n");

    // Step 1: Get all known scenes
    console.log("🔍 Fetching known scenes...");
    const scenesResult = await callMCPTool<ListScenesResult>("list_scenes", {});

    if (!scenesResult.success || scenesResult.scenes.length === 0) {
      console.log("No known scenes found. No rules have been generated yet.\n");
      console.log("💡 Run `npm run summarize` in the autoimprove repo to build up rules");
      return;
    }

    console.log(`   Found ${scenesResult.scenes.length} scene combinations across ${scenesResult.totalRules} rules\n`);

    // Step 2: Detect current scene from context
    if (!filePaths && !userInput) {
      // No context provided — show all available scenes as a reference
      console.log("📋 Available scenes (no context provided — showing all):\n");
      for (const entry of scenesResult.scenes.slice(0, 20)) {
        const tech = entry.tech.join(", ");
        const func = entry.functional.join(", ");
        const biz = entry.business.join(", ");
        console.log(`   • tech:[${tech}]  functional:[${func}]  business:[${biz}]  → ${entry.ruleCount} rule(s)`);
      }
      if (scenesResult.scenes.length > 20) {
        console.log(`   ... and ${scenesResult.scenes.length - 20} more`);
      }
      console.log("\n💡 Provide file paths or input text to auto-detect your current scene:");
      console.log("   autoimprove-lessons \"src/components/Login.tsx\" \"auth login\"");
      return;
    }

    console.log("🔎 Detecting scene from context...");
    const detectResult = await callMCPTool<DetectSceneResult>("detect_scene_enhanced", {
      user_input: userInput || undefined,
      file_paths: filePaths || undefined,
    });

    if (!detectResult.success || detectResult.scenes.length === 0) {
      console.log("Could not detect any scene from the provided context.\n");
      console.log("💡 Try providing more context, or run without arguments to see all available scenes");
      return;
    }

    // Step 3: Try each detected scene (sorted by weight) against known scenes
    const topScene = detectResult.scenes[0];
    const techStr = topScene.scene.tech.join(",");
    const funcStr = topScene.scene.functional.join(",");
    const bizStr = topScene.scene.business.join(",");
    console.log(`   Detected: tech:[${techStr}]  functional:[${funcStr}]  business:[${bizStr}]  (weight: ${topScene.weight.toFixed(2)})\n`);

    // Build a scene string for the lessons resource: "tech-functional"
    // The knowledge://lessons/{scene} handler splits by "-" and uses first 2 parts
    // as tech and functional. Pick the top tech and top functional from detection.
    const primaryTech = topScene.scene.tech[0] || "";
    const primaryFunc = topScene.scene.functional[0] || "";

    if (!primaryTech && !primaryFunc) {
      console.log("Detected scene has no tech or functional dimension. Cannot look up lessons.\n");
      console.log("💡 Try providing more specific file paths or input text");
      return;
    }

    // Check if any known scene overlaps with the detected scene
    const matchedScenes = scenesResult.scenes.filter(entry => {
      const techOverlap = primaryTech ? entry.tech.includes(primaryTech) : true;
      const funcOverlap = primaryFunc ? entry.functional.includes(primaryFunc) : true;
      return techOverlap && funcOverlap;
    });

    if (matchedScenes.length === 0) {
      console.log(`No lessons found for scene: ${primaryTech}-${primaryFunc}\n`);
      console.log("💡 This means no rules match your current tech stack and domain");
      console.log("Run `npm run summarize` in the autoimprove repo with this tech stack to build up rules");
      return;
    }

    // Step 4: Query lessons using the top matching scene
    const sceneQuery = primaryFunc ? `${primaryTech}-${primaryFunc}` : primaryTech;
    console.log(`📖 Fetching lessons for: ${sceneQuery} (${matchedScenes.length} matching scene(s))\n`);

    try {
      const content = await readMCPResource(`knowledge://lessons/${sceneQuery}`);
      console.log(content);
    } catch (err: any) {
      if (err.message.includes("No lessons found")) {
        console.log(`No lessons found for scene: ${sceneQuery}\n`);
        console.log("💡 This means no rules match your current tech stack and domain");
        console.log("Run `npm run summarize` in the autoimprove repo with this tech stack to build up rules");
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
