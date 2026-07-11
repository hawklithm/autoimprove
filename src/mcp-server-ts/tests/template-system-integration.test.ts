/**
 * Integration tests for SOP-style template compiler system
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/core/rule-template-compiler.js';
import { TemplateExecutor } from '../src/core/template-executor.js';
import { registerStepFunctions } from '../src/core/template-step-functions.js';
import { Pattern, PatternType } from '../src/core/models.js';

describe('Template System Integration', () => {
  describe('Template Compilation', () => {
    it('should compile correction pattern template', () => {
      const templateSource = `---
name: test-template
pattern_type: repeated-correction
min_occurrences: 2
---

## Phase 1: Extract Context [parallel]

Run \`extract_file_context\` as function_call with:
- session_id: \`{{ pattern.session_id }}\`

Save as \`context_extraction\`.

## Phase 2: Generate Description [depends_on: [context_extraction]]

Run \`llm_generate_description\` as llm_call with:
- context: \`{{ outputs.context_extraction.content }}\`

Save as \`rule_description\`.

## Phase 3: Assemble Rule [depends_on: [rule_description]]

Run \`assemble_rule_markdown\` as function_call with:
- rule_id: \`test-rule-001\`
- title: \`{{ outputs.rule_description.title }}\`
- description: \`{{ outputs.rule_description.description }}\`

Save as \`final_rule\`.
`;

      const compiled = compile(templateSource);

      expect(compiled.name).toBe('test-template');
      expect(compiled.patternType).toBe('repeated-correction');
      expect(compiled.minOccurrences).toBe(2);
      expect(compiled.steps).toHaveLength(3);

      // Check step 1
      expect(compiled.steps[0].id).toBe('context_extraction');
      expect(compiled.steps[0].kind).toBe('function_call');
      expect(compiled.steps[0].function).toBe('extract_file_context');
      expect(compiled.steps[0].dependsOn).toEqual([]);

      // Check step 2
      expect(compiled.steps[1].id).toBe('rule_description');
      expect(compiled.steps[1].kind).toBe('llm_call');
      expect(compiled.steps[1].dependsOn).toEqual(['context_extraction']);

      // Check step 3
      expect(compiled.steps[2].id).toBe('final_rule');
      expect(compiled.steps[2].function).toBe('assemble_rule_markdown');
      expect(compiled.steps[2].dependsOn).toEqual(['rule_description']);
    });

    it('should handle parallel annotation', () => {
      const templateSource = `---
name: parallel-test
pattern_type: anti-pattern
---

## Phase 1: Parallel Tasks [parallel]

Run \`task_a\` as function_call with:
- input: \`value_a\`

Save as \`result_a\`.

Run \`task_b\` as function_call with:
- input: \`value_b\`

Save as \`result_b\`.

## Phase 2: Merge [depends_on: [result_a, result_b]]

Run \`merge\` as function_call with:
- a: \`{{ outputs.result_a.value }}\`
- b: \`{{ outputs.result_b.value }}\`

Save as \`final_rule\`.
`;

      const compiled = compile(templateSource);

      expect(compiled.steps).toHaveLength(3);
      expect(compiled.steps[0].dependsOn).toEqual([]);
      expect(compiled.steps[1].dependsOn).toEqual([]);
      expect(compiled.steps[2].dependsOn).toEqual(['result_a', 'result_b']);
    });
  });

  describe('For-Each Loop Expansion', () => {
    it('should expand loop variables across pattern occurrences', async () => {
      const templateSource = `---
name: loop-test
pattern_type: repeated-correction
---

## Phase 1: Process Each Occurrence

Run \`process_occurrence\` as function_call with:
- session_id: \`{{ item.session_id }}\`
- context: \`{{ item.context }}\`

Save as \`processed_{{ item.index }}\`.

## Phase 2: Aggregate

Run \`aggregate\` as function_call with:
- count: \`{{ pattern.occurrences.length }}\`

Save as \`final_rule\`.
`;

      const compiled = compile(templateSource);

      // Create pattern with 3 occurrences
      const pattern: Pattern = {
        type: PatternType.REPEATED_CORRECTION,
        description: 'Test pattern',
        occurrences: [
          { session_id: 'session-1', timestamp: '2024-01-01', user_action: 'explicit_correction', context: 'ctx-1' },
          { session_id: 'session-2', timestamp: '2024-01-02', user_action: 'explicit_correction', context: 'ctx-2' },
          { session_id: 'session-3', timestamp: '2024-01-03', user_action: 'explicit_correction', context: 'ctx-3' },
        ],
        first_seen: '2024-01-01',
        last_seen: '2024-01-03',
        confidence: 0.8,
        keywords: ['test'],
      };

      const functions = new Map();
      functions.set('process_occurrence', async (inputs: any) => {
        return { processed: true, session: inputs.session_id };
      });
      functions.set('aggregate', async (inputs: any) => {
        return { count: inputs.count, content: 'Test rule' };
      });

      const executor = new TemplateExecutor(compiled, pattern, functions);
      const result = await executor.execute();

      // Should have expanded into 3 + 1 steps (3 loop iterations + 1 aggregate)
      // Loop variables are expanded with _index suffix
      expect(result.stepOutputs).toHaveProperty('processed_0');
      expect(result.stepOutputs).toHaveProperty('processed_1');
      expect(result.stepOutputs).toHaveProperty('processed_2');
      expect(result.stepOutputs).toHaveProperty('final_rule');
    });
  });

  describe('Parallel Execution', () => {
    it('should execute independent steps in parallel', async () => {
      const templateSource = `---
name: parallel-exec-test
pattern_type: performance
---

## Phase 1: Independent Tasks [parallel]

Run \`slow_task_a\` as function_call with:
- delay: \`100\`

Save as \`result_a\`.

Run \`slow_task_b\` as function_call with:
- delay: \`100\`

Save as \`result_b\`.

## Phase 2: Combine [depends_on: [result_a, result_b]]

Run \`combine\` as function_call with:
- a: \`{{ outputs.result_a.value }}\`
- b: \`{{ outputs.result_b.value }}\`

Save as \`final_rule\`.
`;

      const compiled = compile(templateSource);

      const pattern: Pattern = {
        type: PatternType.PERFORMANCE,
        description: 'Parallel test',
        occurrences: [],
        first_seen: '2024-01-01',
        last_seen: '2024-01-01',
        confidence: 0.7,
        keywords: [],
      };

      const functions = new Map();
      const executionOrder: string[] = [];

      functions.set('slow_task_a', async (inputs: any) => {
        executionOrder.push('start_a');
        await new Promise(resolve => setTimeout(resolve, 50));
        executionOrder.push('end_a');
        return { value: 'A' };
      });

      functions.set('slow_task_b', async (inputs: any) => {
        executionOrder.push('start_b');
        await new Promise(resolve => setTimeout(resolve, 50));
        executionOrder.push('end_b');
        return { value: 'B' };
      });

      functions.set('combine', async (inputs: any) => {
        executionOrder.push('combine');
        return { content: `Combined: ${inputs.a} + ${inputs.b}` };
      });

      const startTime = Date.now();
      const executor = new TemplateExecutor(compiled, pattern, functions);
      await executor.execute();
      const duration = Date.now() - startTime;

      // If executed sequentially, would take ~100ms (2 * 50ms)
      // If executed in parallel, should take ~50ms
      expect(duration).toBeLessThan(80); // Allow some overhead

      // Check execution order: both tasks should start before either finishes
      const startAIndex = executionOrder.indexOf('start_a');
      const startBIndex = executionOrder.indexOf('start_b');
      const endAIndex = executionOrder.indexOf('end_a');
      const endBIndex = executionOrder.indexOf('end_b');

      // Both should start before at least one ends (proving parallelism)
      expect(Math.min(startAIndex, startBIndex)).toBeLessThan(Math.max(endAIndex, endBIndex));
      expect(executionOrder[executionOrder.length - 1]).toBe('combine');
    });
  });

  describe('End-to-End Rule Generation', () => {
    it('should generate complete rule from pattern', async () => {
      const templateSource = `---
name: e2e-test
pattern_type: repeated-correction
---

## Phase 1: Extract Context

Run \`extract_file_context\` as function_call with:
- session_id: \`{{ pattern.occurrences.0.session_id }}\`

Save as \`context\`.

## Phase 2: Assemble Rule

Run \`assemble_rule_markdown\` as function_call with:
- rule_id: \`rule-e2e\`
- title: \`Test Rule\`
- description: \`{{ pattern.description }}\`
- pattern_type: \`{{ pattern.type }}\`
- confidence: \`{{ pattern.confidence }}\`

Save as \`final_rule\`.
`;

      const compiled = compile(templateSource);

      const pattern: Pattern = {
        type: PatternType.REPEATED_CORRECTION,
        description: 'Always use const instead of var',
        occurrences: [
          { session_id: 'session-123', timestamp: '2024-01-01', user_action: 'explicit_correction', context: 'main.ts' },
        ],
        first_seen: '2024-01-01',
        last_seen: '2024-01-01',
        confidence: 0.85,
        keywords: ['const', 'var'],
      };

      const functions = registerStepFunctions();

      const executor = new TemplateExecutor(compiled, pattern, functions);
      const result = await executor.execute();

      expect(result.finalRule).toBeDefined();
      expect(result.finalRule.rule_id).toBe('rule-e2e');
      expect(result.finalRule.content).toContain('Test Rule');
      expect(result.finalRule.content).toContain('Always use const instead of var');
      expect(result.finalRule.metadata.pattern_type).toBe('repeated-correction');
      expect(result.finalRule.metadata.confidence).toBe('0.85');
    });
  });

  describe('Variable Substitution', () => {
    it('should substitute pattern variables', async () => {
      const templateSource = `---
name: var-test
pattern_type: preference
---

## Phase 1: Test

Run \`check_pattern\` as function_call with:
- type: \`{{ pattern.type }}\`
- desc: \`{{ pattern.description }}\`
- conf: \`{{ pattern.confidence }}\`

Save as \`final_rule\`.
`;

      const compiled = compile(templateSource);

      const pattern: Pattern = {
        type: PatternType.PREFERENCE,
        description: 'Prefer arrow functions',
        occurrences: [],
        first_seen: '2024-01-01',
        last_seen: '2024-01-01',
        confidence: 0.75,
        keywords: [],
      };

      let capturedInputs: any = null;
      const functions = new Map();
      functions.set('check_pattern', async (inputs: any) => {
        capturedInputs = inputs;
        return { content: 'ok' };
      });

      const executor = new TemplateExecutor(compiled, pattern, functions);
      await executor.execute();

      expect(capturedInputs).not.toBeNull();
      expect(capturedInputs.type).toBe('preference');
      expect(capturedInputs.desc).toBe('Prefer arrow functions');
      expect(capturedInputs.conf).toBe('0.75');
    });

    it('should substitute output variables', async () => {
      const templateSource = `---
name: output-var-test
pattern_type: security
---

## Phase 1: Step A

Run \`step_a\` as function_call with:
- input: \`value\`

Save as \`result_a\`.

## Phase 2: Step B [depends_on: [result_a]]

Run \`step_b\` as function_call with:
- from_a: \`{{ outputs.result_a.data }}\`

Save as \`final_rule\`.
`;

      const compiled = compile(templateSource);

      const pattern: Pattern = {
        type: PatternType.SECURITY,
        description: 'Test',
        occurrences: [],
        first_seen: '2024-01-01',
        last_seen: '2024-01-01',
        confidence: 0.9,
        keywords: [],
      };

      let capturedInputs: any = null;
      const functions = new Map();
      functions.set('step_a', async () => ({ data: 'output_from_a' }));
      functions.set('step_b', async (inputs: any) => {
        capturedInputs = inputs;
        return { content: 'done' };
      });

      const executor = new TemplateExecutor(compiled, pattern, functions);
      await executor.execute();

      expect(capturedInputs).not.toBeNull();
      expect(capturedInputs.from_a).toBe('output_from_a');
    });
  });
});
