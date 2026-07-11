/**
 * Rule Template Compiler — translates declarative Markdown templates into executable rule generation workflows.
 *
 * Inspired by OpenSquilla's SOP compiler, adapted for AutoImprove's rule generation use case.
 *
 * Four stages:
 * 1. Lexer (_lex) — line-based scanner producing tokens with SourceSpan
 * 2. Parser (_parse) — token stream → RuleTemplateAST
 * 3. Validator (_validate) — reference checking + cycle detection
 * 4. Emitter (_emit) — AST → CompiledRuleTemplate
 *
 * Public API:
 * - compile() — driver that runs all four stages
 * - RuleTemplateCompileError — parse-time error with line/column info
 */

import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * Source location for error reporting.
 * Lines and columns are 1-indexed (matches editor conventions).
 */
export interface SourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  excerpt: string; // Truncated to ~80 chars for display
}

/**
 * Compile-time error with structured location info.
 */
export class RuleTemplateCompileError extends Error {
  constructor(
    public readonly templateName: string,
    public readonly phaseIndex: number | null,
    public readonly span: SourceSpan | null,
    public readonly reason: string,
  ) {
    super(RuleTemplateCompileError._render(templateName, phaseIndex, span, reason));
    this.name = 'RuleTemplateCompileError';
  }

  private static _render(
    templateName: string,
    phaseIndex: number | null,
    span: SourceSpan | null,
    reason: string,
  ): string {
    const parts: string[] = [templateName];
    if (phaseIndex !== null) {
  parts.push(`Phase ${phaseIndex}`);
    }
    if (span !== null) {
      parts.push(`line ${span.startLine}`);
    }
    const head = parts.join(':') + ': ' + reason;
    if (span !== null && span.excerpt) {
      return head + '\n> ' + span.excerpt;
    }
    return head;
  }
}

/**
 * Token types emitted by lexer.
 */
export enum TokenType {
  FRONTMATTER_END = 'frontmatter_end',
  PHASE_HEADING = 'phase_heading', // ## Phase N: title [annotations]
  FENCED_YAML_FOR_EACH = 'fenced_yaml_for_each',
  INVOCATION_LINE = 'invocation_line', // Run/Invoke
  WITH_BULLET = 'with_bullet', // - key: value
  SAVE_AS_LINE = 'save_as_line', // Save as `id`.
  BLANK = 'blank',
  TEXT = 'text',
}

export interface Token {
  type: TokenType;
  span: SourceSpan;
  payload: Record<string, string>;
}

/**
 * AST nodes
 */
export interface RuleInvocation {
  stepName: string; // e.g., "extract_context"
  kindHint: string | null; // 'function_call' | 'llm_call' | null
  withArgs: Record<string, string>;
  stepIdTemplate: string;
  span: SourceSpan;
}

export interface RulePhase {
  index: number;
  title: string;
  annotations: Record<string, string>; // parallel, de_on, parallel for_each
  invocations: RuleInvocation[];
  forEachVar: string | null;
  forEachItems: Array<Record<string, string>>;
  span: SourceSpan | null;
}

export interface RuleTemplateAST {
  name: string;
  patternType: string; // repeated-correction, anti-pattern, etc.
  minOccurrences?: number;
  phases: RulePhase[];
}

/**
 * Compiled output — ready for execution
 */
export interface CompiledStep {
  id: string;
  kind: 'function_call' | 'llm_call' | 'parallel';
  function?: string;
  dependsOn: string[];
  inputs: Record<string, string>; // May contain template variables like {{ pattern.* }}
}

