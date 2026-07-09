/**
 * Unified Scene Extractor - Single source of truth for scene detection
 *
 * Consolidates scene extraction logic from:
 * - hybrid-rule-generator.ts:extractSceneFromPattern()
 * - llm-rule-generator.ts:extractScenesFromCluster()
 * - enhanced-scene-detector.ts:detectFromUserInput()
 *
 * Features:
 * - External keyword configuration (~/.autoimprove/scene-keywords.json)
 * - Result caching for performance
 * - Consistent scene detection across all phases
 */

import { Scene, createScene } from "./models.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logger } from "./logger.js";

export interface SceneKeywords {
  tech: Record<string, string[]>;
  functional: Record<string, string[]>;
  business: Record<string, string[]>;
}

export interface SceneExtractionContext {
  text?: string;           // User input, pattern description, or cluster content
  filePaths?: string[];    // File paths from occurrences
  keywords?: string[];     // Pre-extracted keywords
}

export class SceneExtractor {
  private static instance: SceneExtractor;
  private keywordConfig: SceneKeywords;
  private cache: Map<string, Scene>;
  private configPath: string;

  private constructor() {
    this.configPath = join(homedir(), ".autoimprove", "scene-keywords.json");
    this.cache = new Map();
    this.keywordConfig = this.loadOrCreateKeywordConfig();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SceneExtractor {
    if (!SceneExtractor.instance) {
      SceneExtractor.instance = new SceneExtractor();
    }
    return SceneExtractor.instance;
  }

  /**
   * Extract scene from context (unified entry point)
   */
  public extractScene(context: SceneExtractionContext): Scene {
    // Build cache key
    const cacheKey = this.buildCacheKey(context);

    // Check cache
    if (this.cache.has(cacheKey)) {
      logger.debug("scene-extraction", "Cache hit", { cacheKey: cacheKey.slice(0, 50) });
      return this.cache.get(cacheKey)!;
    }

    // Extract scene
    const scene = this.extractSceneInternal(context);

    // Cache result
    this.cache.set(cacheKey, scene);

    return scene;
  }

  /**
   * Clear cache (for testing or after config reload)
   */
  public clearCache(): void {
    this.cache.clear();
    logger.info("scene-extraction", "Cache cleared");
  }

  /**
   * Reload keyword configuration from disk
   */
  public reloadConfig(): void {
    this.keywordConfig = this.loadOrCreateKeywordConfig();
    this.clearCache();
    logger.info("scene-extraction", "Keyword configuration reloaded");
  }

  /**
   * Get current keyword configuration (for inspection/debugging)
   */
  public getKeywordConfig(): SceneKeywords {
    return JSON.parse(JSON.stringify(this.keywordConfig)); // Deep copy
  }

  /**
   * Internal scene extraction logic
   */
  private extractSceneInternal(context: SceneExtractionContext): Scene {
    const techSet = new Set<string>();
    const functionalSet = new Set<string>();
    const businessSet = new Set<string>();

    // Combine all text sources
    const combinedText = [
      context.text || '',
      ...(context.keywords || []),
      ...(context.filePaths || [])
    ].join(' ').toLowerCase();

    // Extract from file extensions
    if (context.filePaths) {
      for (const filePath of context.filePaths) {
        this.extractFromFilePath(filePath, techSet, functionalSet);
      }
    }

    // Extract tech stack
    for (const [techName, keywords] of Object.entries(this.keywordConfig.tech)) {
      if (keywords.some(kw => combinedText.includes(kw))) {
        techSet.add(techName);
      }
    }

    // Extract functional domain
    for (const [funcName, keywords] of Object.entries(this.keywordConfig.functional)) {
      if (keywords.some(kw => combinedText.includes(kw))) {
        functionalSet.add(funcName);
      }
    }

    // Extract business domain
    for (const [bizName, keywords] of Object.entries(this.keywordConfig.business)) {
      if (keywords.some(kw => combinedText.includes(kw))) {
        businessSet.add(bizName);
      }
    }

    return createScene({
      tech: Array.from(techSet),
      functional: Array.from(functionalSet),
      business: Array.from(businessSet)
    });
  }

  /**
   * Extract scene from file path (extension + directory)
   */
  private extractFromFilePath(
    filePath: string,
    techSet: Set<string>,
    functionalSet: Set<string>
  ): void {
    const lowerPath = filePath.toLowerCase();

    // File extension mapping
    const extMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'react',
      '.jsx': 'react',
      '.js': 'javascript',
      '.py': 'python',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.kt': 'kotlin',
      '.swift': 'swift',
      '.vue': 'vue',
      '.sql': 'sql',
      '.prisma': 'prisma',
      '.graphql': 'graphql',
      '.gql': 'graphql'
    };

    for (const [ext, tech] of Object.entries(extMap)) {
      if (lowerPath.endsWith(ext)) {
        techSet.add(tech);
      }
    }

    // Directory-based functional domain detection
    const dirFuncMap: Record<string, string> = {
      '/auth': 'auth',
      '/authentication': 'auth',
      '/api': 'api',
      '/database': 'database',
      '/db': 'database',
      '/test': 'testing',
      '/tests': 'testing',
      '/__tests__': 'testing',
      '/components': 'ui',
      '/pages': 'routing',
      '/routes': 'routing',
      '/middleware': 'middleware',
      '/hooks': 'hooks',
      '/utils': 'utilities',
      '/lib': 'library'
    };

    for (const [dirPattern, funcDomain] of Object.entries(dirFuncMap)) {
      if (lowerPath.includes(dirPattern)) {
        functionalSet.add(funcDomain);
      }
    }
  }

