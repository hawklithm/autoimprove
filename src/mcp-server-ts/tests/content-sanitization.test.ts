/**
 * Tests for content sanitization in JSONLParser
 */

import { describe, it, expect } from 'vitest';
import { JSONLParser } from '../src/core/jsonl-parser.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('JSONLParser Content Sanitization', () => {
  let parser: JSONLParser;

  beforeEach(() => {
    parser = new JSONLParser();
  });

  describe('Base directory filtering', () => {
    it('should remove "Base directory for this skill:" prefix', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: 'Base directory for this skill: /Users/adazhao/.claude/skills/autoimprove-summarize\n\n# AutoImprove Summarize\n\nActual user content here'
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).not.toContain('Base directory');
      expect(result.messages[0].content).not.toContain('/Users/adazhao');
      expect(result.messages[0].content).toContain('# AutoImprove Summarize');
      expect(result.messages[0].content).toContain('Actual user content');

      unlinkSync(sessionFile);
    });

    it('should handle content without Base directory prefix', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: 'Regular user message without system metadata'
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Regular user message without system metadata');

      unlinkSync(sessionFile);
    });
  });

  describe('Command tag filtering', () => {
    it('should remove <command-message> tags', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<command-message>autoimprove-summarize</command-message>\nActual content'
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);

      expect(result.messages[0].content).not.toContain('<command-message>');
      expect(result.messages[0].content).toBe('Actual content');

      unlinkSync(sessionFile);
    });

    it('should remove <command-name> tags', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<command-name>/autoimprove-summarize</command-name>\nActual content'
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);

      expect(result.messages[0].content).not.toContain('<command-name>');
      expect(result.messages[0].content).toBe('Actual content');

      unlinkSync(sessionFile);
    });

    it('should remove <command-args> tags', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<command-args>--rebuild --enhance</command-args>\nActual content'
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);

      expect(result.messages[0].content).not.toContain('<command-args>');
      expect(result.messages[0].content).toBe('Actual content');

      unlinkSync(sessionFile);
    });
  });

  describe('Real-world skill invocation', () => {
    it('should clean complete skill invocation metadata', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: `Base directory for this skill: /Users/adazhao/.claude/skills/autoimprove-summarize

# AutoImprove Summarize

Analyze Claude Code session files and extract reusable patterns:

## Usage

**Single session (most recent):**
\`\`\`bash
/autoimprove-summarize
\`\`\`

User wants to analyze with --rebuild flag`
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);
      const content = result.messages[0].content;

      // Should not contain system metadata
      expect(content).not.toContain('Base directory');
      expect(content).not.toContain('/Users/');
      expect(content).not.toContain('/.claude/');

      // Should preserve actual content
      expect(content).toContain('# AutoImprove Summarize');
      expect(content).toContain('Analyze Claude Code session files');
      expect(content).toContain('User wants to analyze');

      unlinkSync(sessionFile);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: ''
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);

      expect(result.messages[0].content).toBe('');

      unlinkSync(sessionFile);
    });

    it('should handle content with only system metadata', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: 'Base directory for this skill: /path/to/skill\n\n'
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);

      // After removing metadata, should be empty
      expect(result.messages[0].content).toBe('');

      unlinkSync(sessionFile);
    });

    it('should preserve user content that looks similar to metadata', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: 'The base directory for my project is /home/user/project'
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);

      // Should NOT remove this because pattern requires "Base directory for this skill:"
      expect(result.messages[0].content).toBe('The base directory for my project is /home/user/project');

      unlinkSync(sessionFile);
    });
  });

  describe('Array content format', () => {
    it('should sanitize content from text blocks in arrays', () => {
      const sessionFile = createTestSession([
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Base directory for this skill: /Users/test/.claude/skills/test\n\nActual content'
              }
            ]
          },
          timestamp: '2026-07-05T10:00:00Z'
        }
      ]);

      const result = parser.parseFile(sessionFile);

      expect(result.messages[0].content).not.toContain('Base directory');
      expect(result.messages[0].content).toContain('Actual content');

      unlinkSync(sessionFile);
    });
  });
});

/**
 * Helper to create a test session file
 */
function createTestSession(entries: any[]): string {
  const sessionId = `test-${Date.now()}.jsonl`;
  const filePath = join(tmpdir(), sessionId);

  const jsonlContent = entries
    .map(entry => JSON.stringify(entry))
    .join('\n');

  writeFileSync(filePath, jsonlContent, 'utf-8');

  return filePath;
}
