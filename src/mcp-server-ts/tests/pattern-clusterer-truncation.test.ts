/**
 * Tests for intelligent phrase extraction in PatternClusterer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PatternClusterer } from '../src/core/pattern-clusterer.js';
import { SignalDictionaryDB, LabeledContent } from '../src/storage/signal-dictionary-db.js';
import { PatternType } from '../src/core/models.js';

describe('PatternClusterer Intelligent Truncation', () => {
  let clusterer: PatternClusterer;
  let db: SignalDictionaryDB;

  beforeEach(() => {
    clusterer = new PatternClusterer();
    db = new SignalDictionaryDB();

    // Clean up any existing test data
    db.db.prepare("DELETE FROM labeled_content WHERE session_id LIKE 'test-session%'").run();
  });

  afterEach(() => {
    clusterer.close();
  });

  describe('extractRepresentativePhrase', () => {
    it('should preserve complete words instead of cutting mid-word', async () => {
      const content: LabeledContent = {
        message_id: 'msg-1',
        session_id: 'test-session',
        content: '# AutoImprove Summarize\n\nAnalyze Claude Code session files and extract reusable patterns from your coding history.',
        pattern_type: PatternType.REPEATED_CORRECTION,
        confidence: 0.8,
        matched_signals: '[]',
        labeled_at: new Date().toISOString(),
        labeling_method: 'dictionary',
      };

      // Store and cluster to trigger representative phrase extraction
      db.saveLabeledContent(content);
      const allContent = db.getLabeledContentByPatternType(PatternType.REPEATED_CORRECTION);
      const clusters = await clusterer.clusterPatterns(allContent);

      expect(clusters.length).toBeGreaterThan(0);
      const phrase = clusters[0].representative_phrases[0];

      // Should not end with incomplete words like "Su..." or "sessio"
      expect(phrase).not.toMatch(/\w{2,}\.\.\./);  // Not ending with partial word + ...

      // Should contain complete content or end with "..."
      if (phrase.endsWith('...')) {
        // If truncated, should end at word boundary
        const beforeEllipsis = phrase.slice(0, -3);
        expect(beforeEllipsis).toMatch(/\s$/);  // Ends with whitespace before ...
      }
    });

    it('should extract first complete sentence when within limit', async () => {
      const content: LabeledContent = {
        message_id: 'msg-2',
        session_id: 'test-session',
        content: 'This is the first sentence. This is the second sentence that should not be included.',
        pattern_type: PatternType.REPEATED_CORRECTION,
        confidence: 0.8,
        matched_signals: '[]',
        labeled_at: new Date().toISOString(),
        labeling_method: 'dictionary',
      };

      db.saveLabeledContent(content);
      const allContent = db.getLabeledContentByPatternType(PatternType.REPEATED_CORRECTION);
      const clusters = await clusterer.clusterPatterns(allContent);

      const phrase = clusters[0].representative_phrases[0];

      expect(phrase).toBe('This is the first sentence.');
      expect(phrase).not.toContain('second sentence');
    });

    it('should extract first paragraph when within limit', async () => {
      const content: LabeledContent = {
        message_id: 'msg-3',
        session_id: 'test-session',
        content: 'First paragraph content.\n\nSecond paragraph that should not be included.',
        pattern_type: PatternType.REPEATED_CORRECTION,
        confidence: 0.8,
        matched_signals: '[]',
        labeled_at: new Date().toISOString(),
        labeling_method: 'dictionary',
      };

      db.saveLabeledContent(content);
      const allContent = db.getLabeledContentByPatternType(PatternType.REPEATED_CORRECTION);
      const clusters = await clusterer.clusterPatterns(allContent);

      const phrase = clusters[0].representative_phrases[0];

      expect(phrase).toBe('First paragraph content.');
      expect(phrase).not.toContain('Second paragraph');
    });

    it('should return full content when shorter than limit', async () => {
      const content: LabeledContent = {
        message_id: 'msg-4',
        session_id: 'test-session',
        content: 'Short content',
        pattern_type: PatternType.REPEATED_CORRECTION,
        confidence: 0.8,
        matched_signals: '[]',
        labeled_at: new Date().toISOString(),
        labeling_method: 'dictionary',
      };

      db.saveLabeledContent(content);
      const allContent = db.getLabeledContentByPatternType(PatternType.REPEATED_CORRECTION);
      const clusters = await clusterer.clusterPatterns(allContent);

      const phrase = clusters[0].representative_phrases[0];

      expect(phrase).toBe('Short content');
      expect(phrase).not.toContain('...');
    });

    it('should truncate at word boundary for long content', async () => {
      const longContent = 'A'.repeat(50) + ' word boundary test ' + 'B'.repeat(200);

      const content: LabeledContent = {
        message_id: 'msg-5',
        session_id: 'test-session',
        content: longContent,
        pattern_type: PatternType.REPEATED_CORRECTION,
        confidence: 0.8,
        matched_signals: '[]',
        labeled_at: new Date().toISOString(),
        labeling_method: 'dictionary',
      };

      db.saveLabeledContent(content);
      const allContent = db.getLabeledContentByPatternType(PatternType.REPEATED_CORRECTION);
      const clusters = await clusterer.clusterPatterns(allContent);

      const phrase = clusters[0].representative_phrases[0];

      // Should end with ... since content is too long
      expect(phrase).toMatch(/\.\.\./);

      // Should not cut in middle of 'BBBBB...' string
      expect(phrase).not.toMatch(/B+\.\.\./);

      // Should cut at the space before 'B' characters
      expect(phrase.length).toBeLessThanOrEqual(203); // 200 + "..."
    });

    it('should handle content without sentence boundaries', async () => {
      const content: LabeledContent = {
        message_id: 'msg-6',
        session_id: 'test-session',
        content: 'no sentence markers here just a long continuous text that goes on and on without any punctuation to break it up into readable chunks and continues for quite a while',
        pattern_type: PatternType.REPEATED_CORRECTION,
        confidence: 0.8,
        matched_signals: '[]',
        labeled_at: new Date().toISOString(),
        labeling_method: 'dictionary',
      };

      db.saveLabeledContent(content);
      const allContent = db.getLabeledContentByPatternType(PatternType.REPEATED_CORRECTION);
      const clusters = await clusterer.clusterPatterns(allContent);

      const phrase = clusters[0].representative_phrases[0];

      // Should truncate at word boundary, not mid-word
      if (phrase.endsWith('...')) {
        const beforeEllipsis = phrase.slice(0, -3).trim();
        const lastChar = beforeEllipsis[beforeEllipsis.length - 1];
        // Last character should not be alphanumeric (should be space/punctuation)
        expect(lastChar).toMatch(/\s/);
      }
    });
  });

  describe('Regression: No more "AutoImprove Su..." truncation', () => {
    it('should not create "AutoImprove Su..." pattern', async () => {
      const content: LabeledContent = {
        message_id: 'msg-7',
        session_id: 'test-session',
        content: '# AutoImprove Summarize\n\nAnalyze Claude Code session files',
        pattern_type: PatternType.REPEATED_CORRECTION,
        confidence: 0.8,
        matched_signals: '[]',
        labeled_at: new Date().toISOString(),
        labeling_method: 'dictionary',
      };

      db.saveLabeledContent(content);
      const allContent = db.getLabeledContentByPatternType(PatternType.REPEATED_CORRECTION);
      const clusters = await clusterer.clusterPatterns(allContent);

      const phrase = clusters[0].representative_phrases[0];

      // Should NOT be truncated to "# AutoImprove Su..."
      expect(phrase).not.toBe('# AutoImprove Su...');

      // Should preserve complete title
      expect(phrase).toContain('AutoImprove Summarize');
    });

    it('should not create "**Single sessio" pattern', async () => {
      const content: LabeledContent = {
        message_id: 'msg-8',
        session_id: 'test-session',
        content: '**Single session (most recent):**\n```bash\nnpm run summarize\n```',
        pattern_type: PatternType.REPEATED_CORRECTION,
        confidence: 0.8,
        matched_signals: '[]',
        labeled_at: new Date().toISOString(),
        labeling_method: 'dictionary',
      };

      db.saveLabeledContent(content);
      const allContent = db.getLabeledContentByPatternType(PatternType.REPEATED_CORRECTION);
      const clusters = await clusterer.clusterPatterns(allContent);

      const phrase = clusters[0].representative_phrases[0];

      // Should NOT be truncated to "**Single sessio"
      expect(phrase).not.toBe('**Single sessio');

      // Should preserve complete word "session"
      if (phrase.includes('Single')) {
        expect(phrase).toMatch(/Single session/);
      }
    });
  });

  describe('Multiple representative phrases in cluster', () => {
    it('should apply intelligent truncation to all phrases in cluster', async () => {
      const contents: LabeledContent[] = [
        {
          message_id: 'msg-9',
          session_id: 'test-session-1',
          content: 'First pattern with some content that should be truncated intelligently at word boundaries.',
          pattern_type: PatternType.REPEATED_CORRECTION,
          confidence: 0.8,
          matched_signals: JSON.stringify([{ signal_text: 'common-signal', confidence: 0.8 }]),
          labeled_at: new Date().toISOString(),
          labeling_method: 'dictionary',
        },
        {
          message_id: 'msg-10',
          session_id: 'test-session-2',
          content: 'Second pattern with similar content that should also be truncated intelligently at word boundaries.',
          pattern_type: PatternType.REPEATED_CORRECTION,
          confidence: 0.8,
          matched_signals: JSON.stringify([{ signal_text: 'common-signal', confidence: 0.8 }]),
          labeled_at: new Date().toISOString(),
          labeling_method: 'dictionary',
        },
        {
          message_id: 'msg-11',
          session_id: 'test-session-3',
          content: 'Third pattern with similar content that should also be truncated intelligently at word boundaries.',
          pattern_type: PatternType.REPEATED_CORRECTION,
          confidence: 0.8,
          matched_signals: JSON.stringify([{ signal_text: 'common-signal', confidence: 0.8 }]),
          labeled_at: new Date().toISOString(),
          labeling_method: 'dictionary',
        },
      ];

      contents.forEach(c => db.saveLabeledContent(c));
      const allContent = db.getLabeledContentByPatternType(PatternType.REPEATED_CORRECTION);
      const clusters = await clusterer.clusterPatterns(allContent);

      expect(clusters.length).toBeGreaterThan(0);

      // All representative phrases should be intelligently truncated
      for (const phrase of clusters[0].representative_phrases) {
        // None should end with incomplete words
        if (phrase.endsWith('...')) {
          const beforeEllipsis = phrase.slice(0, -3).trim();
          const lastChar = beforeEllipsis[beforeEllipsis.length - 1];
          expect(lastChar).toMatch(/[\s.!?,;:]/);  // Should end with whitespace or punctuation
        }
      }
    });
  });
});
