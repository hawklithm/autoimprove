/**
 * Scene Thesaurus
 *
 * Provides synonym expansion and hierarchical relationships for scene matching.
 *
 * Solves the problem of overly strict scene matching:
 * - "react" should match "react-hooks", "react-native"
 * - "database" should match "postgres", "mysql", etc.
 * - "js" should match "javascript"
 */

import { Scene, createScene } from "./models.js";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logger } from "./logger.js";

/**
 * Default built-in thesaurus
 */
const DEFAULT_THESAURUS: Record<string, string[]> = {
  // ===== Technology Stack =====

  // JavaScript ecosystem
  "javascript": ["javascript", "js", "ecmascript", "es6", "es2015", "es2020"],
  "js": ["javascript", "js", "ecmascript", "es6"],
  "typescript": ["typescript", "ts"],
  "ts": ["typescript", "ts"],

  // React ecosystem
  "react": ["react", "reactjs", "react-native", "react-hooks", "preact"],
  "reactjs": ["react", "reactjs"],
  "react-hooks": ["react", "react-hooks", "hooks"],
  "react-native": ["react", "react-native", "rn"],

  // Vue ecosystem
  "vue": ["vue", "vuejs", "vue3", "vue2"],
  "vuejs": ["vue", "vuejs"],

  // Angular ecosystem
  "angular": ["angular", "angularjs", "ng"],

  // Node.js ecosystem
  "node": ["node", "nodejs", "node.js"],
  "nodejs": ["node", "nodejs"],
  "express": ["express", "expressjs"],
  "fastify": ["fastify"],
  "nestjs": ["nestjs", "nest"],

  // Python ecosystem
  "python": ["python", "py", "python3", "python2"],
  "py": ["python", "py"],
  "django": ["django"],
  "flask": ["flask"],
  "fastapi": ["fastapi"],

  // Database (hierarchical)
  "database": ["database", "db", "postgres", "postgresql", "mysql", "sqlite", "mongodb", "redis", "dynamodb"],
  "db": ["database", "db"],
  "sql": ["sql", "postgres", "postgresql", "mysql", "sqlite"],
  "postgres": ["postgres", "postgresql", "pg"],
  "postgresql": ["postgres", "postgresql"],
  "mysql": ["mysql"],
  "sqlite": ["sqlite", "sqlite3"],
  "nosql": ["nosql", "mongodb", "dynamodb", "redis"],
  "mongodb": ["mongodb", "mongo"],
  "redis": ["redis"],

  // Frontend frameworks (hierarchical)
  "frontend": ["frontend", "react", "vue", "angular", "svelte", "solid"],
  "ui": ["ui", "frontend", "react", "vue"],

  // Backend frameworks (hierarchical)
  "backend": ["backend", "node", "express", "fastify", "nestjs", "django", "flask", "fastapi"],
  "server": ["server", "backend", "node", "express"],

  // Testing
  "testing": ["testing", "test", "jest", "vitest", "mocha", "pytest", "unittest"],
  "test": ["testing", "test"],
  "jest": ["jest", "testing"],
  "vitest": ["vitest", "testing"],

  // ===== Functional Domain =====

  // Authentication & Authorization
  "auth": ["auth", "authentication", "authorization", "jwt", "oauth", "session", "login"],
  "authentication": ["authentication", "auth", "login", "signin"],
  "authorization": ["authorization", "auth", "permissions", "rbac"],
  "jwt": ["jwt", "token", "auth"],
  "oauth": ["oauth", "oauth2", "auth"],
  "session": ["session", "auth", "cookie"],

  // Validation & Sanitization
  "validation": ["validation", "validate", "sanitize", "verify", "check"],
  "validate": ["validate", "validation"],
  "sanitize": ["sanitize", "sanitization", "escape", "validation"],

  // API & Routing
  "api": ["api", "endpoint", "route", "rest", "graphql", "rpc"],
  "endpoint": ["endpoint", "api", "route"],
  "route": ["route", "routing", "api"],
  "rest": ["rest", "restful", "api"],
  "graphql": ["graphql", "gql", "api"],

  // Data handling
  "data": ["data", "database", "storage", "persistence"],
  "storage": ["storage", "data", "database"],
  "cache": ["cache", "caching", "redis", "memcached"],

  // Error handling
  "error": ["error", "exception", "error-handling", "try-catch"],
  "exception": ["exception", "error"],
  "error-handling": ["error-handling", "error", "exception"],

  // Security
  "security": ["security", "xss", "csrf", "sql-injection", "sanitize"],
  "xss": ["xss", "cross-site-scripting", "security"],
  "csrf": ["csrf", "cross-site-request-forgery", "security"],
  "sql-injection": ["sql-injection", "sqli", "security"],

  // Performance
  "performance": ["performance", "optimization", "perf", "speed"],
  "optimization": ["optimization", "performance"],
  "perf": ["perf", "performance"],

  // Async operations
  "async": ["async", "asynchronous", "promise", "await", "callback"],
  "promise": ["promise", "async", "then"],
  "await": ["await", "async"],

  // State management
  "state": ["state", "state-management", "redux", "zustand", "context"],
  "state-management": ["state-management", "state", "redux"],
  "redux": ["redux", "state-management"],

  // Forms
  "form": ["form", "forms", "input", "validation"],
  "forms": ["forms", "form"],
  "input": ["input", "form"],

  // ===== Business Domain =====

  "payment": ["payment", "checkout", "stripe", "paypal"],
  "analytics": ["analytics", "tracking", "metrics"],
  "user": ["user", "account", "profile"],
  "admin": ["admin", "administration", "dashboard"],
};