  /**
   * Build cache key from context
   */
  private buildCacheKey(context: SceneExtractionContext): string {
    const parts = [
      context.text || '',
      (context.filePaths || []).sort().join('|'),
      (context.keywords || []).sort().join('|')
    ];
    return parts.join('::');
  }

  /**
   * Load or create keyword configuration
   */
  private loadOrCreateKeywordConfig(): SceneKeywords {
    if (existsSync(this.configPath)) {
      try {
        const configData = readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(configData);
        logger.info("scene-extraction", `Loaded keyword config from ${this.configPath}`);
        return this.validateAndNormalizeConfig(config);
      } catch (error) {
        logger.warn("scene-extraction", `Failed to load config from ${this.configPath}, using defaults`, {
          error: error instanceof Error ? error.message : String(error)
        });
        return this.getDefaultKeywordConfig();
      }
    } else {
      // Create default config
      const defaultConfig = this.getDefaultKeywordConfig();
      this.saveKeywordConfig(defaultConfig);
      logger.info("scene-extraction", `Created default keyword config at ${this.configPath}`);
      return defaultConfig;
    }
  }

  /**
   * Save keyword configuration to disk
   */
  private saveKeywordConfig(config: SceneKeywords): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      logger.error("scene-extraction", `Failed to save config to ${this.configPath}`, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Validate and normalize loaded config
   */
  private validateAndNormalizeConfig(config: any): SceneKeywords {
    const normalized: SceneKeywords = {
      tech: {},
      functional: {},
      business: {}
    };

    // Validate tech
    if (config.tech && typeof config.tech === 'object') {
      for (const [key, value] of Object.entries(config.tech)) {
        if (Array.isArray(value)) {
          normalized.tech[key] = value.map(String);
        }
      }
    }

    // Validate functional
    if (config.functional && typeof config.functional === 'object') {
      for (const [key, value] of Object.entries(config.functional)) {
        if (Array.isArray(value)) {
          normalized.functional[key] = value.map(String);
        }
      }
    }

    // Validate business
    if (config.business && typeof config.business === 'object') {
      for (const [key, value] of Object.entries(config.business)) {
        if (Array.isArray(value)) {
          normalized.business[key] = value.map(String);
        }
      }
    }

    return normalized;
  }

  /**
   * Get default keyword configuration
   */
  private getDefaultKeywordConfig(): SceneKeywords {
    return {
      tech: {
        // Frontend Frameworks
        react: ['react', 'jsx', 'tsx', 'useeffect', 'usestate', 'usememo', 'usecallback', 'useref', 'component', 'props'],
        vue: ['vue', 'vuex', 'composition api', '.vue', 'v-if', 'v-for', 'v-model'],
        angular: ['angular', '@angular', 'ngmodule', 'component', 'directive', 'pipe'],
        svelte: ['svelte', '.svelte', '$:', 'reactive'],
        nextjs: ['next.js', 'nextjs', 'getserversideprops', 'getstaticprops', 'app router'],
        nuxtjs: ['nuxt', 'nuxtjs', 'nuxt.config'],

        // Backend Frameworks
        express: ['express', 'app.get', 'app.post', 'middleware', 'req.', 'res.'],
        fastify: ['fastify', 'fastify.get', 'fastify.post'],
        koa: ['koa', 'ctx.body', 'ctx.request'],
        nestjs: ['nestjs', '@nestjs', '@controller', '@injectable'],
        django: ['django', 'models.py', 'views.py', 'urls.py'],
        flask: ['flask', 'app.route', '@app.route'],
        rails: ['rails', 'activerecord', 'action_controller'],
        spring: ['spring', 'springframework', '@springboot', '@restcontroller'],

        // Languages
        typescript: ['typescript', '.ts', '.tsx', 'interface', 'type ', 'enum '],
        javascript: ['javascript', '.js', '.jsx', 'const ', 'let ', 'var '],
        python: ['python', '.py', 'def ', 'import ', 'class ', '__init__'],
        java: ['java', '.java', 'public class', 'public static'],
        go: ['golang', '.go', 'func ', 'package '],
        rust: ['rust', '.rs', 'fn ', 'impl ', 'trait '],
        ruby: ['ruby', '.rb', 'def ', 'class ', 'module '],
        php: ['php', '.php', '<?php', 'function '],
        csharp: ['c#', 'csharp', '.cs', 'namespace ', 'public class'],

        // Databases & ORMs
        prisma: ['prisma', 'schema.prisma', '@prisma', 'prisma.'],
        typeorm: ['typeorm', '@entity', '@column', 'repository'],
        sequelize: ['sequelize', 'sequelize.define', 'model.'],
        mongoose: ['mongoose', 'schema', 'model('],
        postgresql: ['postgresql', 'postgres', 'pg', 'psql'],
        mysql: ['mysql', 'mariadb'],
        mongodb: ['mongodb', 'mongo', 'collection'],
        redis: ['redis', 'cache', 'redis.'],

        // GraphQL & APIs
        graphql: ['graphql', 'query', 'mutation', 'resolver', 'schema'],
        apollo: ['apollo', 'apollo-server', '@apollo'],
        trpc: ['trpc', 't.procedure', 'createtrpcrouter'],
        rest: ['rest api', 'restful', 'endpoint'],

        // Testing
        jest: ['jest', 'describe(', 'it(', 'expect(', '.test.'],
        vitest: ['vitest', 'vi.mock', 'vi.fn'],
        cypress: ['cypress', 'cy.', 'cy.visit'],
        playwright: ['playwright', 'page.', 'test('],
        mocha: ['mocha', 'describe(', 'it('],

        // Build Tools
        webpack: ['webpack', 'webpack.config'],
        vite: ['vite', 'vite.config'],
        rollup: ['rollup', 'rollup.config'],
        esbuild: ['esbuild', 'esbuild.'],

        // CSS & Styling
        tailwind: ['tailwind', 'tailwindcss', '@apply', 'tw-'],
        'styled-components': ['styled-components', 'styled.', 'css`'],
        sass: ['sass', 'scss', '.scss', '@mixin', '@include'],

        // Cloud & DevOps
        aws: ['aws', 'amazon web services', 's3', 'ec2', 'lambda'],
        azure: ['azure', 'microsoft azure'],
        gcp: ['gcp', 'google cloud'],
        docker: ['docker', 'dockerfile', 'container'],
        kubernetes: ['kubernetes', 'k8s', 'kubectl', 'pod'],

        // Others
        nodejs: ['node', 'nodejs', 'npm', 'package.json'],
        deno: ['deno', 'deno.json'],
        bun: ['bun', 'bun.'],
      },

      functional: {
        // Authentication & Authorization
        auth: ['auth', 'authentication', 'login', 'logout', 'signin', 'signout', 'session', 'jwt', 'token', 'oauth', 'sso'],
        authorization: ['authorization', 'permission', 'role', 'access control', 'rbac', 'acl'],

        // API & Networking
        api: ['api', 'endpoint', 'route', 'handler', 'request', 'response', 'http', 'fetch'],
        'rest-api': ['rest', 'restful', 'get', 'post', 'put', 'delete', 'patch'],
        graphql: ['graphql', 'query', 'mutation', 'subscription', 'resolver'],
        websocket: ['websocket', 'ws', 'socket.io', 'real-time'],

        // Data Management
        database: ['database', 'db', 'query', 'migration', 'schema', 'table', 'model'],
        orm: ['orm', 'object-relational', 'entity', 'repository'],
        cache: ['cache', 'caching', 'redis', 'memcached', 'cdn'],
        'data-validation': ['validation', 'validate', 'schema', 'sanitize', 'zod', 'yup', 'joi'],

        // State Management
        'state-management': ['state', 'store', 'redux', 'zustand', 'mobx', 'context', 'provider'],
        hooks: ['hooks', 'useeffect', 'usestate', 'usememo', 'custom hook'],

        // UI & Frontend
        ui: ['ui', 'user interface', 'component', 'layout', 'design system'],
        'form-handling': ['form', 'input', 'validation', 'formik', 'react-hook-form'],
        routing: ['routing', 'router', 'navigation', 'route', 'link'],
        'error-handling': ['error', 'exception', 'try-catch', 'error boundary', 'fallback'],

        // Performance
        performance: ['performance', 'optimization', 'optimize', 'slow', 'fast', 'speed', 'latency'],
        'lazy-loading': ['lazy', 'lazy-load', 'code-splitting', 'dynamic import'],
        memoization: ['memo', 'memoize', 'usememo', 'usecallback', 'cache'],

        // Security
        security: ['security', 'vulnerability', 'xss', 'csrf', 'injection', 'sanitize', 'escape'],
        'sql-injection': ['sql injection', 'parameterized query', 'prepared statement'],
        xss: ['xss', 'cross-site scripting', 'sanitize html'],

        // Testing
        testing: ['test', 'testing', 'unit test', 'integration test', 'e2e', 'mock', 'spy', 'stub'],
        'test-coverage': ['coverage', 'code coverage', 'test coverage'],

        // DevOps & Deployment
        deployment: ['deploy', 'deployment', 'release', 'production', 'staging'],
        ci: ['ci', 'continuous integration', 'github actions', 'jenkins', 'gitlab ci'],
        cd: ['cd', 'continuous deployment', 'continuous delivery'],
        monitoring: ['monitoring', 'logging', 'metrics', 'observability', 'tracing'],

        // Code Quality
        'code-quality': ['code quality', 'refactor', 'clean code', 'maintainability'],
        linting: ['lint', 'eslint', 'prettier', 'code style'],
        'type-safety': ['type', 'typescript', 'type-safe', 'static typing'],

        // Async & Concurrency
        'async-operations': ['async', 'await', 'promise', 'callback', 'asynchronous'],
        'concurrency': ['concurrency', 'parallel', 'race condition', 'deadlock', 'mutex'],

        // File Operations
        'file-handling': ['file', 'upload', 'download', 'stream', 'fs'],

        // Utilities
        utilities: ['util', 'utility', 'helper', 'common'],
        logging: ['log', 'logging', 'logger', 'console'],

        // Architecture
        architecture: ['architecture', 'design pattern', 'solid', 'dry', 'kiss'],
        middleware: ['middleware', 'interceptor', 'filter'],
      },

      business: {
        'e-commerce': ['e-commerce', 'ecommerce', 'shop', 'cart', 'checkout', 'order', 'product'],
        payment: ['payment', 'stripe', 'paypal', 'billing', 'invoice', 'transaction'],
        analytics: ['analytics', 'tracking', 'metrics', 'google analytics', 'segment'],
        'user-management': ['user', 'profile', 'account', 'registration'],
        notification: ['notification', 'email', 'sms', 'push', 'alert'],
        'content-management': ['cms', 'content', 'blog', 'article', 'post'],
        social: ['social', 'follow', 'like', 'share', 'comment'],
        search: ['search', 'elasticsearch', 'algolia', 'full-text search'],
        messaging: ['message', 'chat', 'conversation', 'inbox'],
        booking: ['booking', 'reservation', 'appointment', 'schedule'],
        'admin-panel': ['admin', 'dashboard', 'backoffice', 'management panel'],
      }
    };
  }
}
