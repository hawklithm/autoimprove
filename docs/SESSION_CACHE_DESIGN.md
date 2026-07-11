# Session Cache System Design (v2.3)

## Overview

Enhanced session cache system supporting:
1. SHA256-based content hashing (detect changes accurately)
2. Pattern evolution tracking (confidence growth over time)
3. Incremental rebuild (only analyze changed sessions)
4. Pattern deduplication across sessions

## Directory Structure

```
~/.autoimprove/
├── cache/
│   ├── session-analysis.json          # Main cache index (existing)
│   ├── pattern-evolution.json         # NEW: Pattern evolution tracker
│   └── session-content-hashes.json    # NEW: SHA256 hashes for content verification
└── sessions/
    └── <session-id>.json              # Existing analyzed session metadata
```

## Data Schemas

### 1. Session Content Hash Index

**File**: `cache/session-content-hashes.json`

```json
{
  "version": "1.0",
  "hashes": {
    "b83b9792-faca-422a-83c8-a1793ec56028": {
      "content_hash": "sha256:a1b2c3d4...",
      "file_path": "/Users/.../.jsonl",
      "file_size": 123456,
      "last_verified_at": "2026-07-04T12:00:00Z"
    }
  }
}
```

**Purpose**: 
- Detect actual content changes (not just file size/mtime)
- Support file moves/renames (hash stays same)
- Invalidate cache when content changes

### 2. Pattern Evolution Tracker

**File**: `cache/pattern-evolution.json`

```json
{
  "version": "1.0",
  "patterns": {
    "pattern-fp-abc123": {
      "fingerprint": "repeated-correction:useMemo依赖数组不完整",
      "type": "repeated-correction",
      "description": "useMemo 依赖数组不完整导致闭包陷阱",
      "first_seen": "2026-06-01T10:00:00Z",
      "last_seen": "2026-07-04T12:00:00Z",
      "sessions": [
        "session-001",
        "session-015",
        "session-027"
      ],
      "occurrences": 5,
      "confidence_history": [
        {"date": "2026-06-01", "confidence": 0.45, "sessions": 1},
        {"date": "2026-06-15", "confidence": 0.58, "sessions": 2},
        {"date": "2026-07-04", "confidence": 0.72, "sessions": 3}
      ],
      "feedback_count": {
        "used": 3,
        "validated": 1,
        "ignored": 0,
        "corrected": 0
      },
      "current_rule_id": "rule-005"
    }
  }
}
```

**Purpose**:
- Track pattern confidence growth over time
- Identify high-value patterns (frequent + validated)
- Support confidence recalculation on incremental rebuild

### 3. Enhanced Session Cache Entry

**Extends existing** `cache/session-analysis.json`:

```json
{
  "version": "1.0",
  "sessions": {
    "b83b9792-faca-422a-83c8-a1793ec56028": {
      "session_id": "b83b9792-faca-422a-83c8-a1793ec56028",
      "session_file": "/Users/.../.jsonl",
      "content_hash": "sha256:a1b2c3d4...",       // NEW
      "last_analyzed_at": "2026-07-04T12:00:00Z",
      "last_line_analyzed": 1234,
      "file_size_at_analysis": 123456,
      "patterns_found": 8,
      "cached_patterns": [...],                    // Full pattern objects
      "pattern_fingerprints": [                    // NEW: Link to evolution
        "pattern-fp-abc123",
        "pattern-fp-def456"
      ]
    }
  }
}
```

## Algorithms

### Pattern Fingerprint Generation

```typescript
function generatePatternFingerprint(pattern: Pattern): string {
  // Normalize description (case-insensitive, trim whitespace)
  const normalized = pattern.description.toLowerCase().trim();
  
  // Create unique key: type + normalized description
  const key = `${pattern.type}:${normalized}`;
  
  // Hash for shorter storage (optional, using first 8 chars of SHA256)
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 8);
  
  return `pattern-fp-${hash}`;
}
```

### Incremental Rebuild Algorithm

