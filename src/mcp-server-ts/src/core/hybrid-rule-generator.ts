/**
 * Hybrid Rule Generator - Multi-phase rule generation strategy
 *
 * Phase 1: Basic pattern detection (SessionAnalyzer)
 * Phase 2: LLM content enhancement with full context
 * Phase 3: Code example extraction from session tool calls
 * Phase 4: Structured storage with rich metadata
 */

import { Pattern, RuleIndexEntry, RuleContent, Scene, CodeExample } from "./models.js";
import { RuleGenerator } from "./rule-generator.js";
import { CodeExampleExtractor } from "./code-example-extractor.js";
import { ScopeDetector } from "./scope-detector.js";
import { SessionData } from "./jsonl-parser.js";
import { logger } from "./logger.js";
import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Log file path
const LLM_LOG_FILE = join(homedir(), ".autoimprove", "llm-calls.log");

export interface EnhancedRuleOptions {
  /** Whether to use LLM for content enhancement (Phase 2) */
  useLLMEnhancement?: boolean;

  /** Whether to extract code examples from sessions (Phase 3) */
  extractCodeExamples?: boolean;

  /** Path to session files directory */
  sessionDir?: string;

  /** Maximum number of examples to include */
  maxExamples?: number;

  /** Session data for scope detection */
  sessionData?: SessionData;
}

export class HybridRuleGenerator {
  private basicGenerator: RuleGenerator;
  private exampleExtractor: CodeExampleExtractor;
  private scopeDetector: ScopeDetector;
  private anthropic: Anthropic | null;

