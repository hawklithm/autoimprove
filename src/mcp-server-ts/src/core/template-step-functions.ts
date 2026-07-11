/**
 * Template Step Functions — actual implementations of step functions used by rule templates.
 *
 * Connects template execution to existing AutoImprove components:
 * - session-analyzer: Pattern detection
 * - code-example-extractor: Before/after code extraction
 * - scene-extractor: Scene detection from files
 */

import { logger } from './logger.js';
import { CodeExampleExtractor } from './code-example-extractor.js';
import { JSONLParser, SessionData } from './jsonl-parser.js';
import type { Pattern, Scene } from './models.js';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

export type StepFunction = (inputs: Record<string, any>) => Promise<any>;

/**
 * Register actual step function implementations.
 */
export function registerStepFunctions(): Map<string, StepFunction> {
  const functions = new Map<string, StepFunction>();
  const exampleExtractor = new CodeExampleExtractor();
  const parser = new JSONLParser();

  /**
   * Extract file context from session.
   * Returns: { files: string[], content: string }
   */
  functions.set('extract_file_context', async (inputs) => {
    logger.debug('step-function', 'extract_file_context', { inputs });

    const sessionId = inputs.session_id;
    const sessionDir = inputs.session_dir || join(homedir(), '.claude', 'sessions');

    try {
      const sessionPath = join(sessionDir, `${sessionId}.jsonl`);
      const sessionData = parser.parseFile(sessionPath);

      // Extract file paths from Read/Edit/Write tool calls
      const files = new Set<string>();
      for (const turn of sessionData.messages) {
        // SessionData from jsonl-parser has messages array
        if ((turn as any).tool_calls) {
          for (const tool of (turn as any).tool_calls) {
            const toolName = tool.function?.name || tool.name;
            const toolInput = tool.function?.arguments ? JSON.parse(tool.function.arguments) : tool.input;

            if ((toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') && toolInput?.file_path) {
              files.add(toolInput.file_path);
            }
          }
        }
      }

      const fileList = Array.from(files);
      return {
        files: fileList,
        session_count: 1,
        content: `Files touched in session ${sessionId}:\n${fileList.join('\n')}`,
      };
    } catch (error: any) {
      logger.warn('step-function', `extract_file_context failed: ${error.message}`);
      return {
        files: [],
        session_count: 0,
        content: 'Failed to extract file context',
      };
    }
  });

  /**
   * Extract user corrections from session messages.
   * Returns: { items: Array<{message, timestamp}>, summary: string }
   */
  functions.set('extract_user_corrections', async (inputs) => {
    logger.debug('step-function', 'extract_user_corrections', { inputs });

    const sessionId = inputs.session_id;
    const sessionDir = inputs.session_dir || join(homedir(), '.claude', 'sessions');

    try {
      const sessionPath = join(sessionDir, `${sessionId}.jsonl`);
      const sessionData = parser.parseFile(sessionPath);

      // Extract user messages that look like corrections
      const correctionKeywords = ['no', 'not', 'dont', 'wrong', 'instead', 'fix', 'change', 'should'];
      const corrections = [];

      for (const turn of sessionData.messages) {
        if (turn.role === 'user') {
          const message = turn.content.toLowerCase();
          if (correctionKeywords.some(kw => message.includes(kw))) {
            corrections.push({
              message: turn.content,
              timestamp: turn.timestamp || '',
            });
          }
        }
      }

      return {
        items: corrections,
        summary: `Found ${corrections.length} correction messages in session ${sessionId}`,
      };
    } catch (error: any) {
      logger.warn('step-function', `extract_user_corrections failed: ${error.message}`);
      return {
        items: [],
        summary: 'Failed to extract corrections',
      };
    }
  });

  /**
   * Extract code before/after examples from pattern.
   * Returns: { examples: CodeExample[] }
   */
  functions.set('extract_code_before_after', async (inputs) => {
    logger.debug('step-function', 'extract_code_before_after', { inputs });

    const pattern = inputs.pattern as Pattern;
    const sessionDir = inputs.session_dir || join(homedir(), '.claude', 'sessions');
    const maxExamples = inputs.max_examples || 3;

    try {
      const examples = exampleExtractor.extractExamples(pattern, sessionDir);
      return {
        examples: examples.slice(0, maxExamples),
      };
    } catch (error: any) {
      logger.warn('step-function', `extract_code_before_after failed: ${error.message}`);
      return {
        examples: [],
      };
    }
  });

  /**
   * Detect scene from file paths.
   * Returns: { scenes: Scene }
   */
  functions.set('detect_scene_from_files', async (inputs) => {
    logger.debug('step-function', 'detect_scene_from_files', { inputs });

    const files = inputs.files || [];

    // Simple file extension-based scene detection
    const scene: Scene = { tech: [], functional: [], business: [] };

    for (const file of files) {
      const ext = file.split('.').pop()?.toLowerCase();
      if (ext === 'ts' || ext === 'tsx') {
        if (!scene.tech.includes('typescript')) scene.tech.push('typescript');
        if (file.includes('react') || ext === 'tsx') {
          if (!scene.tech.includes('react')) scene.tech.push('react');
        }
      } else if (ext === 'js' || ext === 'jsx') {
        if (!scene.tech.includes('javascript')) scene.tech.push('javascript');
      } else if (ext === 'py') {
        if (!scene.tech.includes('python')) scene.tech.push('python');
      } else if (ext === 'go') {
        if (!scene.tech.includes('golang')) scene.tech.push('golang');
      } else if (ext === 'rs') {
        if (!scene.tech.includes('rust')) scene.tech.push('rust');
      }

      // Functional scene from path
      if (file.includes('auth') || file.includes('login')) {
        if (!scene.functional.includes('authentication')) scene.functional.push('authentication');
      } else if (file.includes('api') || file.includes('endpoint')) {
        if (!scene.functional.includes('api')) scene.functional.push('api');
      } else if (file.includes('test')) {
        if (!scene.functional.includes('testing')) scene.functional.push('testing');
      } else if (file.includes('db') || file.includes('database')) {
        if (!scene.functional.includes('database')) scene.functional.push('database');
      }
    }

    return { scenes: scene };
  });

  /**
   * Assemble final rule markdown.
   * Returns: { rule_id, content, metadata }
   */
  functions.set('assemble_rule_markdown', async (inputs) => {
    logger.debug('step-function', 'assemble_rule_markdown', { inputs });

    const ruleId = inputs.rule_id;
    const title = inputs.title || 'Generated Rule';
    const description = inputs.description || '';
    const rationale = inputs.rationale || '';
    const howTo = inputs.how_to_apply || [];
    const whenToUse = inputs.when_to_use || [];
    const exceptions = inputs.exceptions || [];
    const examples = inputs.examples || [];

    let content = `# ${title}\n\n`;
    content += `## Description\n\n${description}\n\n`;

    if (rationale) {
      content += `## Rationale\n\n${rationale}\n\n`;
    }

    if (howTo.length > 0) {
      content += `## How to Apply\n\n`;
      for (const step of howTo) {
        content += `- ${step}\n`;
      }
      content += `\n`;
    }

    if (whenToUse.length > 0) {
      content += `## When to Use\n\n`;
      for (const condition of whenToUse) {
        content += `- ${condition}\n`;
      }
      content += `\n`;
    }

    if (exceptions.length > 0) {
      content += `## Exceptions\n\n`;
      for (const exception of exceptions) {
        content += `- ${exception}\n`;
      }
      content += `\n`;
    }

    if (examples.length > 0) {
      content += `## Examples\n\n`;
      for (let i = 0; i < examples.length; i++) {
        const ex = examples[i];
        content += `### Example ${i + 1}\n\n`;
        if (ex.before) {
          content += `**Before:**\n\`\`\`${ex.language || ''}\n${ex.before}\n\`\`\`\n\n`;
        }
        if (ex.after) {
          content += `**After:**\n\`\`\`${ex.language || ''}\n${ex.after}\n\`\`\`\n\n`;
        }
        if (ex.file_path) {
          content += `*File: ${ex.file_path}*\n\n`;
        }
      }
    }

    return {
      rule_id: ruleId,
      content,
      metadata: {
        pattern_type: inputs.pattern_type,
        confidence: inputs.confidence || 0.7,
        priority: inputs.priority || 'medium',
      },
    };
  });

  /**
   * Extract anti-pattern details.
   * Returns: { summary, code_snippets, keywords }
   */
  functions.set('extract_anti_pattern_details', async (inputs) => {
    logger.debug('step-function', 'extract_anti_pattern_details', { inputs });

    const pattern = inputs.pattern as Pattern;

    // Build summary from pattern occurrences
    const summary = `Anti-pattern detected ${pattern.occurrences.length} times. ` +
      `Description: ${pattern.description}`;

    // Extract code snippets from pattern context
    const codeSnippets = pattern.occurrences
      .filter(occ => occ.context)
      .slice(0, 3)
      .map(occ => occ.context);

    const keywords = pattern.keywords || [];

    return {
      summary,
      code_snippets: codeSnippets,
      keywords,
    };
  });

  /**
   * Extract performance metrics.
   * Returns: { summary, before, after, improvement, code_snippets, optimization_type }
   */
  functions.set('extract_performance_metrics', async (inputs) => {
    logger.debug('step-function', 'extract_performance_metrics', { inputs });

    const pattern = inputs.pattern as Pattern;

    // Try to extract performance numbers from pattern description
    const numberRegex = /(\d+(?:\.\d+)?)\s*(ms|s|MB|KB|%)/g;
    const matches = [...pattern.description.matchAll(numberRegex)];

    let before = 'N/A';
    let after = 'N/A';
    let improvement = 'N/A';

    if (matches.length >= 2) {
      before = `${matches[0][1]}${matches[0][2]}`;
      after = `${matches[1][1]}${matches[1][2]}`;

      // Calculate improvement if units match
      if (matches[0][2] === matches[1][2]) {
        const beforeVal = parseFloat(matches[0][1]);
        const afterVal = parseFloat(matches[1][1]);
        const pct = ((beforeVal - afterVal) / beforeVal * 100).toFixed(1);
        improvement = `${pct}%`;
      }
    }

    return {
      summary: pattern.description,
      before,
      after,
      improvement,
      code_snippets: pattern.occurrences.slice(0, 2).map(occ => occ.context),
      optimization_type: 'general',
    };
  });

  /**
   * Extract preference patterns.
   * Returns: { summary, examples }
   */
  functions.set('extract_preference_patterns', async (inputs) => {
    logger.debug('step-function', 'extract_preference_patterns', { inputs });

    const pattern = inputs.pattern as Pattern;

    return {
      summary: pattern.description,
      examples: pattern.occurrences.slice(0, 3).map(occ => ({
        context: occ.context,
        timestamp: occ.timestamp,
      })),
    };
  });

  /**
   * Extract security issue details.
   * Returns: { summary, code_snippets, severity, vulnerability_type }
   */
  functions.set('extract_security_issue', async (inputs) => {
    logger.debug('step-function', 'extract_security_issue', { inputs });

    const pattern = inputs.pattern as Pattern;

    // Detect vulnerability type from keywords
    const desc = pattern.description.toLowerCase();
    let vulnerabilityType = 'general';
    let severity = 'medium';

    if (desc.includes('sql') || desc.includes('injection')) {
      vulnerabilityType = 'injection';
      severity = 'critical';
    } else if (desc.includes('xss') || desc.includes('script')) {
      vulnerabilityType = 'xss';
      severity = 'high';
    } else if (desc.includes('auth') || desc.includes('permission')) {
      vulnerabilityType = 'authorization';
      severity = 'high';
    } else if (desc.includes('crypto') || desc.includes('hash')) {
      vulnerabilityType = 'cryptography';
      severity = 'high';
    }

    return {
      summary: pattern.description,
      code_snippets: pattern.occurrences.slice(0, 2).map(occ => occ.context),
      severity,
      vulnerability_type: vulnerabilityType,
    };
  });

  return functions;
}
