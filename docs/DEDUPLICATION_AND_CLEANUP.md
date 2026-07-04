# Rule Deduplication and Cleanup

## Overview

AutoImprove now includes automatic rule deduplication and cleanup functionality integrated directly into the `/autoimprove-summarize` workflow. This prevents database bloat and maintains high-quality rules.

## Features

### 1. Automatic Deduplication (During Rule Generation)

When new rules are generated, the system automatically:
- Compares each new rule against existing rules
- Calculates multi-dimensional similarity scores
- Merges highly similar rules (similarity ≥ 0.80)
- Flags moderately similar rules (0.65 ≤ similarity < 0.80) for review

**Similarity Algorithm:**
- Keywords: 50% weight (Jaccard similarity)
- Scenes: 30% weight (tech + functional + business overlap)
- Description: 10% weight (placeholder for future enhancement)
- Pattern Type: 10% weight (same type = bonus)

**Merge Strategy:**
- Keywords: Union of both sets
- Scenes: Union of both sets
- Confidence: Average + 0.05 boost (capped at 0.95)
- Priority: Higher of the two
- Timestamps: Preserve oldest created_at, update updated_at

### 2. Automatic Cleanup (After Rule Generation)

After rules are generated and exported, the system automatically:
- Scans all existing rules for duplicates
- Identifies low-quality rules
- Merges duplicate rule groups
- Optimizes rules with missing metadata
- (Optional) Deletes very low-quality rules

**Quality Assessment Criteria:**
- Keywords: ≥2 keywords required
- Scenes: At least one scene dimension (tech/functional/business)
- Description: ≥30 characters (if content provided)
- Confidence: ≥0.5 baseline threshold

**Quality Score Formula:**
```
overallScore = (keywordScore + sceneScore + descriptionScore + confidenceScore) / 4
```

**Quality Thresholds:**
- High quality: score ≥ 0.7
- Medium quality: 0.5 ≤ score < 0.7
- Low quality: 0.3 ≤ score < 0.5
- Very low quality: score < 0.3

### 3. Rule Optimization

The cleanup service can automatically improve rules by:
- **Keyword Extraction**: Extract keywords from rule content if missing
- **Scene Inference**: Infer tech/functional scenes from keywords
- **Confidence Boosting**: Increase confidence for well-structured rules
- **Priority Adjustment**: Elevate priority based on pattern type

**Example Optimizations:**
- `["python", "sql", "injection"]` → infer scenes: `tech: ["python"], functional: ["database"]`
- Rule with 4+ keywords + 2+ scenes → confidence boost: +0.10
- Security patterns → priority upgrade to "critical"

## Usage

### Integrated Workflow

The cleanup runs automatically in `/autoimprove-summarize`:

```bash
/autoimprove-summarize
```

**Output Example:**
```
📊 Summary:
   ✓ 3 rules generated
   ✓ 1 rule merged with existing
   ✓ 2 new rules added

🧹 Running automatic cleanup...
   ✓ Cleaned up 5 rule(s)
   - 2 duplicate groups merged
   - 3 rules optimized
```

### Configuration

Default cleanup settings (in skill.ts):
```typescript
{
  mode: "execute",
  mergduplicates: true,          // Merge duplicate rules
  optimize_low_quality: true,      // Optimize medium-quality rules
  delete_very_low_quality: false,  // Safe default: don't auto-delete
  very_low_quality_threshold: 0.3, // Score threshold for deletion
}
```

### Manual Cleanup (MCP Tool)

The cleanup functionality is also available as an MCP tool:

```typescript
// Scan mode: preview what would be cleaned
await callMCPTool("cleanup_existing_rules", {
  mode: "scan",
});

// Execute mode: perform cleanup
await callMCPTool("cleanup_existing_rules", {
  mode: "execute",
  merge_duplicates: true,
  optimize_low_quality: true,
  delete_very_low_quality: false,
  very_low_quality_threshold: 0.3,
});
```

## Implementation Details

### Core Components

**RuleDeduplicator** (`src/mcp-server-ts/src/core/rule-deduplicator.ts`):
- `findSimilarRules()`: Compare new rule against existing rules
- `calculateSimilarity()`: Multi-dimensional similarity scoring
- `mergeRules()`: Combine two similar rules intelligently

**RuleCleanupService** (`src/mcp-server-ts/src/core/rule-cleanup-service.ts`):
- `scanExistingRules()`: Analyze entire rule database
- `assessRuleQuality()`: Score individual rule quality
- `optimizeRule()`: Improve rule metadata
- `executeCleanup()`: Perform merge/optimize/delete operations

**Integration Points**:
- `index.ts` - `handleGenerateRules()`: Deduplication during generation
- `skill.ts` - End of workflow: Automatic cleanup execution

### Storage Operations

All cleanup operations are atomic:
1. Load current rule index
2. Perform transformations in memory
3. Write updated index atomically
4. Update content files as needed
5. Log all changes to feedback history

### Safety Features

- **No Auto-Delete by Default**: `delete_very_low_quality: false` prevents accidental data loss
- **Merge Confirmation**: Only merge rules with similarity ≥ 0.80 (very high confidence)
- **Preserve History**: Merged rules retain oldest timestamp and merge metadata
- **Rollback Support**: All operations logged in feedback history
- **Error Resilience**: Cleanup failures don't break main workflow

## Testing

### Unit Tests

```bash
cd src/mcp-server-ts
npm test -- tests/rule-deduplication.test.ts  # 9 tests
npm test -- tests/rule-cleanup.test.ts        # 9 tests
```

