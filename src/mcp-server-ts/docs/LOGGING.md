# AutoImprove Logging System

## Overview

AutoImprove MCP Server uses a structured file-based logging system instead of console output. All logs are written to `~/.autoimprove/logs/` as JSON Lines (JSONL) files.

## Log Location

```bash
~/.autoimprove/logs/autoimprove-YYYY-MM-DD.jsonl
```

Each day gets a new log file. Logs are automatically rotated by date.

## Log Levels

- **DEBUG**: Detailed diagnostic information
- **INFO**: General informational messages
- **WARN**: Warning messages (potential issues)
- **ERROR**: Error messages (failures)

## Viewing Logs

### Tail live logs
```bash
tail -f ~/.autoimprove/logs/autoimprove-$(date +%Y-%m-%d).jsonl
```

### Pretty-print with jq
```bash
tail -f ~/.autoimprove/logs/autoimprove-*.jsonl | jq -r '"\(.timestamp) [\(.level)] \(.category): \(.message)"'
```

### Filter by level
```bash
grep '"level":"ERROR"' ~/.autoimprove/logs/autoimprove-*.jsonl | jq .
```

### Filter by category
```bash
grep '"category":"rule-generation"' ~/.autoimprove/logs/autoimprove-*.jsonl | jq .
```

## Log Categories

Common categories used throughout the codebase:

- `console`: General debug output (replaced console.error/log)
- `pattern-detection`: Pattern detection from sessions
- `rule-generation`: Rule generation from patterns
- `rule-matching`: Rule matching for search
- `rule-quality`: Rule quality assessment
- `conflict-detection`: Rule conflict detection
- `cache`: Cache operations
- `performance`: Performance metrics
- `session-analysis`: Session analysis tracking
- `feedback`: User feedback recording
- `llm`: LLM API calls and responses

## Log Format

Each log entry is a JSON object with the following structure:

```json
{
  "timestamp": "2026-07-04T10:09:21.076Z",
  "level": "INFO",
  "category": "rule-generation",
  "message": "Generated 5 rules from 12 patterns",
  "metadata": {
    "generated": 5,
    "skipped": 7,
    "avg_confidence": 0.75
  }
}
```

### Error entries include stack traces:

```json
{
  "timestamp": "2026-07-04T10:09:21.076Z",
  "level": "ERROR",
  "category": "rule-generation",
  "message": "Failed to generate rule",
  "metadata": {
    "rule_id": "rule-001"
  },
  "error": {
    "name": "TypeError",
    "message": "Cannot read property 'description' of undefined",
    "stack": "TypeError: Cannot read property...\n    at ..."
  }
}
```

## Usage in Code

### Using the logger directly

```typescript
import { logger } from "./core/logger.js";

// Structured logging
logger.info("rule-generation", "Generated rules", {
  count: 5,
  avg_confidence: 0.8
});

logger.error("rule-generation", "Failed to generate rule", error, {
  rule_id: "rule-001"
});

logger.warn("performance", "Slow operation", {
  duration_ms: 5000,
  operation: "analyze_session"
});

logger.debug("cache", "Cache hit", {
  session_id: "abc123"
});
```

### Console replacement methods

For backward compatibility and quick debugging:

```typescript
// These now write to log files instead of console
logger.consoleError("Error message", additionalData);
logger.consoleLog("Info message", additionalData);
logger.consoleWarn("Warning message", additionalData);
logger.consoleDebug("Debug message", additionalData);
```

## Log Retention

- Logs are kept indefinitely
- Manual cleanup: `rm ~/.autoimprove/logs/autoimprove-2026-06-*.jsonl`
- Automated cleanup: Add a cron job if needed

## Performance

- **Buffered writes**: Logs are buffered and flushed every 5 seconds
- **Immediate flush**: ERROR level logs flush immediately
- **Minimal overhead**: Async I/O, no blocking operations

## Troubleshooting

### No logs appearing

1. Check log directory exists: `ls -la ~/.autoimprove/logs/`
2. Check file permissions: `ls -l ~/.autoimprove/logs/`
3. Verify logger is imported: Check imports in your file
4. Test logger directly:
   ```typescript
   logger.consoleError("Test message");
   logger.flush();
   ```

### Log file too large

Filter and archive:
```bash
cd ~/.autoimprove/logs
gzip autoimprove-2026-06-*.jsonl
```

### Debugging specific issues

Enable DEBUG level and filter by category:
```typescript
// In your code
logger.setMinLevel(LogLevel.DEBUG);
```

Then grep for specific categories:
```bash
grep '"category":"your-category"' ~/.autoimprove/logs/*.jsonl | jq .
```

## Migration from console.*

All `console.error()`, `console.log()`, `console.warn()` calls have been replaced with:
- `logger.consoleError()` - ERROR level
- `logger.consoleLog()` - INFO level  
- `logger.consoleWarn()` - WARN level
- `logger.consoleDebug()` - DEBUG level

This change improves:
- **Debuggability**: Persistent logs for issue investigation
- **Structure**: JSON format enables easy parsing and filtering
- **Performance**: Buffered writes reduce I/O overhead
- **MCP compliance**: MCP servers should not write to stdout/stderr

## Examples

### Debugging batch rebuild issues

```bash
# Watch rebuild progress
tail -f ~/.autoimprove/logs/autoimprove-*.jsonl | jq -r 'select(.message | contains("Batch Rebuild"))'

# Check for errors
grep '"level":"ERROR"' ~/.autoimprove/logs/autoimprove-*.jsonl | jq .

# Analyze performance
jq 'select(.category == "performance")' ~/.autoimprove/logs/autoimprove-*.jsonl
```

### Debugging LLM calls

```bash
# View all LLM-related logs
grep '"category":"llm"' ~/.autoimprove/logs/autoimprove-*.jsonl | jq .

# Or check dedicated LLM log
tail -f ~/.autoimprove/llm-calls.log
```

### Analyzing rule quality

```bash
# Find low-quality rules
jq 'select(.category == "rule-quality" and .metadata.quality_score < 0.5)' \
  ~/.autoimprove/logs/autoimprove-*.jsonl
```

## Advanced: Custom Log Queries

### Count errors by category
```bash
jq -r 'select(.level == "ERROR") | .category' ~/.autoimprove/logs/*.jsonl | sort | uniq -c
```

### Average performance by operation
```bash
jq 'select(.category == "performance") | .metadata.duration_ms' ~/.autoimprove/logs/*.jsonl | \
  awk '{sum+=$1; count++} END {print sum/count}'
```

### Timeline of pattern detection
```bash
jq -r 'select(.category == "pattern-detection") | "\(.timestamp) \(.metadata.high_confidence_count) high-confidence patterns"' \
  ~/.autoimprove/logs/*.jsonl
```