```typescript
async function incrementalRebuild(options: {
  force?: boolean,
  minConfidence?: number
}): Promise<RebuildResult> {
  // Step 1: Discover all session files
  const allSessions = await discoverSessionFiles();
  
  // Step 2: Check which need analysis
  const sessionsToAnalyze = [];
  const cachedSessions = [];
  
  for (const sessionFile of allSessions) {
    const currentHash = await computeFileHash(sessionFile);
    const cached = sessionCache.get(sessionId);
    
    if (!cached || cached.content_hash !== currentHash || options.force) {
      sessionsToAnalyze.push(sessionFile);
    } else {
      // Use cached patterns
      cachedSessions.push(cached);
    }
  }
  
  console.log(`Cache hit: ${cachedSessions.length}, Cache miss: ${sessionsToAnalyze.length}`);
  
  // Step 3: Analyze new/changed sessions
  const newPatterns = [];
  for (const sessionFile of sessionsToAnalyze) {
    const patterns = await analyzeSession(sessionFile);
    newPatterns.push(...patterns);
    
    // Update cache
    const hash = await computeFileHash(sessionFile);
    sessionCache.save(sessionId, sessionFile, hash, patterns);
  }
  
  // Step 4: Merge cached + new patterns
  const allPatterns = [
    ...extractPatternsFromCache(cachedSessions),
    ...newPatterns
  ];
  
  // Step 5: Update pattern evolution
  for (const pattern of allPatterns) {
    const fingerprint = generatePatternFingerprint(pattern);
    patternEvolution.recordOccurrence(fingerprint, pattern);
  }
  
  // Step 6: Recalculate confidence with evolution data
  for (const pattern of allPatterns) {
    const fingerprint = generatePatternFingerprint(pattern);
    const evolution = patternEvolution.get(fingerprint);
    
    pattern.confidence = calculateEnhancedConfidence(pattern, evolution);
  }
  
  // Step 7: Generate rules (only patterns above threshold)
  const qualifyingPatterns = allPatterns.filter(p => 
    p.confidence >= options.minConfidence
  );
  
  const rules = await generateRules(qualifyingPatterns);
  
  // Step 8: Export to Claude index
  await exportRulesToClaudeIndex(rules);
  
  return {
    sessions_analyzed: sessionsToAnalyze.length,
    sessions_cached: cachedSessions.length,
    patterns_total: allPatterns.length,
    patterns_qualified: qualifyingPatterns.length,
    rules_generated: rules.length
  };
}
```

### Enhanced Confidence Calculation

```typescript
function calculateEnhancedConfidence(
  pattern: Pattern,
  evolution: PatternEvolution | null
): number {
  // Base confidence from current pattern
  let baseScore = confidenceCalculator.calculateConfidence(pattern);
  
  if (!evolution) return baseScore;
  
  // Bonus for multi-session appearance
  const sessionBonus = Math.min(evolution.sessions.length * 0.05, 0.20);
  
  // Bonus for time span (days between first and last seen)
  const daySpan = daysBetween(evolution.first_seen, evolution.last_seen);
  const timeBonus = Math.min(daySpan / 30 * 0.10, 0.10);
  
  // Bonus for positive feedback
  const feedbackRatio = 
    (evolution.feedback_count.used + evolution.feedback_count.validated) /
    (evolution.occurrences || 1);
  const feedbackBonus = feedbackRatio * 0.15;
  
  // Penalty for negative feedback
  const negativeRatio = 
    (evolution.feedback_count.ignored + evolution.feedback_count.corrected) /
    (evolution.occurrences || 1);
  const feedbackPenalty = negativeRatio * 0.20;
  
  const enhancedScore = Math.min(
    baseScore + sessionBonus + timeBonus + feedbackBonus - feedbackPenalty,
    1.0
  );
  
  return Math.max(enhancedScore, 0.0);
}
```

## Cache Invalidation Strategy

### When to Invalidate

1. **Content change detected** (hash mismatch) → Invalidate session cache
2. **User runs `--force`** → Invalidate all session caches
3. **Pattern evolution > 90 days old** → Prune evolution data
4. **Session file deleted** → Remove from cache

### Cache Pruning

```typescript
// Run periodically (e.g., on startup)
cacheManager.pruneOld(90);  // Remove sessions not seen in 90 days
evolutionManager.pruneStalePatterns(180);  // Remove patterns not seen in 6 months
```

## Performance Targets

| Metric | Cold Start (no cache) | Warm Start (50% cache hit) | Hot Start (100% cache hit) |
|--------|----------------------|---------------------------|---------------------------|
| **77 sessions** | ~120s | ~60s | ~5s |
| **Token cost** | ~5k | ~2.5k | ~500 |
| **Confidence accuracy** | Baseline | +10% | +20% |

