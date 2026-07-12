/**
 * Template Executor — executes compiled rule templates by running steps in dependency order.
 *
 * Features:
 * - Topological sort for step ordering (respects depends_on)
 * - Template variable substitution ({{ pattern.* }}, {{ outputs.* }})
 * - Function call and LLM call execution
 * - Output management and chaining
 */

import { logger } from './logger.js';
import type { CompiledRuleTemplate, CompiledStep } from './rule-template-compiler.js';
import type { Pattern } from './models.js';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface ExecutionContext {
  pattern: Pattern;
  outputs: Map<string, any>;
  functions: Map<string, StepFunction>;
  llmCaller?: LLMCaller;
}

export type StepFunction = (inputs: Record<string, any>) => Promise<any>;
export type LLMCaller = (inputs: Record<string, any>) => Promise<any>;

export interface ExecutionResult {
  finalRule: any;
  stepOutputs: Record<string, any>;
  executionTimeMs: number;
}

// ---------------------------------------------------------------------------
// Template Executor
// ---------------------------------------------------------------------------

export class TemplateExecutor {
  private context: ExecutionContext;
  private template: CompiledRuleTemplate;

  constructor(
    template: CompiledRuleTemplate,
    pattern: Pattern,
    functions: Map<string, StepFunction>,
    llmCaller?: LLMCaller,
  ) {
    this.template = template;
    this.context = {
      pattern,
      outputs: new Map(),
      functions,
      llmCaller,
    };
  }

  /**
   * Execute all steps in dependency order.
   */
  async execute(): Promise<ExecutionResult> {
    const startTime = Date.now();

    logger.info('template-executor', `Executing template '${this.template.name}' for pattern ${this.context.pattern.type}`);

    // Expand for_each loops before sorting
    const expandedSteps = this.expandForEachLoops(this.template.steps);

    // Sort steps by dependencies
    const sortedSteps = this.topologicalSort(expandedSteps);

    logger.debug('template-executor', `Execution order: ${sortedSteps.map(s => s.id).join(' → ')}`);

    // Execute steps with parallel optimization
    await this.executeStepsWithParallelization(sortedSteps);

    // Get final rule from outputs
    const finalRule = this.context.outputs.get('final_rule');
    if (!finalRule) {
      throw new Error('Template execution did not produce final_rule output');
    }

    const executionTimeMs = Date.now() - startTime;

    logger.info('template-executor', `Template execution completed in ${executionTimeMs}ms`);

    return {
      finalRule,
      stepOutputs: Object.fromEntries(this.context.outputs),
      executionTimeMs,
    };
  }

  /**
   * Execute steps with parallelization.
   * Groups steps that can run in parallel (same dependency level) and executes them concurrently.
   */
  private async executeStepsWithParallelization(sortedSteps: CompiledStep[]): Promise<void> {
    const executed = new Set<string>();

    while (executed.size < sortedSteps.length) {
      // Find all steps whose dependencies are satisfied
      const readySteps = sortedSteps.filter(step =>
        !executed.has(step.id) &&
        step.dependsOn.every(dep => executed.has(dep))
      );

      if (readySteps.length === 0) {
        // Should never happen if topological sort is correct
        const remaining = sortedSteps.filter(s => !executed.has(s.id)).map(s => s.id);
        throw new Error(`Deadlock detected. Remaining steps: ${remaining.join(', ')}`);
      }

      // Execute all ready steps in parallel
      if (readySteps.length > 1) {
        logger.debug('template-executor', `Executing ${readySteps.length} steps in parallel: ${readySteps.map(s => s.id).join(', ')}`);
      }

      await Promise.all(readySteps.map(step => this.executeStep(step)));

      // Mark as executed
      for (const step of readySteps) {
        executed.add(step.id);
      }
    }
  }

