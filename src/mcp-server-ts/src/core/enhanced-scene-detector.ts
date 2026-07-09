/**
 * Enhanced scene detection for AutoImprove.
 *
 * Provides intelligent scene detection with multi-scene support,
 * automatic learning from project dependencies, and git history analysis.
 */

import { Scene, createScene } from "./models.js";
import { SceneExtractor } from "./scene-extractor.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

export interface SceneWeight {
  scene: Scene;
  weight: number;
  reasons: string[];
}

export interface SceneSignature {
  tech: string[];
  functional: string[];
  business: string[];
  confidence: number;
  learned_from: string;
}

export class EnhancedSceneDetector {
  private learnedSignatures: SceneSignature[] = [];

  /**
   * Detect scene with multiple dimensions and confidence weights
   */
  detectMultiScenes(context: {
    userInput?: string;
    filePaths?: string[];
    projectRoot?: string;
    gitRemote?: string;
  }): SceneWeight[] {
    const sceneWeights = new Map<string, { scene: Scene; weight: number; reasons: Set<string> }>();

    // Analyze tech stack from package.json
    if (context.projectRoot) {
      const techFromDeps = this.analyzeTechStackFromPackageJson(context.projectRoot);
      for (const tech of techFromDeps) {
        this.addSceneWeight(sceneWeights, { tech: [tech], functional: [], business: [] }, 0.4, "package.json");
      }
    }

    // Analyze from file paths
    if (context.filePaths && context.filePaths.length > 0) {
      const scenesFromPaths = this.detectFromPaths(context.filePaths);
      for (const scene of scenesFromPaths) {
        this.addSceneWeight(sceneWeights, scene, 0.3, "file paths");
      }
    }

    // Analyze from user input
    if (context.userInput) {
      const scenesFromInput = this.detectFromUserInput(context.userInput);
      for (const scene of scenesFromInput) {
        this.addSceneWeight(sceneWeights, scene, 0.5, "user input");
      }
    }

    // Analyze from git remote
    if (context.gitRemote) {
      const businessFromGit = this.detectBusinessFromGit(context.gitRemote);
      if (businessFromGit) {
        this.addSceneWeight(
          sceneWeights,
          { tech: [], functional: [], business: [businessFromGit] },
          0.2,
          "git remote"
        );
      }
    }

    // Match against learned signatures
    const learned = this.matchLearnedSignatures(context);
    for (const sig of learned) {
      this.addSceneWeight(sceneWeights, sig.scene, sig.weight, "learned pattern");
    }

    // Convert to array and sort by weight
    const results: SceneWeight[] = Array.from(sceneWeights.values()).map((entry) => ({
      scene: entry.scene,
      weight: entry.weight,
      reasons: Array.from(entry.reasons),
    }));

    results.sort((a, b) => b.weight - a.weight);

    return results;
  }

  /**
   * Analyze tech stack from package.json
   */
  analyzeTechStackFromPackageJson(projectRoot: string): string[] {
    const packageJsonPath = join(projectRoot, "package.json");
    if (!existsSync(packageJsonPath)) {
      return [];
    }

    try {
      const sceneExtractor = SceneExtractor.getInstance();
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      const techStack: string[] = [];
      const config = sceneExtractor.getKeywordConfig();

      // Use SceneExtractor's tech keyword config
      for (const dep in deps) {
        for (const [techName, keywords] of Object.entries(config.tech)) {
          if (keywords.some(kw => dep.includes(kw))) {
            if (!techStack.includes(techName)) {
              techStack.push(techName);
            }
          }
        }
      }

      return [...new Set(techStack)];
    } catch (error) {
      return [];
    }
  }

  /**
   * Learn scenes from git history
   */
  learnScenesFromHistory(projectRoot: string, maxCommits: number = 50): SceneSignature[] {
    if (!existsSync(join(projectRoot, ".git"))) {
      return [];
    }

    try {
      // Get recent commits with file stats
      const gitLog = execSync(`git log --name-only --pretty=format:"%s" -n ${maxCommits}`, {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });

      const lines = gitLog.split("\n");
      const commitMessages: string[] = [];
      const filePaths: string[] = [];

      for (const line of lines) {
        if (line.trim() === "") continue;
        if (line.includes("/")) {
          filePaths.push(line.trim());
        } else {
          commitMessages.push(line.trim());
        }
      }

      // Extract patterns from commit messages
      const functionalPatterns = this.extractFunctionalPatternsFromMessages(commitMessages);
      const techPatterns = this.extractTechPatternsFromPaths(filePaths);

      // Create signatures
      const signatures: SceneSignature[] = [];
      const seen = new Set<string>();

      for (const func of functionalPatterns) {
        for (const tech of techPatterns) {
          const key = `${tech}-${func}`;
          if (!seen.has(key)) {
            seen.add(key);
            signatures.push({
              tech: [tech],
              functional: [func],
              business: [],
              confidence: 0.6,
              learned_from: "git_history",
            });
          }
        }
      }

      // Store for future use
      this.learnedSignatures.push(...signatures);

      return signatures;
    } catch (error) {
      return [];
    }
  }