## Migration Path

### Phase 1: Add Hash Verification (Week 1)
- Implement `SessionContentHashManager`
- Compute hashes for existing cache entries
- Fallback to file size if hash unavailable

### Phase 2: Pattern Evolution Tracking (Week 2)
- Implement `PatternEvolutionManager`
- Migrate existing patterns to evolution format
- Integrate feedback system

### Phase 3: Enhanced Confidence (Week 3)
- Update confidence calculation with evolution data
- Add confidence history to UI
- Document confidence boost factors

### Phase 4: Incremental Rebuild (Week 4)
- Implement `batch_rebuild` MCP tool
- Add `--incremental` flag to skill
- Benchmark performance improvements

## API Changes

### New MCP Tools

#### `batch_rebuild`

```typescript
{
  name: 'batch_rebuild',
  inputSchema: {
    force: boolean,                    // Clear cache before rebuild
    use_llm_enhancement: boolean,      // Enable LLM enhancement for rules
    extract_code_examples: boolean,    // Extract code examples from sessions
    auto_cleanup: boolean,             // Automatically cleanup duplicates and optimize rules
    min_confidence: number,            // Minimum confidence threshold (default: 0.6)
    session_limit: number,             // Max sessions to process (for testing)
    dry_run: boolean,                  // Preview without writing
    session_dir: string,               // Custom session directory path
  },
  outputSchema: {
    sessions_analyzed: number,
    sessions_cached: number,
    patterns_total: number,
    patterns_qualified: number,
    rules_generated: number,
    rules_exported: number,
    cache_hit_rate: number,            // Percentage
    execution_time_ms: number,
    cleanup_performed: boolean,        // Whether cleanup was performed
    rules_merged: number,              // Number of rules merged
    rules_optimized: number,           // Number of rules optimized
    rules_deleted: number,             // Number of rules deleted
  }
}
```

**Note**: The `incremental` parameter is not exposed in the MCP schema. It is automatically derived from `force` (incremental mode is enabled when `force: false`).

#### `get_pattern_evolution`

```typescript
{
  name: 'get_pattern_evolution',
  inputSchema: {
    pattern_fingerprint?: string,  // Specific pattern
    rule_id?: string,              // Get evolution for rule's pattern
    min_occurrences?: number,      // Filter by occurrence count
  },
  outputSchema: {
    patterns: PatternEvolution[]
  }
}
```

#### `clear_cache`

```typescript
{
  name: 'clear_cache',
  inputSchema: {
    cache_type: 'sessions' | 'patterns' | 'all',
    older_than_days?: number,
    dry_run?: boolean
  },
  outputSchema: {
    sessions_cleared: number,
    patterns_cleared: number,
    disk_space_freed_mb: number
  }
}
```

## Testing Strategy

### Unit Tests

1. **Hash calculation** - Verify SHA256 matches across runs
2. **Pattern fingerprint** - Same pattern → same fingerprint
3. **Cache invalidation** - Content change → cache miss
4. **Evolution tracking** - Occurrences accumulate correctly
5. **Enhanced confidence** - Bonus calculations accurate

### Integration Tests

1. **Cold rebuild** - No cache → analyze all sessions
2. **Warm rebuild** - 50% cache hit → analyze only new
3. **Hot rebuild** - 100% cache hit → instant result
4. **Feedback integration** - User feedback → confidence boost

### Performance Tests

1. **Benchmark 77 sessions** - Measure cold/warm/hot times
2. **Token counting** - Verify token savings
3. **Memory usage** - Ensure cache doesn't bloat
4. **Concurrent access** - Multiple rebuilds don't corrupt cache

## Rollback Plan

If cache system causes issues:

1. **Disable incrementally**: Add `--no-cache` flag
2. **Fallback to v2.2**: Use file size comparison only
3. **Clear corrupted cache**: `clear_cache --cache_type all`
4. **Restore from backup**: Rules backup created before each rebuild

## Future Enhancements

1. **Distributed cache** - Share cache across team (Redis/S3)
2. **Pattern similarity clustering** - Group related patterns
3. **Auto-tune confidence thresholds** - ML-based optimization
4. **Pattern A/B testing** - Measure rule effectiveness
5. **Visual confidence timeline** - Show growth in UI
