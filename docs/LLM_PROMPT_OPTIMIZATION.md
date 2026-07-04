# LLM Prompt Optimization for Rule Generation

## Problem Statement

The original LLM prompt for rule generation was too simple and lacked context about AutoImprove's purpose and quality standards. It didn't explain:
- What AutoImprove is (a learning system that extracts patterns from user corrections)
- The goal of rule generation (prevent future mistakes, not just summarize)
- How to abstract and generalize from specific corrections
- Quality standards for actionable, specific rules

## Original Prompt Issues

**Original prompt (~900 tokens):**
```
Create coding rule from observed patterns.

Type: {type} | Occurrences: {n} | Sessions: {m}
Signals: {...} | Confidence: {x}%

Examples:
{content examples}

Output JSON with:
- title: imperative, 60-80 chars, start with verb
- description: what to do/avoid, 3-5 sentences, specific and clear
...
```

**Problems:**
1. **No context** - LLM doesn't know this is a learning system
2. **Unclear goal** - "Create coding rule" is vague
3. **No abstraction guidance** - How to generalize from examples?
4. **Missing quality criteria** - What makes a rule "good"?
5. **No merge strategy** - How to handle multiple similar corrections?

## Optimized Prompt Structure

**New prompt (~1800 tokens)** - organized into clear sections:

### 1. Context Section (WHO/WHAT)
```markdown
# Context: AutoImprove Learning System

You are analyzing patterns extracted from Claude Code sessions where users 
corrected Claude's code. Your task is to synthesize these corrections into 
a **reusable coding rule** that prevents future mistakes.
```

**Why**: Establishes the learning context and prevention goal upfront.

### 2. Pattern Data Section (EVIDENCE)
```markdown
**Type**: {type} (user corrected same mistake multiple times)
**Evidence**: {n} occurrences across {m} sessions
**Key Signals**: {...}
**Confidence**: {x}%

## Observed Corrections (User → Claude)
{examples}
```

**Why**: Labels data with semantic meaning, frames examples as "corrections" not raw content.

### 3. Task Definition Section (HOW)
```markdown
## Your Task: Abstract & Generalize

**Goal**: Create a rule that:
1. **Captures the root cause** - What mistake pattern is repeating?
2. **Generalizes appropriately** - Abstract to broader principle
3. **Prevents future errors** - Actionable BEFORE making mistake
4. **Balances specificity** - Not too narrow, not too vague

**Critical**: This is NOT just summarizing what happened. You must:
- **Merge similar corrections** - Find common pattern
- **Identify the "why"** - What principle was violated?
- **Make it checkable** - Verify if rule applies BEFORE coding
```

**Why**: 
- Explicit instruction to at and merge, not just summarize
- Defines quality dimensions (root cause, generalization, prevention)
- Emphasizes proactive application

### 4. Output Format Section (STRUCTURE)
```markdown
Return a JSON object with these fields:
{json schema with detailed explanations}
```

**Why**: Structured format with inline guidance for each field.

### 5. Quality Standards Section (CRITERIA)
```markdown
**Title**: Imperative, starts with verb
**Description**: Specific enough to be falsifiable
**Rationale**: Answer "so what?" - what breaks if ignored?
**How to apply**: Concrete checks, not vague suggestions
**Exaealistic code from corrections, not invented
**When to use**: Specific triggers, not broad categories
**Scenes**: Precise tags, generic=true only for universal principles
```

**Why**: 
- Defines "good" vs "bad" for each field
- Provides falsifiability criterion (key for rule quality)
- Emphasizes realism and specificity

### 6. Example Output Section (REFERENCE)
```json
{
  "title": "Use key prop with stable IDs for dynamic lists in React",
  "description": "When rendering lists in React, always provide a key prop...",
  ...
}
```

**Why**: Concrete reference showing desired output quality and structure.

## Key Improvements

