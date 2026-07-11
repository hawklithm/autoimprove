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

    // Sort steps by dependencies
    const sortedSteps = this.topologicalSort(this.template.steps);

    logger.debug('template-executor', `Execution order: ${sortedSteps.map(s => s.id).join(' → ')}`);

    // Execute steps sequentially (respecting dependencies)
    for (const step of sortedSteps) {
      await this.executeStep(step);
    }

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
      logger.error('template-executor', `Step '${step.id}' failed: ${error.message}`);
      throw new Error(`Step '${step.id}' failed: ${error.message}`);
    }

    // Store output
    this.context.outputs.set(step.id, result);

    logger.debug('template-executor', `Step '${step.id}' completed`);
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