  /**
   * Expand for_each loops into independent steps.
   * Steps with loop variables ({{ item.* }}) are replicated per iteration.
   */
  private expandForEachLoops(steps: CompiledStep[]): CompiledStep[] {
    const expanded: CompiledStep[] = [];
    const loopStepIds = new Set<string>(); // Track which steps have loop variables
    const expandedStepMap = new Map<string, string[]>(); // original_id -> [expanded_id_0, expanded_id_1, ...]

    // First pass: identify loop steps and expand them
    for (const step of steps) {
      const hasLoopVar = this.hasLoopVariable(step);

      if (hasLoopVar) {
        loopStepIds.add(step.id);
        const loopItems = this.extractLoopItems(step);

        if (loopItems.length === 0) {
          logger.warn('template-executor', `Step '${step.id}' has loop variables but no loop items found - skipping`);
          continue;
        }

        logger.debug('template-executor', `Expanding step '${step.id}' into ${loopItems.length} iterations`);

        const expandedIds: string[] = [];
        for (let i = 0; i < loopItems.length; i++) {
          const item = loopItems[i];

          // Substitute loop variables in step ID
          let expandedId = step.id.replace(/\{\{\s*item\.(\w+)\s*\}\}/g, (_, field) => {
            return item[field] || '';
          });

          // If ID still contains variables or no substitution happened, append index
          if (expandedId === step.id || expandedId.includes('{{')) {
            expandedId = `${step.id.replace(/\{\{[^}]+\}\}/g, '')}_${i}`;
          }

          expandedIds.push(expandedId);

          const expandedStep: CompiledStep = {
            ...step,
            id: expandedId,
            inputs: this.substituteLoopVariables(step.inputs, item),
            dependsOn: [], // Will fix dependencies in second pass
          };
          expanded.push(expandedStep);
        }
        expandedStepMap.set(step.id, expandedIds);
      } else {
        expanded.push({ ...step, dependsOn: [] }); // Will fix dependencies in second pass
      }
    }

    // Second pass: fix dependencies
    for (const step of expanded) {
      const originalStep = steps.find(s => s.id === step.id || step.id.startsWith(`${s.id}_`));
      if (!originalStep) continue;

      const newDeps: string[] = [];
      for (const dep of originalStep.dependsOn) {
        if (loopStepIds.has(dep)) {
          // Dependency is a loop step - need special handling
          const expandedDeps = expandedStepMap.get(dep);
          if (!expandedDeps) continue;

          if (step.id.includes('_')) {
            // Current step is also expanded - depend on same-index instance
            const currentIndex = parseInt(step.id.split('_').pop() || '0', 10);
            if (currentIndex < expandedDeps.length) {
              newDeps.push(expandedDeps[currentIndex]);
            }
          } else {
            // Current step is not expanded - depend on ALL instances
            newDeps.push(...expandedDeps);
          }
        } else {
          // Dependency is a regular step - keep as-is
          newDeps.push(dep);
        }
      }
      step.dependsOn = newDeps;
    }

    return expanded;
  }

  /**
   * Check if step contains {{ item.* }} loop variables.
   */
  private hasLoopVariable(step: CompiledStep): boolean {
    const inputStr = JSON.stringify(step.inputs);
    return /\{\{\s*item\.\w+\s*\}\}/.test(inputStr);
  }

  /**
   * Extract loop items from pattern context.
   * For now, assumes pattern.occurrences[] as the loop source.
   */
  private extractLoopItems(step: CompiledStep): Array<Record<string, string>> {
    // Check if pattern has occurrences (most common case)
    const pattern = this.context.pattern;
    if (pattern.occurrences && pattern.occurrences.length > 0) {
      return pattern.occurrences.map((occ, idx) => ({
        index: String(idx),
        session_id: occ.session_id || '',
        timestamp: occ.timestamp || '',
        context: occ.context || '',
        user_action: occ.user_action || 'explicit_correction',
      }));
    }

    return [];
  }

  /**
   * Substitute {{ item.* }} variables with actual values from loop item.
   */
  private substituteLoopVariables(
    inputs: Record<string, string>,
    item: Record<string, string>
  ): Record<string, string> {
    const substituted: Record<string, string> = {};

    for (const [key, template] of Object.entries(inputs)) {
      let value = template;

      // Replace {{ item.field }} with item values
      value = value.replace(/\{\{\s*item\.(\w+)\s*\}\}/g, (_, field) => {
        const itemValue = item[field];
        if (itemValue === undefined) {
          logger.warn('template-executor', `Loop variable 'item.${field}' not found in item:`, item);
          return '';
        }
        return itemValue;
      });

      substituted[key] = value;
    }

    return substituted;
  }

