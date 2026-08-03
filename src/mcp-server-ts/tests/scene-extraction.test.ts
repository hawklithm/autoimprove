/**
 * Test scene and keyword extraction from patterns
 */
import { describe, it, expect } from 'vitest';
import { HybridRuleGenerator } from '../src/core/hybrid-rule-generator.js';
import { Pattern, PatternType, createPattern } from '../src/core/models.js';

describe('Scene and Keyword Extraction', () => {
  const generator = new HybridRuleGenerator();

  it('should extract tech scene from React pattern', async () => {
    const pattern = createPattern({
      type: PatternType.REPEATED_CORRECTION,
      description: 'Use useState hook instead of class state',
      occurrences: [
        {
          session_id: 'test-1',
          timestamp: '2024-01-01T00:00:00Z',
          user_action: 'explicit_correction',
          context: 'Changed class component to use useState hook in React',
          user_input: 'Use React hooks instead'
        }
      ],
      first_seen: '2024-01-01T00:00:00Z',
      last_seen: '2024-01-01T00:00:00Z',
      confidence: 0.8,
      keywords: []
    });

    const result = await generator.generateEnhancedRule(pattern, 'test-rule-1');

    expect(result.indexEntry.scenes.tech).toContain('react');
    expect(result.indexEntry.keywords.length).toBeGreaterThan(0);
  });

  it('should extract functional scene from auth pattern', async () => {
    const pattern = createPattern({
      type: PatternType.SECURITY,
      description: 'Always validate JWT tokens before processing requests',
      occurrences: [
        {
          session_id: 'test-2',
          timestamp: '2024-01-01T00:00:00Z',
          user_action: 'explicit_correction',
          context: 'Added JWT token validation in authentication middleware',
          user_input: 'Need to validate the token first',
          security_issue: 'Missing authentication check'
        }
      ],
      first_seen: '2024-01-01T00:00:00Z',
      last_seen: '2024-01-01T00:00:00Z',
      confidence: 0.9,
      keywords: []
    });

    const result = await generator.generateEnhancedRule(pattern, 'test-rule-2');

    expect(result.indexEntry.scenes.functional).toContain('auth');
    expect(result.indexEntry.scenes.functional).toContain('security');
    expect(result.indexEntry.keywords).toContain('security');
  });

  it('should extract database and API scenes from API pattern', async () => {
    const pattern = createPattern({
      type: PatternType.ANTI_PATTERN,
      description: 'Use parameterized queries to prevent SQL injection',
      occurrences: [
        {
          session_id: 'test-3',
          timestamp: '2024-01-01T00:00:00Z',
          user_action: 'explicit_correction',
          context: 'Changed string concatenation to parameterized query in API endpoint',
          user_input: 'This is vulnerable to SQL injection, use prepared statements'
        }
      ],
      first_seen: '2024-01-01T00:00:00Z',
      last_seen: '2024-01-01T00:00:00Z',
      confidence: 0.95,
      keywords: []
    });

    const result = await generator.generateEnhancedRule(pattern, 'test-rule-3');

    expect(result.indexEntry.scenes.functional).toContain('database');
    expect(result.indexEntry.scenes.functional).toContain('api');
    expect(result.indexEntry.keywords).toContain('anti-pattern');
  });

  it('should extract multiple tech stacks from TypeScript + React pattern', async () => {
    const pattern = createPattern({
      type: PatternType.PREFERENCE,
      description: 'Use TypeScript interfaces for component props',
      occurrences: [
        {
          session_id: 'test-4',
          timestamp: '2024-01-01T00:00:00Z',
          user_action: 'explicit_correction',
          context: 'Added TypeScript interface for React component props in .tsx file',
          user_input: 'Define the interface for these props'
        }
      ],
      first_seen: '2024-01-01T00:00:00Z',
      last_seen: '2024-01-01T00:00:00Z',
      confidence: 0.7,
      keywords: []
    });

    const result = await generator.generateEnhancedRule(pattern, 'test-rule-4');

    expect(result.indexEntry.scenes.tech).toContain('react');
    expect(result.indexEntry.scenes.tech).toContain('typescript');
    expect(result.indexEntry.scenes.functional).toContain('ui');
  });

  it('should limit keywords to 15 items', async () => {
    const pattern = createPattern({
      type: PatternType.REPEATED_CORRECTION,
      description: 'Very long description with many technical terms like useState useEffect useContext useReducer useMemo useCallback useRef useImperativeHandle useLayoutEffect useDebugValue component props state redux store dispatch action reducer middleware saga thunk',
      occurrences: [
        {
          session_id: 'test-5',
          timestamp: '2024-01-01T00:00:00Z',
          user_action: 'explicit_correction',
          context: 'More text with technical terms',
          user_input: 'Even more technical keywords here'
        }
      ],
      first_seen: '2024-01-01T00:00:00Z',
      last_seen: '2024-01-01T00:00:00Z',
      confidence: 0.8,
      keywords: []
    });

    const result = await generator.generateEnhancedRule(pattern, 'test-rule-5');

    expect(result.indexEntry.keywords.length).toBeLessThanOrEqual(15);
  }, 15000);
});
