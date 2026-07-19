#!/bin/bash
# Migration Status Check Script
# Checks if JSON→SQLite migration is needed and validates migration completeness

set -e

AUTOIMPROVE_DIR="${AUTOIMPROVE_DIR:-$HOME/.autoimprove}"
DB_PATH="$AUTOIMPROVE_DIR/rules/rules.db"
INDEX_PATH="$AUTOIMPROVE_DIR/rules/index.json"

echo "=========================================="
echo "AutoImprove Migration Status Check"
echo "=========================================="
echo ""

# Check storage backend
echo "Storage Backend Detection:"
echo "-----------------------------------"

DB_EXISTS=false
JSON_EXISTS=false

if [ -f "$DB_PATH" ]; then
  DB_EXISTS=true
  echo "✓ SQLite database found: $DB_PATH"
else
  echo "✗ SQLite database not found"
fi

if [ -f "$INDEX_PATH" ]; then
  JSON_EXISTS=true
  echo "✓ JSON index found: $INDEX_PATH"
else
  echo "✗ JSON index not found"
fi

echo ""

# Determine backend and migration status
if [ "$DB_EXISTS" = true ]; then
  echo "Current Backend: SQLite"
  echo "-----------------------------------"

  # Check if sqlite3 is available
  if command -v sqlite3 &> /dev/null; then
    RULE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM rules;" 2>/dev/null || echo "0")
    echo "  Rules in database: $RULE_COUNT"

    DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
    echo "  Database size: $DB_SIZE"

    # Check FTS5 index
    FTS_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM rules_fts;" 2>/dev/null || echo "0")
    echo "  FTS5 index entries: $FTS_COUNT"

    # Check scene index
    SCENE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM scene_index;" 2>/dev/null || echo "0")
    echo "  Scene index entries: $SCENE_COUNT"

    # Check keyword segments
    KEYWORD_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM keyword_segments;" 2>/dev/null || echo "0")
    echo "  Keyword segments: $KEYWORD_COUNT"

    echo ""

    # Validate consistency
    echo "Consistency Check:"
    echo "-----------------------------------"

    if [ "$RULE_COUNT" -eq "$FTS_COUNT" ]; then
      echo "✓ FTS5 index is in sync with rules table"
    else
      echo "⚠ Warning: FTS5 index mismatch (rules: $RULE_COUNT, fts: $FTS_COUNT)"
    fi

    # Check if JSON index also exists (migration remnant)
    if [ "$JSON_EXISTS" = true ]; then
      echo ""
      echo "⚠ JSON index still exists after migration"
      echo "  This is normal for backward compatibility"
      echo "  You can safely delete it if no longer needed:"
      echo "    rm $INDEX_PATH"
    fi

  else
    echo "⚠ sqlite3 CLI not found, cannot inspect database"
    echo "  Install with: brew install sqlite3 (macOS) or apt-get install sqlite3 (Linux)"
  fi

  echo ""
  echo "Migration Status: ✓ Complete (using SQLite)"

elif [ "$JSON_EXISTS" = true ]; then
  echo "Current Backend: JSON"
  echo "-----------------------------------"

  # Count rules in JSON index
  if command -v jq &> /dev/null; then
    RULE_COUNT=$(jq '.rules | length' "$INDEX_PATH" 2>/dev/null || echo "unknown")
    echo "  Rules in JSON index: $RULE_COUNT"
  else
    echo "  Rules in JSON index: (jq not installed, cannot count)"
  fi

  INDEX_SIZE=$(du -h "$INDEX_PATH" | cut -f1)
  echo "  Index file size: $INDEX_SIZE"

  echo ""
  echo "Migration Status: ⚠ Pending (JSON backend detected)"
  echo ""
  echo "Recommendation:"
  echo "  Migrate to SQLite for better performance and full-text search"
  echo ""
  echo "Migration Options:"
  echo "  1. Automatic: Run any MCP tool that triggers analysis"
  echo "     Example: npm run summarize"
  echo ""
  echo "  2. Manual: Call triggerMigration() via MCP"
  echo "     The RuleIndexManager will detect JSON backend and migrate"
  echo ""
  echo "  3. Force: Delete rules.db to trigger fresh SQLite initialization"
  echo "     (Only if you want to start fresh)"

else
  echo "Current Backend: None (not initialized)"
  echo "-----------------------------------"
  echo "  No storage backend found"
  echo ""
  echo "Migration Status: N/A (new installation)"
  echo ""
  echo "Next Steps:"
  echo "  1. Run setup script: ./setup_claude.sh or ./setup_codex.sh"
  echo "  2. Storage will be initialized automatically on first use"
  echo "  3. SQLite will be used by default for new installations"
fi

echo ""

# Health check if SQLite exists
if [ "$DB_EXISTS" = true ] && command -v sqlite3 &> /dev/null; then
  echo "Database Health Check:"
  echo "-----------------------------------"

  INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>/dev/null || echo "error")

  if [ "$INTEGRITY" = "ok" ]; then
    echo "✓ Database integrity: OK"
  else
    echo "❌ Database integrity check failed:"
    echo "$INTEGRITY"
    echo ""
    echo "Recommended Action:"
    echo "  1. Backup your database: cp $DB_PATH $DB_PATH.backup"
    echo "  2. Try repair: sqlite3 $DB_PATH 'VACUUM;'"
    echo "  3. If repair fails, restore from backup or re-analyze sessions"
  fi

  echo ""

  # Check for fragmentation
  PAGE_COUNT=$(sqlite3 "$DB_PATH" "PRAGMA page_count;" 2>/dev/null || echo "0")
  FREELIST_COUNT=$(sqlite3 "$DB_PATH" "PRAGMA freelist_count;" 2>/dev/null || echo "0")

  if [ "$PAGE_COUNT" -gt 0 ]; then
    FRAGMENTATION=$(echo "scale=2; $FREELIST_COUNT * 100 / $PAGE_COUNT" | bc 2>/dev/null || echo "0")
    echo "Fragmentation: ${FRAGMENTATION}% ($FREELIST_COUNT free pages out of $PAGE_COUNT)"

    if [ "$(echo "$FRAGMENTATION > 10" | bc 2>/dev/null)" = "1" ]; then
      echo "⚠ High fragmentation detected"
      echo "  Recommendation: Run scripts/maintain-db.sh to optimize"
    else
      echo "✓ Low fragmentation, database is healthy"
    fi
  fi
fi

echo ""
echo "=========================================="
echo "Check Complete!"
echo "=========================================="
echo ""