  /**
   * Execute a single step.
   */
  private async executeStep(step: CompiledStep): Promise<void> {
    logger.debug('template-executor', `Executing step '${step.id}' (${step.kind})`);

    // Wait for dependencies
    await this.waitForDependencies(step.dependsOn);

    // Resolve template variables in inputs
    const resolvedInputs = this.resolveInputs(step.inputs);

    // Execute based on step kind
    let result: any;
    try {
      if (step.kind === 'llm_call') {
        result = await this.executeLLMCall(resolvedInputs);
      } else if (step.kind === 'function_call') {
        result = await this.executeFunctionCall(step.function!, resolvedInputs);
      } else {
        throw new Error(`Unknown step kind: ${step.kind}`);
      }
    } catch (error: any) {
      // Graceful degradation: if an LLM step fails because no LLM client/key is
      // available, fall back to a local rule-description generator instead of
      // aborting the whole rule generation.
      const isLlmUnavailable =
        step.kind === 'llm_call' &&
        /LLM caller not configured|LLM client not initialized|apiKey|Authentication failed|403|401/i.test(
          error.message || ''
        );
      if (isLlmUnavailable) {
        logger.warn(
          'template-executor',
          `LLM unavailable for step '${step.id}', using local fallback: ${error.message}`
        );
        const fallback = this.generateLocalFallback(step.id);
        this.context.outputs.set(step.id, fallback);
        return;
      }
      logger.error('template-executor', `Step '${step.id}' failed: ${error.message}`);
      throw new Error(`Step '${step.id}' failed: ${error.message}`);
    }

    // Store output
    this.context.outputs.set(step.id, result);

    logger.debug('template-executor', `Step '${step.id}' completed`);
  }

  /**
   * Local fallback used when an LLM step cannot run (no API key / unavailable).
   * Produces the same shape the template expects so downstream assembly still works.
   */
  private generateLocalFallback(stepId: string): Record<string, any> {
    const pattern: any = this.context.pattern || {};
    const desc: string =
      typeof pattern.description === 'string' && pattern.description.trim().length > 0
        ? pattern.description.trim()
        : `${pattern.type || 'pattern'} rule`;
    const keywords: string[] = Array.isArray(pattern.keywords) ? pattern.keywords : [];
    const kwLine = keywords.length > 0 ? keywords.join(', ') : pattern.type || 'general';

    if (stepId === 'rule_description') {
      return {
        description: desc.substring(0, 120),
        rationale: `Detected from user corrections/preferences of type "${pattern.type}". Apply consistently to avoid repeating this mistake.`,
        how_to_apply: [
          `Applies to: ${kwLine}.`,
          'Follow this rule on write/edit operations in matching contexts.',
          'If the situation clearly differs, note the exception rather than forcing it.',
        ].join('\n'),
        exceptions: 'When the user explicitly overrides or the context does not match, defer to user instruction.',
      };
    }

    // Generic fallback for any other llm_call step.
    return { description: desc, raw: desc };
  }

  /**
   * Wait for dependencies to complete.
   */
  private async waitForDependencies(dependsOn: string[]): Promise<void> {
    for (const depId of dependsOn) {
      if (!this.context.outputs.has(depId)) {
        throw new Error(`Dependency '${depId}' not found in outputs (possible cycle or missing step)`);
      }
    }
  }