  constructor() {
    this.basicGenerator = new RuleGenerator();
    this.exampleExtractor = new CodeExampleExtractor();
    this.scopeDetector = new ScopeDetector();

    // Initialize Anthropic client if API key available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.anthropic = null;
    }
  }

  /**
   * Generate enhanced rule from pattern (all phases)
   */
  async generateEnhancedRule(
    pattern: Pattern,
    ruleId: string,
    scene?: Scene,
    options: EnhancedRuleOptions = {}
  ): Promise<{ indexEntry: RuleIndexEntry; content: RuleContent }> {
    const {
      useLLMEnhancement = false,
      extractCodeExamples = true,
      sessionDir = "~/.claude/sessions",
      maxExamples = 3,
      sessionData
    } = options;

    // Phase 1: Generate basic rule
    const basicRule = this.basicGenerator.generateRule(pattern, ruleId, scene);

    // Phase 1.5: Detect and assign scope
    const scopeContext = this.scopeDetector.detectScope(pattern, sessionData);
    basicRule.indexEntry.scope = scopeContext.scope;
    if (scopeContext.project_path || scopeContext.organization_id || scopeContext.project_id) {
      basicRule.indexEntry.scope_context = {
        organization_id: scopeContext.organization_id,
        project_id: scopeContext.project_id,
        project_path: scopeContext.project_path
      };
    }

    // Log scope detection result
    logger.debug("hybrid-generation", `Scope detected for ${ruleId}`, {
      scope: scopeContext.scope,
      project_path: scopeContext.project_path,
      project_id: scopeContext.project_id
    });

    // Phase 1.6: Extract scenes and keywords from pattern
    const sceneData = this.extractSceneFromPattern(pattern);
    basicRule.indexEntry.scenes = sceneData.scene;
    basicRule.indexEntry.keywords = sceneData.keywords;

    logger.debug("hybrid-ion", `Scene and keywords extracted for ${ruleId}`, {
      scenes: sceneData.scene,
      keywords: sceneData.keywords
    });

    // Phase 2: LLM enhancement (if enabled and available)
    let enhancedContent: RuleContent;
    if (useLLMEnhancement && this.anthropic) {
      try {
        enhancedContent = await this.enhanceWithLLM(pattern, basicRule.content, ruleId);
      } catch (error) {
        logger.warn("hybrid-generation", `LLM enhancement failed for ${ruleId}, using basic content`, { error: error instanceof Error ? error.message : String(error) });
        enhancedContent = basicRule.content;
      }
    } else {
      enhancedContent = basicRule.content;
    }

    // Phase 3: Extract code examples (if enabled)
    if (extractCodeExamples && sessionDir) {
      try {
        const examples = this.exampleExtractor.extractExamples(pattern, sessionDir);
        if (examples.length > 0) {
          enhancedContent.examples = examples.slice(0, maxExamples);

          // Update formatted content with examples
          enhancedContent.content = this.addExamplesToContent(
            enhancedContent.content,
            examples.slice(0, maxExamples)
          );
        }
      } catch (error) {
        logger.warn("hybrid-generation", `Code example extraction failed for ${ruleId}`, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    // Phase 4: Quality assessment and adjustment
    const qualityScore = this.assessRuleQuality(enhancedContent);

    // Downgrade confidence for low-quality rules
    if (qualityScore < 0.5) {
      logger.warn("hybrid-generation", `⚠️  Rule ${ruleId} has low quality score: ${qualityScore.toFixed(2)}`);
      basicRule.indexEntry.confidence = Math.min(
        basicRule.indexEntry.confidence,
        0.4 + qualityScore * 0.2  // Cap at 0.4-0.5 for low quality
      );
    }

    // Add quality metadata
    if (!enhancedContent.metadata) {
      enhancedContent.metadata = {
        type: basicRule.indexEntry.type,
        priority: basicRule.indexEntry.priority,
        confidence: basicRule.indexEntry.confidence,
        source: "learned",
        pattern_occurrences: pattern.occurrences.length,
        first_seen: pattern.first_seen,
        last_seen: pattern.last_seen,
        keywords: pattern.keywords
      };
    }
    enhancedContent.metadata.quality_score = qualityScore;

    // Phase 5: Return structured rule with rich metadata
    return {
      indexEntry: basicRule.indexEntry,
      content: enhancedContent
    };
  }

  /**
   * Batch generate enhanced rules
   */
  async batchGenerateEnhancedRules(
    patterns: Pattern[],
    startId: number,
    scene?: Scene,
    options: EnhancedRuleOptions = {}
  ): Promise<Array<{ indexEntry: RuleIndexEntry; content: RuleContent }>> {
    const rules: Array<{ indexEntry: RuleIndexEntry; content: RuleContent }> = [];
    const filteredReasons: Record<string, number> = {};

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const ruleId = `rule-${String(startId + i).padStart(3, "0")}`;

      // Check if should generate rule
      const { shouldGenerate, reason } = this.basicGenerator["classifier"].shouldGenerateRule(pattern);
      if (!shouldGenerate) {
        // Track filtering reasons for diagnostics
        filteredReasons[reason] = (filteredReasons[reason] || 0) + 1;

        // Log first 3 filtered patterns for debugging
        if (i < 3) {
          logger.debug("hybrid-generation", `✗ Filtered pattern ${i}: ${reason}`);
          logger.debug("hybrid-generation", `  Type: ${pattern.type}, Confidence: ${pattern.confidence}, Occurrences: ${pattern.occurrences.length}`);
        }
        continue;
      }

      const rule = await this.generateEnhancedRule(pattern, ruleId, scene, options);
      rules.push(rule);

      logger.info("hybrid-generation", `✓ Generated enhanced rule ${ruleId}: ${rule.content.title || pattern.description}`);
    }

    // Log filtering statistics
    if (Object.keys(filteredReasons).length > 0) {
      logger.info("hybrid-generation", `\n=== Rule Filtering Statistics ===`);
      logger.info("hybrid-generation", `Total patterns: ${patterns.length}`);
      logger.info("hybrid-generation", `Rules generated: ${rules.length}`);
      logger.info("hybrid-generation", `Patterns filtered: ${patterns.length - rules.length}`);
      logger.info("hybrid-generation", `Filtering reasons:`);
      for (const [reason, count] of Object.entries(filteredReasons)) {
        logger.info("hybrid-generation", `  - ${reason}: ${count} patterns`);
      }

      logger.warn(
        "rule-generation",
        `Filtered ${patterns.length - rules.length} patterns`,
        { filtered_reasons: filteredReasons }
      );
    }

    return rules;
  }

  /**
   * Phase 2: Enhance rule content with LLM
   */
  private async enhanceWithLLM(
    pattern: Pattern,
    basicContent: RuleContent,
    ruleId: string
  ): Promise<RuleContent> {
    if (!this.anthropic) {
      throw new Error("Anthropic API key not available");
    }

    // Build enhancement prompt with full pattern context
    const prompt = this.buildEnhancementPrompt(pattern, basicContent);

    // Dynamic max_tokens based on pattern complexity
    const maxTokens = this.calculateMaxTokens(pattern);

    // Use environment variable for model configuration
    const model = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
      || process.env.ANTHROPIC_MODEL
      || "claude-sonnet-4-6";

    const requestLog = `\n[${new Date().toISOString()}] [LLM] Requesting enhancement for ${ruleId}\n` +
      `Model: ${model}, Max tokens: ${maxTokens}\n` +
      `Prompt (${prompt.length} chars):\n${prompt.slice(0, 500)}...\n`;

    logger.debug("hybrid-generation", "LLM request sent", { rule_id: ruleId, model, max_tokens: maxTokens, prompt_length: prompt.length });
    appendFileSync(LLM_LOG_FILE, requestLog, "utf8");

    const response = await this.anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: prompt
      }]
    });

    const responseText = response.content[0].type === "text" ? response.content[0].text : "";

    const responseLog = `[${new Date().toISOString()}] [LLM] Response received (${responseText.length} chars):\n${responseText.slice(0, 500)}...\n`;
    logger.debug("hybrid-generation", "LLM response received", { rule_id: ruleId, response_length: responseText.length });
    appendFileSync(LLM_LOG_FILE, responseLog, "utf8");

    const enhanced = this.parseEnhancedResponse(responseText);

    // Build formatted content
    let formattedContent = `# ${enhanced.title}\n\n`;
    formattedContent += `## Description\n\n${enhanced.description}\n\n`;
    formattedContent += `## Rationale\n\n${enhanced.rationale}\n\n`;

    if (enhanced.how_to_apply && enhanced.how_to_apply.length > 0) {
      formattedContent += `## How to Apply\n\n`;
      for (const step of enhanced.how_to_apply) {
        formattedContent += `- ${step}\n`;
      }
      formattedContent += `\n`;
    }

    if (enhanced.when_to_use && enhanced.when_to_use.length > 0) {
      formattedContent += `## When to Use\n\n`;
      for (const condition of enhanced.when_to_use) {
        formattedContent += `- ${condition}\n`;
      }
      formattedContent += `\n`;
    }

    if (enhanced.exceptions && enhanced.exceptions.length > 0) {
      formattedContent += `## Exceptions\n\n`;
      for (const exception of enhanced.exceptions) {
        formattedContent += `- ${exception}\n`;
      }
      formattedContent += `\n`;
    }

    return {
      ...basicContent,
      content: formattedContent,
      title: enhanced.title,
      description: enhanced.description,
      reason: enhanced.rationale,
      how_to_apply: enhanced.how_to_apply,
      when_to_use: enhanced.when_to_use,
      exceptions: enhanced.exceptions,
      related_rules: enhanced.related_patterns
    };
  }

  /**
   * Build enhancement prompt (optimized for token efficiency)
   */
  private buildEnhancementPrompt(pattern: Pattern, basicContent: RuleContent): string {
    // Extract full context from occurrences (not just user_input)
    // Include: user message + context (file paths, action taken)
    const contextExamples = pattern.occurrences
      .filter(o => o.user_input && o.user_input.length > 20)
      .slice(-5)  // Last 5 meaningful occurrences
      .map((o, i) => {
        let example = `${i + 1}. User: ${o.user_input}`;

        // Add context if available
        if (o.context && o.context !== "unknown") {
          example += `\n   Context: ${o.context}`;
        }

        // Add action type
        const actionMap: Record<string, string> = {
          "explicit_correction": "Corrected",
          "accept": "Accepted",
          "reject": "Rejected",
          "amend": "Amended",
          "undo": "Undone"
        };
        const actionLabel = actionMap[o.user_action] || o.user_action;
        example += `\n   Action: ${actionLabel}`;

        // Add metadata hints
        if (o.security_issue) {
          example += `\n   Security: ${o.security_issue}`;
        }
        if (o.performance_improved) {
          example += `\n   Performance: Improved`;
        }

        return example;
      })
      .join('\n\n');

    // Fallback to description if no user inputs
    const contextToUse = contextExamples || `Pattern description: ${pattern.description}`;

    return `Enhance coding rule from user corrections.

Basic: ${basicContent.content.slice(0, 200)}...

Type: ${pattern.type} | Confidence: ${(pattern.confidence * 100).toFixed(0)}% | Count: ${pattern.occurrences.length}
Keywords: ${pattern.keywords.slice(0, 5).join(', ')}

Evidence from sessions:
${contextToUse}

Output JSON:
- title: imperative, 60-80 chars
- description: what to do/avoid, 4-6 sentences, specific
- rationale: why this matters, 3-5 sentences, concrete
- how_to_apply: 4-6 actionable steps (array)
- when_to_use: 3-5 conditions (array)
- exceptions: 2-4 cases (array, optional)
- related_patterns: related rule names (array, optional)

Format: {"title":"...","description":"...","rationale":"...","how_to_apply":[...],"when_to_use":[...],"exceptions":[...]}

Be specific and actionable.`;
  }

  /**
   * Parse enhanced response from LLM
   */
  private parseEnhancedResponse(response: string): {
    title: string;
    description: string;
    rationale: string;
    how_to_apply: string[];
    when_to_use: string[];
    exceptions?: string[];
    related_patterns?: string[];
  } {
    try {
      // Extract JSON from markdown code block if present
      let jsonStr = response.trim();
      const jsonMatch = jsonStr.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      if (!parsed.title || !parsed.description || !parsed.rationale) {
        throw new Error("Missing required fields in enhanced response");
      }

      return {
        title: parsed.title,
        description: parsed.description,
        rationale: parsed.rationale,
        how_to_apply: parsed.how_to_apply || [],
        when_to_use: parsed.when_to_use || [],
        exceptions: parsed.exceptions,
        related_patterns: parsed.related_patterns
      };
    } catch (error) {
      // Log detailed error information with full response string
      const errorLog = `\n[${new Date().toISOString()}] [LLM] JSON Parse Error\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}\n` +
        `=== FULL RESPONSE STRING (${response.length} chars) ===\n` +
        `${response}\n` +
        `=== END RESPONSE ===\n`;

      logger.consoleError(errorLog);
      appendFileSync(LLM_LOG_FILE, errorLog, "utf8");

      throw error;
    }
  }

  /**
   * Add code examples to formatted content
   */
  private addExamplesToContent(content: string, examples: CodeExample[]): string {
    let updated = content;

    // Find position to insert (before "When to Use" or at end)
    const insertMarkers = ["## When to Use", "## Exceptions", "## Related"];
    let insertPos = -1;

    for (const marker of insertMarkers) {
      insertPos = updated.indexOf(marker);
      if (insertPos !== -1) break;
    }

    const examplesSection = this.formatExamplesSection(examples);

    if (insertPos !== -1) {
      updated = updated.slice(0, insertPos) + examplesSection + "\n" + updated.slice(insertPos);
    } else {
      updated += "\n" + examplesSection;
    }

    return updated;
  }

  /**
   * Format examples section
   */
  private formatExamplesSection(examples: CodeExample[]): string {
    let section = `## Examples\n\n`;

    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];
      const lang = example.language || "typescript";

      if (i > 0) {
        section += `\n### Example ${i + 1}\n\n`;
      }

      if (example.bad) {
        section += `### ❌ Avoid\n\n\`\`\`${lang}\n${example.bad}\n\`\`\`\n\n`;
      }

      section += `### ✅ Prefer\n\n\`\`\`${lang}\n${example.good}\n\`\`\`\n\n`;
      section += `**Why**: ${example.explanation}\n\n`;
    }

    return section;
  }

  /**
   * Assess rule quality based on multiple dimensions
   * Returns a score between 0.0 (very poor) and 1.0 (excellent)
   */
  private assessRuleQuality(content: RuleContent): number {
    let score = 0;
    let maxScore = 0;

    // 1. Description completeness (0-0.3)
    maxScore += 0.3;
    if (content.description) {
      const desc = content.description;

      // Check for truncation markers
      if (desc.includes("...") || desc.includes("…")) {
        score += 0.05;  // Truncated, very low score
      }
      // Check for corrupted text (乱码, HTML tags, JSON fragments)
      else if (/[^\x00-\x7F]{3,}/.test(desc) && !/[一-龥]{3,}/.test(desc)) {
        score += 0.05;  // Garbled text
      }
      else if (/<[^>]+>/.test(desc) || /\{["\w]+:/.test(desc)) {
        score += 0.1;  // Contains HTML/JSON
      }
      // Check minimum length
      else if (desc.length < 50) {
        score += 0.1;  // Too short
      }
      // Full marks for complete description
      else if (desc.length >= 100 && desc.length <= 500) {
        score += 0.3;
      }
      // Partial marks for reasonable length
      else if (desc.length >= 50) {
        score += 0.2;
      }
    }

    // 2. Rationale/Reason quality (0-0.2)
    maxScore += 0.2;
    if (content.reason) {
      const reason = content.reason;

      // Check for meaningful content (not just pattern metadata)
      if (reason.includes("Corrected") && reason.includes("times in") && reason.length < 100) {
        score += 0.05;  // Auto-generated metadata, not real rationale
      }
      else if (reason.length >= 50 && !reason.includes("...")) {
        score += 0.2;
      }
      else if (reason.length >= 20) {
        score += 0.1;
      }
    }

    // 3. Actionable steps (0-0.2)
    maxScore += 0.2;
    if (content.how_to_apply && content.how_to_apply.length > 0) {
      const steps = content.how_to_apply;

      // Check if steps are generic or specific
      const hasSpecificSteps = steps.some(step =>
        step.length > 20 && (
          /\w+\(/.test(step) ||  // Contains function calls
          /`[^`]+`/.test(step) ||  // Contains code
          /\b(check|verify|add|remove|use|call|import|export)\b/i.test(step)  // Action verbs
        )
      );

      if (hasSpecificSteps && steps.length >= 3) {
        score += 0.2;
      } else if (steps.length >= 2) {
        score += 0.1;
      } else {
        score += 0.05;
      }
    }

    // 4. Code examples (0-0.2)
    maxScore += 0.2;
    if (content.examples && content.examples.length > 0) {
      const example = content.examples[0];

      // Check if examples are real code (not fragments)
      if (example.good && example.good.length > 20 && !example.good.includes("...")) {
        score += 0.15;
        // Bonus for having both good and bad examples
        if (example.bad && example.bad.length > 20) {
          score += 0.05;
        }
      }
    }

    // 5. Content formatting (0-0.1)
    maxScore += 0.1;
    const formattedContent = content.content || "";

    // Check for proper markdown structure
    const hasHeaders = /^#{1,3}\s+\w+/m.test(formattedContent);
    const hasLists = /^[\*\-]\s+\w+/m.test(formattedContent);
    const hasCodeBlocks = /```[\w]*\n/.test(formattedContent);

    if (hasHeaders && (hasLists || hasCodeBlocks)) {
      score += 0.1;
    } else if (hasHeaders) {
      score += 0.05;
    }

    return score / maxScore;  // Normalize to 0-1
  }

  /**
   * Calculate dynamic max_tokens based on pattern complexity
   */
  private calculateMaxTokens(pattern: Pattern): number {
    // Security patterns need more detailed explanations
    if (pattern.type === "security") {
      return 1500;
    }

    // High confidence + many occurrences = important rule
    if (pattern.confidence >= 0.8 && pattern.occurrences.length >= 5) {
      return 1200;
    }

    // Simple preferences with few occurrences
    if (pattern.type === "preference" && pattern.occurrences.length < 3) {
      return 700;
    }

    // Anti-patterns need good explanations
    if (pattern.type === "anti-pattern") {
      return 1200;
    }

    // Default: moderate complexity
    return 900;
  }

  /**
   * Extract scene and keywords from pattern
   */
  private extractSceneFromPattern(pattern: Pattern): { scene: Scene; keywords: string[] } {
    // Collect all text from pattern for analysis
    const texts: string[] = [];

    // Add description
    if (pattern.description) {
      texts.push(pattern.description);
    }

    // Add user inputs and contexts from occurrences
    for (const occurrence of pattern.occurrences) {
      if (occurrence.user_input) {
        texts.push(occurrence.user_input);
      }
      if (occurrence.context) {
        texts.push(occurrence.context);
      }
    }

    const combinedText = texts.join(' ').toLowerCase();

    // Extract tech stack
    const tech: string[] = [];
    const techKeywords: Record<string, string[]> = {
      react: ['react', 'jsx', 'tsx', 'useeffect', 'usestate', 'component', 'hook'],
      vue: ['vue', 'vuex', 'composition api', '.vue'],
      nextjs: ['next.js', 'nextjs', 'getserversideprops', 'getstaticprops'],
      typescript: ['typescript', 'ts', 'type', 'interface', '.ts', '.tsx'],
      javascript: ['javascript', 'js', '.js', '.jsx'],
      python: ['python', '.py', 'def ', 'import '],
      prisma: ['prisma', 'schema.prisma', '@prisma'],
      graphql: ['graphql', 'query', 'mutation', 'resolver'],
      express: ['express', 'app.get', 'app.post', 'middleware'],
      fastapi: ['fastapi', 'fastapi', '@app.get', '@app.post'],
      nodejs: ['node', 'nodejs', 'npm', 'package.json'],
      jest: ['jest', 'describe(', 'test(', 'expect('],
      vitest: ['vitest', 'describe(', 'test(', 'expect(']
    };

    for (const [techName, keywords] of Object.entries(techKeywords)) {
      if (keywords.some(kw => combinedText.includes(kw))) {
        tech.push(techName);
      }
    }

    // Extract functional domain
    const functional: string[] = [];
    const functionalKeywords: Record<string, string[]> = {
      auth: ['auth', 'login', 'logout', 'jwt', 'token', 'session', 'password'],
      api: ['api', 'endpoint', 'route', 'handler', 'request', 'response', 'rest'],
      database: ['database', 'db', 'query', 'migration', 'schema', 'sql', 'select', 'insert'],
      ui: ['ui', 'component', 'button', 'modal', 'form', 'layout', 'style', 'css'],
      testing: ['test', 'spec', 'jest', 'vitest', 'cypress', 'mock', 'assert'],
      performance: ['performance', 'optimization', 'memo', 'cache', 'slow', 'fast'],
      security: ['security', 'xss', 'csrf', 'injection', 'sanitize', 'validate'],
      'error-handling': ['error', 'exception', 'try', 'catch', 'throw'],
      state: ['state', 'redux', 'store', 'context', 'useState']
    };

    for (const [funcName, keywords] of Object.entries(functionalKeywords)) {
      if (keywords.some(kw => combinedText.includes(kw))) {
        functional.push(funcName);
      }
    }

    // Extract business domain (less common, more specific)
    const business: string[] = [];
    const businessKeywords: Record<string, string[]> = {
      'e-commerce': ['shop', 'cart', 'checkout', 'product', 'order', 'payment'],
      payment: ['stripe', 'paypal', 'transaction', 'billing'],
      crm: ['customer', 'lead', 'contact', 'crm'],
      'user-management': ['user', 'profile', 'account', 'registration', 'signup']
    };

    for (const [bizName, keywords] of Object.entries(businessKeywords)) {
      if (keywords.some(kw => combinedText.includes(kw))) {
        business.push(bizName);
      }
    }

    // Extract keywords (important terms from pattern)
    const keywords = new Set<string>();

    // Add pattern type as keyword
    keywords.add(pattern.type);

    // Add existing keywords from pattern
    if (pattern.keywords) {
      pattern.keywords.forEach(kw => keywords.add(kw));
    }

    // Extract important technical terms (camelCase, PascalCase, snake_case identifiers)
    const identifierRegex = /\b([a-z][a-zA-Z0-9_]*|[A-Z][a-zA-Z0-9]*)\b/g;
    const matches = combinedText.match(identifierRegex);
    if (matches) {
      // Take most frequent terms (simple heuristic)
      const termCounts = new Map<string, number>();
      for (const match of matches) {
        if (match.length > 3 && !['this', 'that', 'from', 'with', 'have', 'should'].includes(match)) {
          termCounts.set(match, (termCounts.get(match) || 0) + 1);
        }
      }

      // Add top 5 most frequent terms
      const topTerms = Array.from(termCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([term]) => term);
      topTerms.forEach(term => keywords.add(term));
    }

    // Add tech and functional domains as keywords
    tech.forEach(t => keywords.add(t));
    functional.forEach(f => keywords.add(f));

    return {
      scene: {
        tech: [...new Set(tech)],
        functional: [...new Set(functional)],
        business: [...new Set(business)]
      },
      keywords: Array.from(keywords).slice(0, 15) // Limit to 15 keywords
    };
  }
}
