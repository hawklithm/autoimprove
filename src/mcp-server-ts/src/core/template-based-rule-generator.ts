/**
 * Template-Based Rule Generator
 *
 * Replaces hardcoded LLM prompt logic with declarative Markdown templates.
 * Compiles templates once at startup, executes on-demand per pattern.
 */

import { Pattern, RuleIndexEntry, RuleContent, Scene } from './models.js';
import { compile } from './rule-template-compiler.js';
import { TemplateExecutor, ExecutionResult, StepFunction, LLMCaller } from './template-executor.js';
import { registerStepFunctions } from './template-step-functions.js';
import { SceneExtractor } from './scene-extractor.js';
import { logger } from './logger.js';
import { readFileSync, readdirSync, watch, FSWatcher } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Template directory (relative to compiled output in dist/)
const TEMPLATE_DIR = join(__dirname, '..', '..', 'src', 'core', 'rule-templates');

export interface TemplateGenerationOptions {
  sessionDir?: string;
  maxExamples?: number;
  ruleId: string;
  scene?: Scene;
}

/**
 * Template-based rule generator.
 * Loads and compiles templates at construction, executes on demand.
 */
export class TemplateBasedRuleGenerator {
  private templates: Map<string, any>; // pattern_type -> compiled template
  private stepFunctions: Map<string, StepFunction>;
  private llmCaller: LLMCaller | null;
  private openai: OpenAI | null;
  private model: string;
  private watcher: FSWatcher | null = null;
  private hotReloadEnabled: boolean;

  constructor(options?: { enableHotReload?: boolean }) {
    this.hotReloadEnabled = options?.enableHotReload || false;
    this.templates = new Map();
    this.stepFunctions = registerStepFunctions();

    // Initialize LLM client (same logic as HybridRuleGenerator)
    const apiKey = process.env.ANTHROPIC_API_KEY
      || process.env.ANTHROPIC_AUTH_TOKEN
      || process.env.LLM_API_KEY;

    let baseURL = process.env.LLM_BASE_URL || process.env.ANTHROPIC_BASE_URL;
    if (baseURL && !baseURL.endsWith('/v1')) {
      baseURL = baseURL.replace(/\/$/, '') + '/v1';
    }

    this.model = process.env.LLM_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

    if (!apiKey) {
      this.openai = null;
      this.llmCaller = null;
      logger.warn('template-generator', 'No API key found - LLM calls will fail');
    } else {
      this.openai = baseURL
        ? new OpenAI({ apiKey, baseURL })
        : new OpenAI({ apiKey });

      this.llmCaller = async (inputs: Record<string, any>) => {
        return this.executeLLMCall(inputs);
      };

      logger.info('template-generator', `LLM initialized: model=${this.model}`);
    }

    this.loadTemplates();

    if (this.hotReloadEnabled) {
      this.enableHotReload();
    }
  }

  /**
   * Load and compile all templates from rule-templates directory.
   */
  private loadTemplates(): void {
    try {
      const files = readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.md'));

      logger.info('template-generator', `Loading ${files.length} templates from ${TEMPLATE_DIR}`);

      for (const file of files) {
        const filePath = join(TEMPLATE_DIR, file);
        const templateSource = readFileSync(filePath, 'utf-8');

        try {
          const compiled = compile(templateSource);
          this.templates.set(compiled.patternType, compiled);

          logger.debug('template-generator', `✓ Compiled template: ${compiled.name} (${compiled.patternType})`);
        } catch (error: any) {
          logger.error('template-generator', `✗ Failed to compile ${file}: ${error.message}`);
        }
      }

      logger.info('template-generator', `Loaded ${this.templates.size} templates`);
    } catch (error: any) {
      logger.error('template-generator', `Failed to load templates: ${error.message}`);
    }
  }

  /**
   * Enable hot reload for template files.
   * Watches rule-templates/*.md for changes and recompiles automatically.
   */
  private enableHotReload(): void {
    try {
      this.watcher = watch(TEMPLATE_DIR, { persistent: false }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) {
          return;
        }

        logger.info('template-hot-reload', `Template changed: ${filename} (${eventType})`);

        const filePath = join(TEMPLATE_DIR, filename);

        try {
          const templateSource = readFileSync(filePath, 'utf-8');
          const compiled = compile(templateSource);
          this.templates.set(compiled.patternType, compiled);

          logger.info('template-hot-reload', `✓ Recompiled: ${compiled.name} (${compiled.patternType})`);
        } catch (error: any) {
          logger.error('template-hot-reload', `✗ Failed to recompile ${filename}: ${error.message}`);
        }
      });