**Test Coverage:**
- Similarity calculation (keywords, scenes, types)
- Rule merging (keywords union, confidence boost)
- Quality assessment (keyword count, scene presence, confidence)
- Rule optimization (keyword extraction, scene inference)
- Duplicate detection
- Cleanup execution

### Integration Testing

Run a full workflow test:

```bash
# 1. Analyze a session with patterns
/autoimprove-summarize

# 2. Verify deduplication in output
# Look for "merged with existing" messages

# 3. Verify cleanup execution
# Look for "Cleaned up N rule(s)" message

# 4. Check rule database
cat ~/.autoimprove/rules/index.json | jq '.rules | length'
```

## Monitoring

### Deduplication Stats

The summarize output shows deduplication results:
```
📊 Deduplication results:
   - rule-042: Merged into rule-010 (similarity: 0.85)
   - rule-043: Flagged as similar to rule-015 (similarity: 0.72)
   - rule-044: Added as new rule
```

### Cleanup Report

Cleanup execution provides detailed statistics:
```json
{
  "success": true,
  "result": {
    "merged_count": 2,
    "optimized_count": 3,
    "deleted_count": 0,
    "details": {
      "merges": ["Merged rule-005 into rule-003"],
      "optimizations": [
        "Optimized rule-008: added 2 keywords",
        "Optimized rule-012: inferred scenes"
      ]
    }
  }
}
```

## Troubleshooting

### Issue: Rules Not Being Merged

**Symptoms**: Similar rules exist but aren't being merged

**Diagnosis:**
```bash
# Check similarity scores manually
cd ~/.autoimprove
cat rules/index.json | jq '.rules[] | select(.id == "rule-XXX")'
```

**Solutions:**
- Ensure keywords overlap ≥ 50%
- Check that scenes have common elements
- Verify pattern types match
- Consider lowering MERGE_THRESHOLD (currently 0.80)

### Issue: Too Aggressive Merging

**Symptoms**: Unrelated rules being merged

**Solutions:**
- Increase MERGE_THRESHOLD in `rule-deduplicator.ts`
- Add more specific keywords to rules
- Use more granular scenes

### Issue: Low-Quality Rules Not Optimized

**Symptoms**: Rules with missing metadata persist

**Diagnosis:**
```bash
# Check quality scores
cd src/mcp-server-ts
npm test -- tests/rule-cleanup.test.ts -t "quality"
```

**Solutions:**
- Ensure `optimize_low_quality: true` in cleanup config
- Check that rule content exists for keyword extraction
- Verify scene inference keywords are in SCENE_KEYWORD_MAP

### Issue: Cleanup Failures

**Symptoms**: Cleanup step fails without completing

**Solutions:**
1. Check error logs in MCP server output
2. Verify rule index is not corrupted:
   ```bash
   cat ~/.autoimprove/rules/index.json | jq .
   ```
3. Backup and rebuild if needed:
   ```bash
   cp ~/.autoimprove/rules/index.json ~/.autoimprove/rules/index.json.bak
   # Re-run setup
   cd ~/workspace/autoimprove && ./setup.sh
   ```

## Configuration Options

### Deduplication Thresholds

Edit `src/mcp-server-ts/src/core/rule-deduplicator.ts`:

```typescript
private readonly MERGE_THRESHOLD = 0.80;    // Auto-merge threshold
private readonly SIMILAR_THRESHOLD = 0.65;  // Flag-for-review threshold
```

### Quality Thresholds

Edit `src/mcp-server-ts/src/core/rule-cleanup-service.ts`:

```typescript
private readonly MIN_KEYWORDS = 2;
private readonly MIN_DESCRIPTION_LENGTH = 30;
private readonly MIN_CONFIDENCE = 0.5;
```

### Cleanup Behavior

Edit `src/skills-ts/src/autoimprove-summarize/skill.ts`:

```typescript
const cleanupResult = await callMCPTool("cleanup_existing_rules", {
  mode: "execute",
  merge_duplicates: true,           // Enable/disable merging
  optimize_low_quality: true,       // Enable/disable optimization
  delete_very_low_quality: false,   // Enable/disable deletion (DANGEROUS)
  very_low_quality_threshold: 0.3,  // Deletion threshold
});
```

## Best Practices

1. **Let Automatic Cleanup Run**: Don't disable it unless necessary
2. **Review Merge Suggestions**: Check "flagged as similar" messages
3. **Keep Keywords Specific**: More specific keywords = better deduplication
4. **Use Granular Scenes**: Fine-grained scenes prevent over-merging
5. **Monitor Quality Scores**: Regularly check `~/.autoimprove/feedback_history.jsonl`
6. **Backup Before Manual Cleanup**: Always backup before experimenting with thresholds

## Future Enhancements

Potential improvements for future versions:

1. **LLM-Enhanced Similarity**: Use embeddings for semantic similarity
2. **User Confirmation for Merges**: Interactive merge approval
3. **Rule Split Detection**: Identify over-merged rules
4. **Quality Trend Tracking**: Monitor rule quality over time
5. **Automatic Re-optimization**: Periodic background cleanup
6. **Conflict Resolution**: Handle conflicting rules intelligently

## Related Documentation

- [RULE_DEDUPLICATION.md](./RULE_DEDUPLICATION.md) - Detailed deduplication algorithm
- [COMPLETE_SUMMARY.md](./COMPLETE_SUMMARY.md) - Full feature overview
- [MCP_TOOLS_API.md](./MCP_TOOLS_API.md) - MCP tool reference
- [HYBRID_RULE_GENERATION.md](./HYBRID_RULE_GENERATION.md) - Rule generation process
