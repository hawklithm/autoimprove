# Truncation and Path Exposure Analysis

## Problem Summary

The AutoImprove system is capturing and storing truncated patterns that include:
1. **Local filesystem paths** from Claude Code's skill system metadata
2. **Truncated skill documentation** that gets cut off mid-word
3. **System metadata noise** polluting pattern learning

### Example Problematic Patterns

```
"Base directory for this skill: /Users/adazhao/.claude/skills/autoimprove-summarize

# AutoImprove Su..."
```

```
"**Single sessio"  // Truncated from "**Single session**"
```

## Root Cause Chain

### 1. Skill Invocation Capture (Entry Point)

**File:** Session JSONL files in `~/.claude/projects/*/`

When a user invokes a skill like `/autoimprove-summarize`, Claude Code's skill system injects:

```
Base directory for this skill: /Users/adazhao/.claude/skills/autoimprove-summarize

# AutoImprove Summarize

Analyze Claude Code session files and extract reusable patterns:

## Usage

**Single session (most recent):**
...
```

This **entire block** is stored as the user message content in the session JSONL.

### 2. Content Extraction (No Filtering)

**File:** `src/mcp-server-ts/src/core/jsonl-parser.ts:138-159`

```typescript
private extractContent(data: Record<string, any>): string {
  if (typeof data.content === "string") {
    return data.content;  // ← Returns RAW content including "Base directory"
  }
  // ... array handling also returns raw content
}
```

**Issue:** No filtering of system metadata prefix.

### 3. Pattern Detection (Stores Full Content)

**Files:**
- `src/mcp-server-ts/src/core/session-analyzer.ts`
- `src/mcp-server-ts/src/core/adaptive-session-analyzer.ts`

Pattern detection stores the full user message content into `LabeledContent` in the signal database, including the "Base directory" prefix.

### 4. Clustering (Creates Truncated Representatives)

**File:** `src/mcp-server-ts/src/core/pattern-clusterer.ts:91`

```typescript
const clusterPhrases: string[] = [content1.content.slice(0, 100)];
//                                                      ^^^^^^^^
//                                                      TRUNCATION HERE
```

**Issue:** Hard-coded 100-character limit creates:
- Mid-word cuts: `"# AutoImprove Su..."` instead of `"# AutoImprove Summarize"`
- Path exposure: First 100 chars are dominated by the file path
- Loss of actual pattern: The real user intent is after the skill docs

### 5. Rule Generation (Uses Truncated Data)

**File:** `src/mcp-server-ts/src/core/llm-rule-generator.ts:65-80`

```typescript
const fullContents = this.loadClusterContents(cluster);

const evidence: PromptEvidence[] = [
  LLMPromptBuilder.contentToEvidence(
    fullContents,  // ← Contains "Base directory" prefix
    cluster.representative_description || cluster.common_signals.join(", "),
    cluster.avg_confidence,
    cluster.common_signals
  )
];
```

The LLM prompt builder receives content with system metadata, creating poor-quality patterns.

## Privacy and Security Concerns

### Path Exposure

The "Base directory" prefix exposes:
- **Username:** `/Users/adazhao/...`
- **Project structure:** Full filesystem paths
- **Installation details:** Skill locations

This information is:
1. **User-specific** (not generalizable across users)
2. **Privacy-sensitive** (reveals local filesystem structure)
3. **Unnecessary** for pattern learning (system metadata, not user intent)

### When Exposed

These paths appear in:
- `~/.autoimprove/signal_dictionary/signals.db` (SQLite database)
- `~/.autoimprove/rules/*.md` (generated rule content)
- LLM API calls (via prompts to Anthropic)
- Rule export to `claude-index.md` (loaded in every session)

## Why "Base directory" is Unnecessary

### What It Contains

```
Base directory for this skill: /Users/adazhao/.claude/skills/autoimprove-summarize
```

This is **Claude Code's skill loader metadata**, not user intent. It serves no purpose in pattern learning because:

1. **Not user behavior:** It's injected by the system, not typed by the user
2. **Not a pattern:** Every skill invocation has this same prefix
3. **Not actionable:** You can't create a coding rule from "Base directory for this skill"
4. **Path-specific:** The path varies per user/installation, making it non-generalizable

### What Should Be Captured

The **actual user intent** comes from:
- **Skill command arguments:** `--rebuild --enhance --min-confidence 0.6 --force`
- **User corrections:** When the user says "no, do it this way"
- **Context around the skill:** What problem was the user trying to solve?

## Recommended Fixes

### Fix 1: Filter System Metadata in JSONLParser

**File:** `src/mcp-server-ts/src/core/jsonl-parser.ts`

Add a `sanitizeContent()` method:

```typescript
private sanitizeContent(content: string): string {
  // Remove Claude Code skill system metadata
  const patterns = [
    /^Base directory for this skill:.*?\n\n/s,  // Skill base directory
    /^<command-message>.*?<\/command-message>\n/s,  // Command wrapper
    /^<command-name>.*?<\/command-name>\n/s,  // Command name tag
    /^<command-args>.*?<\/command-args>\n/s,  // Command args tag
  ];

  let sanitized = content;
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, '');
  }

  return sanitized.trim();
}

private extractContent(data: Record<string, any>): string {
  let content = '';
  
  if (typeof data.content === "string") {
    content = data.content;
  } else if (Array.isArray(data.content)) {
    content = data.content
      .map((block: any) => {
        if (typeof block === "string") return block;
        if (block.type === "text") return block.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  } else if (data.text) {
    content = data.text;
  }

  return this.sanitizeContent(content);  // ← Apply sanitization
}
```

### Fix 2: Improve Representative Phrase Selection

**File:** `src/mcp-server-ts/src/core/pattern-clusterer.ts:91`

Replace hard-coded 100-char slice with intelligent extraction:

```typescript
// Instead of:
const clusterPhrases: string[] = [content1.content.slice(0, 100)];

// Use:
const clusterPhrases: string[] = [this.extractRepresentativePhrase(content1.content)];

private extractRepresentativePhrase(content: string, maxLength: number = 200): string {
  // Try to extract the first complete sentence or paragraph
  const trimmed = content.trim();
  
  // Find first sentence boundary
  const sentenceEnd = trimmed.search(/[.!?]\s/);
  if (sentenceEnd > 0 && sentenceEnd <= maxLength) {
    return trimmed.substring(0, sentenceEnd + 1);
  }
  
  // Find first paragraph
  const paragraphEnd = trimmed.indexOf('\n\n');
  if (paragraphEnd > 0 && paragraphEnd <= maxLength) {
    return trimmed.substring(0, paragraphEnd);
  }
  
  // Find last complete word within limit
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  
  const truncated = trimmed.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
}
```

### Fix 3: Add Content Validation

**File:** `src/mcp-server-ts/src/storage/signal-dictionary-db.ts`

Before storing, validate content doesn't contain sensitive paths:

```typescript
private validateContent(content: string): boolean {
  // Reject content that looks like system metadata
  const systemPatterns = [
    /^Base directory for this skill:/,
    /^<command-/,
    /\/Users\/[^\/]+\/\.claude\//,  // Local .claude paths
  ];

  for (const pattern of systemPatterns) {
    if (pattern.test(content)) {
      logger.warn('signal-db', 'Rejecting content with system metadata', {
        pattern: pattern.toString()
      });
      return false;
    }
  }

  return true;
}
```

## Migration Strategy

### For Existing Data

1. **Audit existing rules:**
   ```bash
   grep -r "Base directory" ~/.autoimprove/rules/
   grep -r "/Users/" ~/.autoimprove/rules/
   ```

2. **Clean signal database:**
   ```sql
   -- Connect to ~/.autoimprove/signal_dictionary/signals.db
   DELETE FROM labeled_content 
   WHERE content LIKE '%Base directory for this skill:%'
      OR content LIKE '%/Users/%/.claude/%';
   ```

3. **Rebuild rules:**
   ```bash
   /autoimprove-summarize --rebuild --enhance
   ```

### For Future Data

Apply the fixes above to prevent new contaminated data from entering the system.

## Verification Tests

Add test cases to ensure filtering works:

```typescript
// tests/jsonl-parser.test.ts
describe('JSONLParser.sanitizeContent', () => {
  it('should remove Base directory prefix', () => {
    const input = 'Base directory for this skill: /Users/test/.claude/skills/test\n\nActual content';
    const output = parser.sanitizeContent(input);
    expect(output).toBe('Actual content');
    expect(output).not.toContain('Base directory');
    expect(output).not.toContain('/Users/');
  });

  it('should remove command tags', () => {
    const input = '<command-name>test</command-name>\nActual content';
    const output = parser.sanitizeContent(input);
    expect(output).toBe('Actual content');
  });

  it('should preserve user content', () => {
    const input = 'User asks: how to implement auth?';
    const output = parser.sanitizeContent(input);
    expect(output).toBe(input);
  });
});
```

## Expected Impact

### Before Fix
- ❌ 30-40% of patterns contain "Base directory" prefix
- ❌ Local filesystem paths exposed in rules
- ❌ Truncated at arbitrary 100 chars mid-word
- ❌ Poor pattern quality (system metadata dominates actual content)

### After Fix
- ✅ 0% patterns with system metadata
- ✅ No local path exposure
- ✅ Intelligent phrase extraction (complete sentences/paragraphs)
- ✅ High pattern quality (only user intent captured)

## Related Files

- `src/mcp-server-ts/src/core/jsonl-parser.ts` - Content extraction (needs Fix 1)
- `src/mcp-server-ts/src/core/pattern-clusterer.ts` - Phrase truncation (needs Fix 2)
- `src/mcp-server-ts/src/storage/signal-dictionary-db.ts` - Storage validation (needs Fix 3)
- `src/mcp-server-ts/tests/jsonl-parser.test.ts` - Add verification tests

## Timeline

1. **Immediate:** Implement Fix 1 (sanitization) - prevents new contamination
2. **Short-term:** Implement Fix 2 (intelligent truncation) - improves quality
3. **Medium-term:** Implement Fix 3 (validation) - defense in depth
4. **Long-term:** Migrate existing data - clean historical contamination