  /**
   * Detect scenes from file paths
   */
  private detectFromPaths(filePaths: string[]): Scene[] {
    const scenes: Scene[] = [];

    for (const path of filePaths) {
      const pathLower = path.toLowerCase();

      // Tech detection
      const tech: string[] = [];
      if (pathLower.endsWith(".tsx") || pathLower.endsWith(".jsx")) {
        tech.push("react");
      }
      if (pathLower.endsWith(".vue")) {
        tech.push("vue");
      }
      if (pathLower.includes("prisma")) {
        tech.push("prisma");
      }

      // Functional detection
      const functional: string[] = [];
      if (pathLower.includes("auth") || pathLower.includes("login")) {
        functional.push("auth");
      }
      if (pathLower.includes("api") || pathLower.includes("endpoint")) {
        functional.push("api");
      }
      if (pathLower.includes("test") || pathLower.includes("spec")) {
        functional.push("testing");
      }
      if (pathLower.includes("component")) {
        functional.push("ui");
      }
      if (pathLower.includes("database") || pathLower.includes("migration")) {
        functional.push("database");
      }

      // Business detection from path segments
      const business: string[] = [];
      if (pathLower.includes("shop") || pathLower.includes("cart")) {
        business.push("e-commerce");
      }
      if (pathLower.includes("payment")) {
        business.push("payment");
      }
      if (pathLower.includes("user") || pathLower.includes("profile")) {
        business.push("user-management");
      }

      if (tech.length > 0 || functional.length > 0 || business.length > 0) {
        scenes.push(createScene({ tech, functional, business }));
      }
    }

    return scenes;
  }

  /**
   * Detect scenes from user input
   */
  private detectFromUserInput(userInput: string): Scene[] {
    const inputLower = userInput.toLowerCase();
    const scenes: Scene[] = [];

    // Tech keywords
    const tech: string[] = [];
    const techKeywords: Record<string, string[]> = {
      react: ["react", "jsx", "tsx", "useeffect", "usestate", "component"],
      vue: ["vue", "vuex", "composition api"],
      nextjs: ["next.js", "nextjs", "getserversideprops"],
      prisma: ["prisma", "schema.prisma", "@prisma"],
      graphql: ["graphql", "query", "mutation", "resolver"],
      typescript: ["typescript", "ts", "type", "interface"],
    };

    for (const [techName, keywords] of Object.entries(techKeywords)) {
      if (keywords.some((kw) => inputLower.includes(kw))) {
        tech.push(techName);
      }
    }

    // Functional keywords
    const functional: string[] = [];
    const functionalKeywords: Record<string, string[]> = {
      auth: ["auth", "login", "logout", "jwt", "token", "session"],
      api: ["api", "endpoint", "route", "handler", "request", "response"],
      database: ["database", "db", "query", "migration", "schema"],
      ui: ["ui", "component", "button", "modal", "form", "layout"],
      testing: ["test", "spec", "jest", "vitest", "cypress"],
      performance: ["performance", "optimization", "memo", "cache"],
    };

    for (const [funcName, keywords] of Object.entries(functionalKeywords)) {
      if (keywords.some((kw) => inputLower.includes(kw))) {
        functional.push(funcName);
      }
    }

    // Business keywords
    const business: string[] = [];
    const businessKeywords: Record<string, string[]> = {
      "e-commerce": ["shop", "cart", "checkout", "product", "order"],
      payment: ["payment", "stripe", "paypal", "transaction"],
      crm: ["customer", "lead", "contact", "crm"],
      "user-management": ["user", "profile", "account", "registration"],
    };

    for (const [bizName, keywords] of Object.entries(businessKeywords)) {
      if (keywords.some((kw) => inputLower.includes(kw))) {
        business.push(bizName);
      }
    }

    if (tech.length > 0 || functional.length > 0 || business.length > 0) {
      scenes.push(createScene({ tech, functional, business }));
    }

    return scenes;
  }