export class SceneThesaurus {
  private thesaurus: Record<string, string[]>;
  private configPath: string;

  constructor() {
    this.thesaurus = { ...DEFAULT_THESAURUS };
    this.configPath = join(homedir(), ".autoimprove", "scene_synonyms.json");
    this.loadCustomThesaurus();
  }

  /**
   * Expand a scene with synonyms and hierarchical terms
   * @param maxExpansion - Maximum number of synonyms per term (default: 5, 0 = unlimited)
   */
  expandScene(scene: Scene, maxExpansion: number = 5): Scene {
    return createScene({
      tech: this.expandTerms(scene.tech, maxExpansion),
      functional: this.expandTerms(scene.functional, maxExpansion),
      business: this.expandTerms(scene.business, maxExpansion),
    });
  }

  /**
   * Expand a list of terms with their synonyms
   * @param maxExpansion - Maximum synonyms per term (0 = unlimited)
   */
  private expandTerms(terms: string[], maxExpansion: number): string[] {
    const expanded = new Set<string>(terms);

    for (const term of terms) {
      const synonyms = this.expandDimension(term, maxExpansion);
      synonyms.forEach(syn => expanded.add(syn));
    }

    return Array.from(expanded);
  }

  /**
   * Expand a gle term with controlled synonym growth
   * @param term - Term to expand
   * @param maxExpansion - Maximum number of synonyms (0 = unlimited)
   * @returns Array of expanded terms including the original
   */
  private expandDimension(term: string, maxExpansion: number): string[] {
    const synonyms = this.getSynonyms(term);

    if (maxExpansion === 0 || synonyms.length <= maxExpansion) {
      return synonyms;
    }

    // Limit to maxExpansion synonyms, prioritizing the original term
    const result = [term];
    let count = 1;

    for (const syn of synonyms) {
      if (syn !== term && count < maxExpansion) {
        result.push(syn);
        count++;
      }
      if (count >= maxExpansion) break;
    }

    return result;
  }

  /**
   * Get synonyms for a term (case-insensitive)
   */
  getSynonyms(term: string): string[] {
    const normalized = term.toLowerCase();
    return this.thesaurus[normalized] || [term];
  }

  /**
   * Add custom synonym mapping
   */
  addSynonyms(term: string, synonyms: string[]): void {
    const normalized = term.toLowerCase();

    if (this.thesaurus[normalized]) {
      // Merge with existing
      const existing = new Set(this.thesaurus[normalized]);
      synonyms.forEach(syn => existing.add(syn.toLowerCase()));
      this.thesaurus[normalized] = Array.from(existing);
    } else {
      // Add new
      this.thesaurus[normalized] = [normalized, ...synonyms.map(s => s.toLowerCase())];
    }

    this.saveCustomThesaurus();
  }

  /**
   * Load custom user-defined synonyms
   */
  private loadCustomThesaurus(): void {
    if (!existsSync(this.configPath)) {
      return;
    }

    try {
      const data = readFileSync(this.configPath, "utf-8");
      const custom = JSON.parse(data) as Record<string, string[]>;

      // Merge custom with defaults
      for (const [key, values] of Object.entries(custom)) {
        const normalized = key.toLowerCase();
        if (this.thesaurus[normalized]) {
          // Merge
          const existing = new Set(this.thesaurus[normalized]);
          values.forEach(v => existing.add(v.toLowerCase()));
          this.thesaurus[normalized] = Array.from(existing);
        } else {
          // Add new
          this.thesaurus[normalized] = values.map(v => v.toLowerCase());
        }
      }

      logger.info("scene-thesaurus", `Loaded ${Object.keys(custom).length} custom synonym groups`);
    } catch (error) {
      logger.warn("scene-thesaurus", `Failed to load custom thesaurus: ${error}`);
    }
  }

  /**
   * Save custom thesaurus to disk
   */
  private saveCustomThesaurus(): void {
    try {
      // Extract only custom entries (those not in DEFAULT_THESAURUS)
      const custom: Record<string, string[]> = {};

      for (const [key, values] of Object.entries(this.thesaurus)) {
        const defaultValues = DEFAULT_THESAURUS[key];
        if (!defaultValues || JSON.stringify(values) !== JSON.stringify(defaultValues)) {
          custom[key] = values;
        }
      }

      writeFileSync(this.configPath, JSON.stringify(custom, null, 2));
      logger.info("scene-thesaurus", "Saved custom thesaurus");
    } catch (error) {
      logger.error("scene-thesaurus", `Failed to save custom thesaurus: ${error}`);
    }
  }

  /**
   * Get all synonym groups
   */
  getAllGroups(): Record<string, string[]> {
    return { ...this.thesaurus };
  }

  /**
   * Reset to default thesaurus
   */
  reset(): void {
    this.thesaurus = { ...DEFAULT_THESAURUS };
    this.saveCustomThesaurus();
  }
}