  /**
   * Resolve template variables in inputs.
   * Supports: {{ pattern.field }}, {{ outputs.step_id.field }}
   */
  private resolveInputs(inputs: Record<string, string>): Record<string, any> {
    const resolved: Record<string, any> = {};

    for (const [key, template] of Object.entries(inputs)) {
      let value = template;

      // Replace {{ pattern.* }} variables
      value = value.replace(/\{\{\s*pattern\.(\w+)\s*\}\}/g, (_, field) => {
        const patternValue = (this.context.pattern as any)[field];
        if (patternValue === undefined) {
          logger.warn('template-executor', `Pattern field '${field}' is undefined`);
          return '';
        }
        return String(patternValue);
      });

      // Replace {{ outputs.*.* }} variables
      value = value.replace(/\{\{\s*outputs\.(\w+)\.(\w+)\s*\}\}/g, (_, stepId, field) => {
        const output = this.context.outputs.get(stepId);
        if (!output) {
          logger.warn('template-executor', `Output '${stepId}' not found`);
          return '';
        }
        const fieldValue = output[field];
        if (fieldValue === undefined) {
          logger.warn('template-executor', `Output field '${stepId}.${field}' is undefined`);
          return '';
        }
        return String(fieldValue);
      });

      // Try to parse as JSON if it looks like an object/array
      if ((value.trim().startsWith('{') && value.trim().endsWith('}')) ||
          (value.trim().startsWith('[') && value.trim().endsWith(']'))) {
        try {
          resolved[key] = JSON.parse(value);
        } catch {
          resolved[key] = value;
        }
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Execute a function call step.
   */
  private async executeFunctionCall(functionName: string, inputs: Record<string, any>): Promise<any> {
    const fn = this.context.functions.get(functionName);
    if (!fn) {
      throw new Error(`Function '${functionName}' not registered`);
    }

    logger.debug('template-executor', `Calling function '${functionName}'`, { inputs });

    const result = await fn(inputs);

    logger.debug('template-executor', `Function '${functionName}' returned`, { result });

    return result;
  }

  /**
   * Execute an LLM call step.
   */
  private async executeLLMCall(inputs: Record<string, any>): Promise<any> {
    if (!this.context.llmCaller) {
      throw new Error('LLM caller not configured');
    }

    logger.debug('template-executor', 'Calling LLM', { promptLength: inputs.prompt_template?.length || 0 });

    const result = await this.context.llmCaller(inputs);

    logger.debug('template-executor', 'LLM returned', { resultLength: JSON.stringify(result).length });

    return result;
  }

  /**
   * Topological sort of steps by dependencies (Kahn's algorithm).
   */
  private topologicalSort(steps: CompiledStep[]): CompiledStep[] {
    const sorted: CompiledStep[] = [];
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();
    const stepMap = new Map<string, CompiledStep>();

    // Build graph
    for (const step of steps) {
      stepMap.set(step.id, step);
      inDegree.set(step.id, 0);
      adjList.set(step.id, []);
    }

    for (const step of steps) {
      for (const dep of step.dependsOn) {
        if (!stepMap.has(dep)) {
          throw new Error(`Step '${step.id}' depends on unknown step '${dep}'`);
        }
        adjList.get(dep)!.push(step.id);
        inDegree.set(step.id, inDegree.get(step.id)! + 1);
      }
    }

    // Find nodes with no incoming edges
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    // Process nodes
    while (queue.length > 0) {
      const id = queue.shift()!;
      sorted.push(stepMap.get(id)!);

      for (const neighbor of adjList.get(id)!) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Check for cycles
    if (sorted.length !== steps.length) {
      const missing = steps.filter(s => !sorted.includes(s)).map(s => s.id);
      throw new Error(`Circular dependency detected. Unreachable steps: ${missing.join(', ')}`);
    }

    return sorted;
  }
}

// ---------------------------------------------------------------------------
// Helper: Register Standard Functions
// ---------------------------------------------------------------------------

/**
 * Register standard step functions used by rule templates.
 */
export function registerStandardFunctions(): Map<string, StepFunction> {
  const functions = new Map<string, StepFunction>();

  // Placeholder implementations - will be connected to actual logic later
  functions.set('extract_file_context', async (inputs) => {
    logger.debug('step-function', 'extract_file_context', { inputs });
    return {
      files: inputs.file_paths || [],
      session_count: 1,
      content: 'File context placeholder',
    };
  });

  functions.set('extract_user_corrections', async (inputs) => {
    logger.debug('step-function', 'extract_user_corrections', { inputs });
    return {
      items: [],
      summary: 'User corrections placeholder',
    };
  });

  functions.set('extract_code_before_after', async (inputs) => {
    logger.debug('step-function', 'extract_code_before_after', { inputs });
    return {
      examples: [],
    };
  });

  functions.set('detect_scene_from_files', async (inputs) => {
    logger.debug('step-function', 'detect_scene_from_files', { inputs });
    return {
      scenes: { tech: [], functional: [], business: [] },
    };
  });

  functions.set('assemble_rule_markdown', async (inputs) => {
    logger.debug('step-function', 'assemble_rule_markdown', { inputs });
    return {
      rule_id: inputs.rule_id,
      content: `# Rule ${inputs.rule_id}\n\n${inputs.description}`,
      metadata: {
        pattern_type: inputs.pattern_type,
        confidence: inputs.confidence,
      },
    };
  });

  functions.set('extract_anti_pattern_details', async (inputs) => {
    logger.debug('step-function', 'extract_anti_pattern_details', { inputs });
    return {
      summary: 'Anti-pattern details placeholder',
      code_snippets: [],
      keywords: [],
    };
  });

  functions.set('extract_performance_metrics', async (inputs) => {
    logger.debug('step-function', 'extract_performance_metrics', { inputs });
    return {
      summary: 'Performance metrics placeholder',
      before: 'N/A',
      after: 'N/A',
      improvement: 'N/A',
      code_snippets: [],
      optimization_type: 'general',
    };
  });

  functions.set('extract_preference_patterns', async (inputs) => {
    logger.debug('step-function', 'extract_preference_patterns', { inputs });
    return {
      summary: 'Preference patterns placeholder',
      examples: [],
    };
  });

  functions.set('extract_security_issue', async (inputs) => {
    logger.debug('step-function', 'extract_security_issue', { inputs });
    return {
      summary: 'Security issue placeholder',
      code_snippets: [],
      severity: 'medium',
      vulnerability_type: 'general',
    };
  });

  return functions;
}