  /**
   * Detect business domain from git remote URL
   */
  private detectBusinessFromGit(gitRemote: string): string | null {
    const remoteLower = gitRemote.toLowerCase();

    if (remoteLower.includes("shop") || remoteLower.includes("ecommerce")) {
      return "e-commerce";
    }
    if (remoteLower.includes("pay")) {
      return "payment";
    }
    if (remoteLower.includes("crm")) {
      return "crm";
    }
    if (remoteLower.includes("finance") || remoteLower.includes("bank")) {
      return "finance";
    }

    return null;
  }

  /**
   * Match against learned signatures
   */
  private matchLearnedSignatures(context: {
    userInput?: string;
    filePaths?: string[];
  }): Array<{ scene: Scene; weight: number }> {
    const matches: Array<{ scene: Scene; weight: number }> = [];

    for (const signature of this.learnedSignatures) {
      let matchScore = 0;
      let maxScore = 0;

      // Match against user input
      if (context.userInput) {
        const inputLower = context.userInput.toLowerCase();
        maxScore += signature.tech.length + signature.functional.length;

        for (const tech of signature.tech) {
          if (inputLower.includes(tech)) matchScore += 1;
        }
        for (const func of signature.functional) {
          if (inputLower.includes(func)) matchScore += 1;
        }
      }

      // Match against file paths
      if (context.filePaths) {
        const pathsStr = context.filePaths.join(" ").toLowerCase();
        maxScore += signature.tech.length + signature.functional.length;

        for (const tech of signature.tech) {
          if (pathsStr.includes(tech)) matchScore += 1;
        }
        for (const func of signature.functional) {
          if (pathsStr.includes(func)) matchScore += 1;
        }
      }

      if (maxScore > 0 && matchScore > 0) {
        const weight = (matchScore / maxScore) * signature.confidence * 0.3;
        matches.push({
          scene: createScene(signature),
          weight,
        });
      }
    }

    return matches;
  }

  /**
   * Extract functional patterns from commit messages
   */
  private extractFunctionalPatternsFromMessages(messages: string[]): string[] {
    const patterns = new Set<string>();
    const keywords: Record<string, string[]> = {
      auth: ["auth", "login", "logout", "jwt"],
      api: ["api", "endpoint", "route"],
      ui: ["ui", "component", "button", "modal"],
      database: ["database", "migration", "schema"],
      testing: ["test", "spec", "coverage"],
    };

    for (const msg of messages) {
      const msgLower = msg.toLowerCase();
      for (const [pattern, kws] of Object.entries(keywords)) {
        if (kws.some((kw) => msgLower.includes(kw))) {
          patterns.add(pattern);
        }
      }
    }

    return Array.from(patterns);
  }

  /**
   * Extract tech patterns from file paths
   */
  private extractTechPatternsFromPaths(paths: string[]): string[] {
    const patterns = new Set<string>();

    for (const path of paths) {
      const pathLower = path.toLowerCase();
      if (pathLower.endsWith(".tsx") || pathLower.endsWith(".jsx")) {
        patterns.add("react");
      }
      if (pathLower.endsWith(".vue")) {
        patterns.add("vue");
      }
      if (pathLower.includes("prisma")) {
        patterns.add("prisma");
      }
      if (pathLower.endsWith(".ts") || pathLower.endsWith(".tsx")) {
        patterns.add("typescript");
      }
    }

    return Array.from(patterns);
  }

  /**
   * Add or update scene weight
   */
  private addSceneWeight(
    map: Map<string, { scene: Scene; weight: number; reasons: Set<string> }>,
    scene: Scene,
    weight: number,
    reason: string
  ): void {
    const key = this.sceneToKey(scene);
    const existing = map.get(key);

    if (existing) {
      existing.weight += weight;
      existing.reasons.add(reason);
    } else {
      map.set(key, {
        scene,
        weight,
        reasons: new Set([reason]),
      });
    }
  }

  /**
   * Convert scene to unique key
   */
  private sceneToKey(scene: Scene): string {
    const tech = scene.tech.sort().join(",");
    const functional = scene.functional.sort().join(",");
    const business = scene.business.sort().join(",");
    return `${tech}|${functional}|${business}`;
  }
}
