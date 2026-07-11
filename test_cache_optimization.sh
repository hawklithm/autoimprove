#!/bin/bash
# Test cache optimization by running batch rebuild and checking cache stats

set -e

echo "=== Cache Optimization Test ==="
echo "Date: $(date)"
echo ""

# Ensure we have API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "❌ ANTHROPIC_API_KEY not set"
  exit 1
fi

echo "✓ ANTHROPIC_API_KEY is set"
echo ""

# Build if needed
echo "Building MCP server..."
cd src/mcp-server-ts
npm run build > /dev/null 2>&1
echo "✓ Build complete"
echo ""

# Clear old logs
LOG_FILE="$HOME/.autoimprove/llm-calls.log"
if [ -f "$LOG_FILE" ]; then
  echo "Clearing old logs..."
  echo "" > "$LOG_FILE"
fi

echo "=== Running batch rebuild with 3 sessions ==="
echo "This will test cache performance across multiple LLM calls"
echo ""

# Run batch rebuild with limited sessions
cd ../..
node src/mcp-server-ts/dist/core/batch-rebuild.js \
  --session-limit 3 \
  --use-llm-enhancement \
  --extract-code-examples 2>&1 | tee /tmp/cache_test_output.txt

echo ""
echo "=== Analyzing Cache Performance ==="
echo ""

# Extract cache stats from logs
if [ -f "$LOG_FILE" ]; then
  echo "Cache statistics from LLM calls:"
  echo ""

  # Count total calls
  TOTAL_CALLS=$(grep -c "Cache stats:" "$LOG_FILE" || echo "0")
  echo "Total LLM calls: $TOTAL_CALLS"

  # Extract and summarize cache stats
  grep "Cache stats:" "$LOG_FILE" | while read -r line; do
    echo "$line"
  done

  echo ""
  echo "Detailed analysis:"

  # Sum up tokens
  CACHE_CREATED=$(grep "cache_creation_tokens" "$LOG_FILE" | grep -o '"cache_creation_tokens":[0-9]*' | cut -d: -f2 | awk '{s+=$1} END {print s}')
  CACHE_READ=$(grep "cache_read_tokens" "$LOG_FILE" | grep -o '"cache_read_tokens":[0-9]*' | cut -d: -f2 | awk '{s+=$1} END {print s}')
  INPUT_TOKENS=$(grep "input_tokens" "$LOG_FILE" | grep -o '"input_tokens":[0-9]*' | cut -d: -f2 | awk '{s+=$1} END {print s}')

  echo "- Total input tokens: ${INPUT_TOKENS:-0}"
  echo "- Cache creation tokens: ${CACHE_CREATED:-0}"
  echo "- Cache read tokens: ${CACHE_READ:-0}"

  if [ -n "$CACHE_READ" ] && [ "$CACHE_READ" -gt 0 ]; then
    TOTAL_CACHEABLE=$((${CACHE_CREATED:-0} + ${CACHE_READ:-0}))
    if [ "$TOTAL_CACHEABLE" -gt 0 ]; then
      HIT_RATE=$(awk "BEGIN {printf \"%.1f\", (${CACHE_READ} / ${TOTAL_CACHEABLE}) * 100}")
      echo "- Overall cache hit rate: ${HIT_RATE}%"

      if (( $(echo "$HIT_RATE > 50" | bc -l) )); then
        echo ""
        echo "✅ Cache optimization is working! Hit rate > 50%"
      else
        echo ""
        echo "⚠️  Cache hit rate is lower than expected. This might be the first run."
      fi
    fi
  else
    echo ""
    echo "ℹ️  No cache hits detected. This is expected on the first run."
    echo "   Run the test again within 5 minutes to see cache benefits."
  fi
else
  echo "❌ Log file not found: $LOG_FILE"
fi

echo ""
echo "=== Test complete ==="
echo ""
echo "To see full cache benefits:"
echo "1. Run this script again within 5 minutes (cache TTL)"
echo "2. Or run: ./test_cache_optimization.sh"
echo ""
echo "Log file location: $LOG_FILE"