      logger.info('template-hot-reload', `Watching ${TEMPLATE_DIR} for changes`);
    } catch (error: any) {
      logger.error('template-hot-reload', `Failed to enable hot reload: ${error.message}`);
    }
  }

  /**
   * Disable hot reload and clean up watcher.
   */
  public disableHotReload(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('template-hot-reload', 'Hot reload disabled');
    }
  }

  /**
   * Generate rule using template execution.
   */
  async generateRule(
    pattern: Pattern,
    options: TemplateGenerationOptions
  ): Promise<{ indexEntry: RuleIndexEntry; content: RuleContent }> {
    const template = this.templates.get(pattern.type);

    if (!template) {
      throw new Error(`No template found for pattern type: ${pattern.type}`);
    }

    logger.info('template-generator', `Generating rule ${options.ruleId} using template ${template.name}`);

    // Execute template
    const executor = new TemplateExecutor(
      template,
      pattern,
      this.stepFunctions,
      this.llmCaller || undefined
    );

    const result: ExecutionResult = await executor.execute();

    // Determine scenes: prefer explicit scene, then template-derived scenes,
    // then re-derive from the pattern itself (occurrences + keywords + type)
    // using the unified SceneExtractor. The template's scene detection often
    // receives no usable signal (Pattern has no `user_messages` field and
    // occurrence contexts are frequently "unknown"), so this fallback is what
    // actually populates scenes during batch rebuild.
    let scenes: Scene = options.scene
      || result.finalRule.metadata.scenes
      || { tech: [], functional: [], business: [] };

    const hasScenes =
      scenes.tech.length > 0 || scenes.functional.length > 0 || scenes.business.length > 0;

    if (!hasScenes) {
      try {
        const sceneExtractor = SceneExtractor.getInstance();
        const textParts: string[] = [];
        if (pattern.description) textParts.push(pattern.description);
        if (pattern.type) textParts.push(pattern.type);
        for (const occ of pattern.occurrences || []) {
          if (occ.user_input) textParts.push(occ.user_input);
          if (occ.context && occ.context !== 'unknown') textParts.push(occ.context);
        }
        const derived = sceneExtractor.extractScene({
          text: textParts.join(' '),
          keywords: pattern.keywords,
        });
        if (derived.tech.length > 0 || derived.functional.length > 0 || derived.business.length > 0) {
          scenes = derived;
          logger.info('template-generator', `Scenes re-derived from pattern for ${options.ruleId}:`, {
            tech: derived.tech,
            functional: derived.functional,
            business: derived.business,
          });
        }
      } catch (error: any) {
        logger.warn('template-generator', `Scene re-derivation failed for ${options.ruleId}: ${error?.message || error}`);
      }
    }

    // Build index entry
    const indexEntry: RuleIndexEntry = {
      id: options.ruleId,
      type: pattern.type,
      priority: result.finalRule.metadata.priority,
      confidence: result.finalRule.metadata.confidence,
      scenes,
      keywords: pattern.keywords,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Build content
    const content: RuleContent = {
      id: options.ruleId,
      content: result.finalRule.content,
      title: result.finalRule.title || pattern.description,
      description: result.finalRule.description || pattern.description,
      reason: result.finalRule.rationale || result.finalRule.description || pattern.description,
      metadata: result.finalRule.metadata,
    };

    logger.info('template-generator', `✓ Rule ${options.ruleId} generated in ${result.executionTimeMs}ms`);

    return { indexEntry, content };
  }

  /**
   * Execute LLM call (used by template executor).
   */
  private async executeLLMCall(inputs: Record<string, any>): Promise<any> {
    if (!this.openai) {
      throw new Error('LLM client not initialized');
    }

    const promptTemplate = inputs.prompt_template || inputs.prompt || '';
    const maxTokens = inputs.max_tokens || 1500;

    logger.debug('template-generator', `LLM call: ${promptTemplate.substring(0, 100)}...`);

    const response = await this.openai.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: promptTemplate,
      }],
    });

    const responseText = response.choices[0]?.message?.content || '';

    // Try to parse as JSON if response looks like JSON
    if (responseText.trim().startsWith('{')) {
      try {
        return JSON.parse(responseText);
      } catch {
        return { raw: responseText };
      }
    }

    // Parse structured sections
    const sections = this.parseStructuredResponse(responseText);
    return sections;
  }

  /**
   * Parse LLM response into structured sections.
   */
  private parseStructuredResponse(text: string): Record<string, any> {
    const result: Record<string, any> = {};

    // Extract title (first # heading)
    const titleMatch = text.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      result.title = titleMatch[1].trim();
    }

    // Extract description (text after ## Description)
    const descMatch = text.match(/##\s+Description\s*\n\n(.+?)(?=\n##|\n\n##|$)/s);
    if (descMatch) {
      result.description = descMatch[1].trim();
    }

    // Extract rationale
    const rationaleMatch = text.match(/##\s+Rationale\s*\n\n(.+?)(?=\n##|\n\n##|$)/s);
    if (rationaleMatch) {
      result.rationale = rationaleMatch[1].trim();
    }

    // Extract how_to_apply (bullet list)
    const howToMatch = text.match(/##\s+How to Apply\s*\n\n((?:[-*]\s+.+\n?)+)/);
    if (howToMatch) {
      result.how_to_apply = howToMatch[1]
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map(line => line.replace(/^[-*]\s+/, '').trim());
    }

    // Extract when_to_use
    const whenMatch = text.match(/##\s+When to Use\s*\n\n((?:[-*]\s+.+\n?)+)/);
    if (whenMatch) {
      result.when_to_use = whenMatch[1]
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map(line => line.replace(/^[-*]\s+/, '').trim());
    }

    // Extract exceptions
    const exceptionsMatch = text.match(/##\s+Exceptions\s*\n\n((?:[-*]\s+.+\n?)+)/);
    if (exceptionsMatch) {
      result.exceptions = exceptionsMatch[1]
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map(line => line.replace(/^[-*]\s+/, '').trim());
    }

    return result;
  }

  /**
   * Get available template pattern types.
   */
  getAvailablePatternTypes(): string[] {
    return Array.from(this.templates.keys());
  }
}