export interface CompiledRuleTemplate {
  name: string;
  patternType: string;
  minOccurrences?: number;
  steps: CompiledStep[];
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

const PHASE_HEADING_RE = /^##\s+Phase\s+(?<num>\d+)\s*:\s*(?<title>[^\[]+?)\s*(?:\[(?<annotations>(?:[^\[\]]|\[[^\[\]]*\])*)\])?\s*$/;
const INVOCATION_RUN_RE = /^(?<verb>Run|Invoke|Call)\s+/;
const WITH_BULLET_RE = /^-\s+(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?<value>.+)$/;
const SAVE_AS_RE = /^Save\s+as\s+`(?<id>[^`]+)`\s*\.?\s*$/;
const FENCE_START_RE = /^```(?<lang>[A-Za-z_][A-Za-z0-9_ ]*)?\s*$/;
const FOR_EACH_FENCE_HINT = 'yaml for_each';

/**
 * Tokenize Markdown body (after frontmatter removal).
 */
function _lex(body: string): Token[] {
  const tokens: Token[] = [];
  const lines = body.split('\n');
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const lineNo = i + 1;
    const stripped = raw.trim();

    // Fenced code block detection
    const fenceMatch = FENCE_START_RE.exec(raw);
    if (fenceMatch) {
      const lang = (fenceMatch.groups?.lang || '').trim();
      // Find closing fence
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '```') {
        j++;
      }
      const fenceLines = lines.slice(i + 1, j);
      if (lang === FOR_EACH_FENCE_HINT) {
        tokens.push({
          type: TokenType.FENCED_YAML_FOR_EACH,
          span: {
            startLine: lineNo + 1,
            startCol: 0,
            endLine: j,
            endCol: 0,
            excerpt: fenceLines.join('\n').substring(0, 120),
          },
          payload: { content: fenceLines.join('\n') },
        });
      }
      // Skip docs code blocks
      i = j + 1;
      continue;
    }

    if (!stripped) {
      tokens.push({
        type: TokenType.BLANK,
        span: { startLine: lineNo, startCol: 0, endLine: lineNo, endCol: 0, excerpt: '' },
        payload: {},
      });
      i++;
      continue;
    }

    // Phase heading
    const phaseMatch = PHASE_HEADING_RE.exec(raw);
    if (phaseMatch) {
      tokens.push({
        type: TokenType.PHASE_HEADING,
        span: {
          startLine: lineNo,
          startCol: 0,
          endLine: lineNo,
          endCol: raw.length,
          excerpt: raw.substring(0, 120),
        },
        payload: {
          num: phaseMatch.groups!.num,
          title: phaseMatch.groups!.title.trim(),
          annotations: (phaseMatch.groups!.annotations || '').trim(),
        },
      });
      i++;
      continue;
    }

    // Invocation line
    if (INVOCATION_RUN_RE.test(stripped)) {
      tokens.push({
        type: TokenType.INVOCATION_LINE,
        span: {
          startLine: lineNo,
          startCol: 0,
          endLine: lineNo,
          endCol: raw.length,
          excerpt: raw.substring(0, 120),
        },
        payload: { line: raw },
      });
      i++;
      continue;
    }

    // Save as line
    const saveMatch = SAVE_AS_RE.exec(stripped);
    if (saveMatch) {
      tokens.push({
        type: TokenType.SAVE_AS_LINE,
        span: {
          startLine: lineNo,
          startCol: 0,
          endLine: lineNo,
          endCol: raw.length,
          excerpt: raw.substring(0, 120),
        },
        payload: { id: saveMatch.groups!.id },
      });
      i++;
      continue;
    }

    // With bullet
    const withMatch = WITH_BULLET_RE.exec(stripped);
    if (withMatch) {
      tokens.push({
        type: TokenType.WITH_BULLET,
        span: {
          startLine: lineNo,
          startCol: 0,
          endLine: lineNo,
          endCol: raw.length,
          excerpt: raw.substring(0, 120),
        },
        payload: {
          key: withMatch.groups!.key,
          value: withMatch.groups!.value.trim(),
        },
      });
      i++;
      continue;
    }

    // Generic text
    tokens.push({
      type: TokenType.TEXT,
      span: {
        startLine: lineNo,
        startCol: 0,
        endLine: lineNo,
        endCol: raw.length,
        excerpt: raw.substring(0, 120),
      },
      payload: {},
    });
    i++;
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const INVOCATION_DETAILED_RE = /^(?<verb>Run|Invoke|Call)\s+`(?<step>[A-Za-z0-9_\-]+)`(?:\s+as\s+(?<kind>[A-Za-z_]+))?(?:\s+with\s*:)?\s*\.?\s*$/;
const INVOCATION_COMBINED_RE = /^(?<verb>Run|Invoke|Call)\s+`(?<step>[A-Za-z0-9_\-]+)`(?:\s+as\s+(?<kind>[A-Za-z_]+))?\s*\.\s+Save\s+as\s+`(?<id>[^`]+)`\s*\.?\s*$/;
const SUPPORTED_KIND_HINTS = new Set(['function_call', 'llm_call']);
const ALLOWED_ANNOTATIONS = new Set(['parallel', 'parallel for_each', 'depends_on']);

function _parseAnnotations(
  raw: string,
  templateName: string,
  phaseIndex: number,
  span: SourceSpan,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;

  for (const rawItem of raw.split(';')) {
    const item = rawItem.trim();
    if (!item) continue;

    let key: string, value: string;
    if (item.includes(':')) {
      const parts = item.split(':');
      key = parts[0].trim();
      value = parts.slice(1).join(':').trim();
    } else {
      key = item;
      value = '';
    }

    if (!ALLOWED_ANNOTATIONS.has(key)) {
      throw new RuleTemplateCompileError(
        templateName,
        phaseIndex,
        span,
        `unknown annotation '${key}'; allowed: ${Array.from(ALLOWED_ANNOTATIONS).join(', ')}`,
      );
    }
    result[key] = value;
  }
  return result;
}

function _parseForEachBlock(
  text: string,
  templateName: string,
  phaseIndex: number,
  span: SourceSpan,
  expectedVar: string,
): { varName: string; items: Array<Record<string, string>> } {
  let data: any;
  try {
    // Simple YAML parsing (could use js-yaml for production)
    data = JSON.parse(text.replace(/:\s*/g, ': ').replace(/\n/g, ','));
  } catch {
    throw new RuleTemplateCompileError(
      templateName,
      phaseIndex,
      span,
      'for_each YAML invalid (expected JSON-like format)',
    );
  }

  if (typeof data !== 'object' || Object.keys(data).length !== 1) {
    throw new RuleTemplateCompileError(
      templateName,
      phaseIndex,
      span,
      'for_each block must have exactly one top-level key (the loop variable)',
    );
  }

  const varName = Object.keys(data)[0];
  const items = data[varName];

  if (varName !== expectedVar) {
    throw new RuleTemplateCompileError(
      templateName,
      phaseIndex,
      span,
      `for_each block key '${varName}' does not match annotation variable '${expectedVar}'`,
    );
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new RuleTemplateCompileError(
      templateName,
      phaseIndex,
      span,
      `for_each '${varName}' must be a non-empty array`,
    );
  }

  const seenIds = new Set<string>();
  const normalised: Array<Record<string, string>> = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (typeof item !== 'object' || item === null) {
      throw new RuleTemplateCompileError(
        templateName,
        phaseIndex,
        span,
        `for_each item[${idx}] must be a mapping, got ${typeof item}`,
      );
    }
    if (!item.id || typeof item.id !== 'string') {
      throw new RuleTemplateCompileError(
        templateName,
        phaseIndex,
        span,
        `for_each item[${idx}] missing required 'id' field`,
      );
    }
    if (seenIds.has(item.id)) {
      throw new RuleTemplateCompileError(
        templateName,
        phaseIndex,
        span,
        `for_each duplicate id '${item.id}' at item[${idx}]`,
      );
    }
    seenIds.add(item.id);
    normalised.push(
      Object.fromEntries(Object.entries(item).map(([k, v]) => [k, String(v)])),
    );
  }

  return { varName, items: normalised };
}

function _parse(tokens: Token[], templateName: string): RuleTemplateAST {
  const phases: RulePhase[] = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type !== TokenType.PHASE_HEADING) {
      i++;
      continue;
    }

    const phaseIndex = parseInt(tok.payload.num, 10);
    const title = tok.payload.title;
    const annotations = _parseAnnotations(
      tok.payload.annotations,
      templateName,
      phaseIndex,
      tok.span,
    );

    let forEachVar: string | null = null;
    let forEachItems: Array<Record<string, string>> = [];

    if (annotations['parallel for_each']) {
      forEachVar = annotations['parallel for_each'];
      if (!forEachVar) {
        throw new RuleTemplateCompileError(
          templateName,
          phaseIndex,
          tok.span,
          'parallel for_each missing variable name',
        );
      }
    }

    i++;
    const invocations: RuleInvocation[] = [];
    let currentStep: string | null = null;
    let currentKind: string | null = null;
    let currentWith: Record<string, string> = {};
    let currentInvSpan: SourceSpan | null = null;
    let forEachSeen = false;

    while (i < tokens.length && tokens[i].type !== TokenType.PHASE_HEADING) {
      const t = tokens[i];

      if (t.type === TokenType.FENCED_YAML_FOR_EACH) {
        if (forEachVar === null) {
          throw new RuleTemplateCompileError(
            templateName,
            phaseIndex,
            t.span,
            "fenced 'yaml for_each' block without [parallel for_each: VAR] annotation",
          );
        }
        if (forEachSeen) {
          throw new RuleTemplateCompileError(
            templateName,
            phaseIndex,
            t.span,
            "multiple 'yaml for_each' blocks in one phase",
          );
        }
        const parsed = _parseForEachBlock(
          t.payload.content,
          templateName,
          phaseIndex,
          t.span,
          forEachVar,
        );
        forEachItems = parsed.items;
        forEachSeen = true;
        i++;
        continue;
      }

      if (t.type === TokenType.INVOCATION_LINE) {
        if (currentStep !== null) {
          throw new RuleTemplateCompileError(
            templateName,
            phaseIndex,
            t.span,
            "new invocation started before previous one's `Save as` line",
          );
        }

        const line = t.payload.line.trim();

        // Check for combined form first
        const combined = INVOCATION_COMBINED_RE.exec(line);
        if (combined) {
          const kind = combined.groups!.kind;
          if (kind && !SUPPORTED_KIND_HINTS.has(kind)) {
            throw new RuleTemplateCompileError(
              templateName,
              phaseIndex,
              t.span,
              `unknown kind '${kind}'; must be one of ${Array.from(SUPPORTED_KIND_HINTS).join(', ')}`,
            );
          }
          invocations.push({
            stepName: combined.groups!.step,
            kindHint: kind || null,
            withArgs: {},
            stepIdTemplate: combined.groups!.id,
            span: t.span,
          });
          i++;
          continue;
        }

        // Detailed form
        const m = INVOCATION_DETAILED_RE.exec(line);
        if (!m) {
          throw new RuleTemplateCompileError(
            templateName,
            phaseIndex,
            t.span,
            `invocation line does not match Run/Invoke grammar: ${line}`,
          );
        }

        currentStep = m.groups!.step;
        currentKind = m.groups!.kind || null;

        if (currentKind && !SUPPORTED_KIND_HINTS.has(currentKind)) {
          throw new RuleTemplateCompileError(
            templateName,
            phaseIndex,
            t.span,
            `unknown kind '${currentKind}'; must be one of ${Array.from(SUPPORTED_KIND_HINTS).join(', ')}`,
          );
        }

        currentWith = {};
        currentInvSpan = t.span;
        i++;
        continue;
      }

      if (t.type === TokenType.WITH_BULLET) {
        if (currentStep === null) {
          throw new RuleTemplateCompileError(
            templateName,
            phaseIndex,
            t.span,
            'with-bullet outside an invocation block',
          );
        }
        currentWith[t.payload.key] = t.payload.value;
        i++;
        continue;
      }

      if (t.type === TokenType.SAVE_AS_LINE) {
        if (currentStep === null) {
          throw new RuleTemplateCompileError(
            templateName,
            phaseIndex,
            t.span,
            '`Save as` line outside an invocation block',
          );
        }
        invocations.push({
          stepName: currentStep,
          kindHint: currentKind,
          withArgs: currentWith,
          stepIdTemplate: t.payload.id,
          span: currentInvSpan!,
        });
        currentStep = null;
        currentKind = null;
        currentWith = {};
        currentInvSpan = null;
        i++;
        continue;
      }

      // BLANK / TEXT — skip
      i++;
    }

    if (currentStep !== null) {
      throw new RuleTemplateCompileError(
        templateName,
        phaseIndex,
        currentInvSpan!,
        "invocation missing `Save as` line",
      );
    }

    if (invocations.length === 0) {
      throw new RuleTemplateCompileError(
        templateName,
        phaseIndex,
        tok.span,
        'phase contains no invocations',
      );
    }

    phases.push({
      index: phaseIndex,
      title,
      annotations,
      invocations,
      forEachVar,
      forEachItems,
      span: tok.span,
    });
  }

  if (phases.length === 0) {
    throw new RuleTemplateCompileError(
      templateName,
      null,
      null,
      "no '## Phase N:' headings found in template body",
    );
  }

  return {
    name: templateName,
    patternType: '', // Will be filled from frontmatter
    phases,
  };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

function _validate(ast: RuleTemplateAST): void {
  // TODO: Implement cycle detection and reference checking
  logger.debug('rule-template-compiler', `Validation for ${ast.name} (placeholder)`);
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

function _stripInlineBackticks(value: string): string {
  if (value.length >= 2 && value[0] === '`' && value[value.length - 1] === '`') {
    return value.substring(1, value.length - 1);
  }
  return value;
}

function _parseDependsOnValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.substring(1, trimmed.length - 1).trim();
    if (!inner) return [];
    return inner.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [trimmed];
}

function _emit(ast: RuleTemplateAST): CompiledStep[] {
  const allSteps: CompiledStep[] = [];
  let previousPhaseStepIds: string[] = [];
  const seenIds = new Set<string>();

  for (const phase of ast.phases) {
    let dependsOn: string[] = [];

    // Resolve depends_on annotation
    if (phase.annotations['depends_on']) {
      dependsOn = _parseDependsOnValue(phase.annotations['depends_on']);
      for (const dep of dependsOn) {
        if (!seenIds.has(dep)) {
          throw new RuleTemplateCompileError(
            ast.name,
            phase.index,
            phase.span,
            `depends_on references unknown step id '${dep}'; defined ids so far: ${Array.from(seenIds).join(', ')}`,
          );
        }
      }
    } else {
      dependsOn = [...previousPhaseStepIds];
    }

    const phaseStepIds: string[] = [];

    if (phase.forEachVar !== null) {
      // Fan-out: each item produces one step
      if (phase.invocations.length !== 1) {
        throw new RuleTemplateCompileError(
          ast.name,
          phase.index,
          phase.span,
          'for_each phase must have exactly one invocation block',
        );
      }

      const inv = phase.invocations[0];
      for (const item of phase.forEachItems) {
        // Substitute step id template (simple implementation)
        let stepId = inv.stepIdTemplate;
        for (const [key, value] of Object.entries(item)) {
          stepId = stepId.replace(new RegExp(`{{\\s*${phase.forEachVar}\\.${key}\\s*}}`, 'g'), value);
        }

        if (seenIds.has(stepId)) {
          throw new RuleTemplateCompileError(
            ast.name,
            phase.index,
            inv.span,
            `duplicate step id '${stepId}' (already defined in an earlier phase)`,
          );
        }
        seenIds.add(stepId);

        // Build per-item with_args
        const finalWith: Record<string, string> = {};
        for (const [key, value] of Object.entries(inv.withArgs)) {
          let substituted = _stripInlineBackticks(value);
          for (const [itemKey, itemValue] of Object.entries(item)) {
            substituted = substituted.replace(
              new RegExp(`{{\\s*${phase.forEachVar}\\.${itemKey}\\s*}}`, 'g'),
              itemValue,
            );
          }
          finalWith[key] = substituted;
        }

        allSteps.push({
          id: stepId,
          kind: inv.kindHint === 'llm_call' ? 'llm_call' : 'function_call',
          function: inv.kindHint === 'llm_call' ? undefined : inv.stepName,
          dependsOn,
          inputs: finalWith,
        });
        phaseStepIds.push(stepId);
      }
    } else {
      // Plain phase
      const isParallel = 'parallel' in phase.annotations;
      if (!isParallel && phase.invocations.length > 1) {
        throw new RuleTemplateCompileError(
          ast.name,
          phase.index,
          phase.span,
          `phase has ${phase.invocations.length} invocations but no [parallel] annotation — add [parallel] or split into multiple phases`,
        );
      }

      for (const inv of phase.invocations) {
        if (seenIds.has(inv.stepIdTemplate)) {
          throw new RuleTemplateCompileError(
            ast.name,
            phase.index,
            inv.span,
            `duplicate step id '${inv.stepIdTemplate}'`,
          );
        }
        seenIds.add(inv.stepIdTemplate);

        const finalWith: Record<string, string> = {};
        for (const [key, value] of Object.entries(inv.withArgs)) {
          finalWith[key] = _stripInlineBackticks(value);
        }

        allSteps.push({
          id: inv.stepIdTemplate,
          kind: inv.kindHint === 'llm_call' ? 'llm_call' : 'function_call',
          function: inv.kindHint === 'llm_call' ? undefined : inv.stepName,
          dependsOn,
          inputs: finalWith,
        });
        phaseStepIds.push(inv.stepIdTemplate);
      }
    }

    previousPhaseStepIds = phaseStepIds;
  }

  return allSteps;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse frontmatter from Markdown (simple YAML parser for name/pattern_type).
 */
function _parseFrontmatter(markdown: string): {
  frontmatter: Record<string, any>;
  body: string;
} {
  const lines = markdown.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: markdown };
  }

  let i = 1;
  const fmLines: string[] = [];
  while (i < lines.length && lines[i].trim() !== '---') {
    fmLines.push(lines[i]);
    i++;
  }

  if (i >= lines.length) {
    throw new Error('Unclosed frontmatter');
  }

  const body = lines.slice(i + 1).join('\n');
  const frontmatter: Record<string, any> = {};

  for (const line of fmLines) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(line.trim());
    if (match) {
      const key = match[1];
      let value: any = match[2].trim();
      // Simple type coercion
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Compile a Markdown rule template into a CompiledRuleTemplate.
 */
export function compile(markdown: string): CompiledRuleTemplate {
  const { frontmatter, body } = _parseFrontmatter(markdown);

  const templateName = frontmatter.name || 'unnamed-template';
  const patternType = frontmatter.pattern_type || frontmatter.patternType || 'unknown';

  const tokens = _lex(body);
  const ast = _parse(tokens, templateName);

  ast.patternType = patternType;
  if (frontmatter.min_occurrences) {
    ast.minOccurrences = frontmatter.min_occurrences;
  }

  _validate(ast);

  const steps = _emit(ast);

  logger.info('rule-template-compiler', `Compiled template '${templateName}' (${steps.length} steps)`);

  return {
    name: templateName,
    patternType,
    minOccurrences: ast.minOccurrences,
    steps,
  };
}