### 1. Learning System Context
**Before**: LLM doesn't know where patterns come from  
**After**: "analyzing patterns from sessions where users corrected Claude's code"

### 2. Abstraction Guidance
**Before**: No instruction on how to generalize  
**After**: Explicit 4-point abstraction framework (root cause, generalize, prevent, balance)

### 3. Merge Strategy
**Before**: Each correction treated independently  
**After**: "Merge similar corrections - find common pattern across examples"

### 4. Quality Criteria
**Before**: Length requirements only  
**After**: Falsifiability, checkability, specificity, realism standards

### 5. Semantic Framing
**Before**: "Examples: 1. {content}"  
**After**: "Observed Corrections (User → Claude): 1. {content}"

### 6. Pattern Type Context
**Before**: Just the type name  
**After**: Type + human description (e.g., "repeated-correction: user corrected same mistake multiple times")

## Expected Impact

### Quality Improvements
- **Better abstraction**: Rules should capture underlying principles, not just surface patterns
- **Stronger rationale**: Emphasis on "why" and "what breaks" should yield actionable reasoning
- **More checkable**: "Make it checkable" instruction should produce verifiable how-to steps
- **Fewer duplicates**: Merge guidance should reduce near-duplicate rules

### Token Efficiency
- **Input**: ~1800 tokens (up from 900, but includes comprehensive guidance)
- **Output**: Same structure, but higher quality content
- **Net**: Higher upfront cost, but better rules = fewer regenerations + higher confidence = more auto-application

### Metrics to Watch
1. **Rule specificity**: Count of vague terms ("properly", "correctly", "handle well")
2. **Rationale quality**: Presence of concrete impacts ("causes X bug", "degrades Y performance")
3. **How-to actionability**: Ratio of concrete checks vs vague suggestions
4. **Merge effectiveness**: Reduction in near-duplicate rules (measure via similarity scores)

## Implementation Details

**File**: `src/mcp-server-ts/src/core/llm-rule-generator.ts`  
**Method**: `buildRuleGenerationPrompt()`  
**Lines**: 186-285

**New helper method added**:
```typescript
private getPatternTypeDescription(type: string): string {
  // Maps pattern types to human-readable descriptions
  // e.g., "repeated-correction" → "user corrected same mistake multiple times"
}
```

## Testing Plan

1. **Re-run batch rebuild** with new prompt:
   ```bash
   /autoimprove-summarize --rebuild --enhance --min-confidence 0.6 --force
   ```

2. **Compare rule quality** (before/after):
   - Sample 10 rules from old generation
   - Sample 10 rules from new generation
   - Score on: specificity, rationale quality, actionability, merge effectiveness

3. **Measure token efficiency**:
   - Check `~/.autoimprove/llm-calls.log` for prompt/response sizes
   - Compare generation time (quality vs speed tradeoff)

4. **User feedback**:
   - Monitor `search_knowledge` usage (are rules being applied?)
   - Check feedback types (used vs ignored vs corrected)
   - Track confidence score changes over time

## Rollback Plan

If new prompt produces worse results:
1. Revert `llm-rule-generator.ts` to commit before this change
2. Rebuild: `cd src/mcp-server-ts && npm run build`
3. Clear bad rules: `/autoimprove-rules` → manually delete low-quality ones
4. Re-run with old prompt

## Next Steps

1. ✅ Implement optimized prompt
2. ✅ Build and deploy
3. ⏳ Test with batch rebuild (user action required)
4. ⏳ Compare quality metrics
5. ⏳ Iterate based on results

## Related Files

- `src/mcp-server-ts/src/core/llm-rule-generator.ts` - Prompt implementation
- `src/mcp-server-ts/src/core/models.ts` - Pattern type definitions
- `docs/HYBRID_RULE_GENERATION.md` - 4-phase generation overview
- `docs/TOKEN_OPTIMIZATION_ANALYSIS.md` - Token efficiency analysis
