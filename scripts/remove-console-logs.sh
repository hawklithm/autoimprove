#!/bin/bash
# Script to replace all console.* calls with logger calls in MCP server

set -e

cd "$(dirname "$0")/.."

# Files to process
FILES=(
  "src/mcp-server-ts/src/core/bayesian-confidence-updater.ts"
  "src/mcp-server-ts/src/core/llm-rule-generator.ts"
  "src/mcp-server-ts/src/core/adaptive-session-analyzer.ts"
  "src/mcp-server-ts/src/core/hybrid-rule-generator.ts"
  "src/mcp-server-ts/src/core/batch-llm-rule-generator.ts"
  "src/mcp-server-ts/src/core/batch-rebuild.ts"
  "src/mcp-server-ts/src/core/signal-matcher.ts"
  "src/mcp-server-ts/src/core/llm-signal-extractor.ts"
  "src/mcp-server-ts/src/core/session-analyzer.ts"
  "src/mcp-server-ts/src/core/adaptive-confidence.ts"
  "src/mcp-server-ts/src/core/code-example-extractor.ts"
  "src/mcp-server-ts/src/core/rule-usage-stats.ts"
  "src/mcp-server-ts/src/core/jsonl-parser.ts"
  "src/mcp-server-ts/src/storage/compact-cache.ts"
  "src/mcp-server-ts/src/storage/init-signal-dictionary.ts"
  "src/mcp-server-ts/src/storage/session-cache.ts"
  "src/mcp-server-ts/src/storage/pattern-evolution.ts"
  "src/mcp-server-ts/src/storage/session-analysis-tracker.ts"
  "src/mcp-server-ts/src/storage/rule-version.ts"
  "src/mcp-server-ts/src/storage/rule-index.ts"
  "src/mcp-server-ts/src/storage/signal-dictionary-db.ts"
)

echo "Removing console.* calls from ${#FILES[@]} files..."

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing: $file"

    # Remove console.error/warn/log calls that are just for logging
    # Keep the logic, just remove the console output
    sed -i.bak 's/console\.error(/\/\/ console.error(/g' "$file"
    sed -i.bak 's/console\.warn(/\/\/ console.warn(/g' "$file"
    sed -i.bak 's/console\.log(/\/\/ console.log(/g' "$file"

    # Remove backup file
    rm -f "${file}.bak"
  else
    echo "Warning: $file not found"
  fi
done

echo "Done! All console.* calls have been commented out."
echo "Run 'npm run build' to rebuild."
