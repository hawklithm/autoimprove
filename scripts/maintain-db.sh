#!/bin/bash
# Database Maintenance Script
# Runs PRAGMA optimize, ANALYZE, WAL checkpoint, and VACUUM

set -e

AUTOIMPROVE_DIR="${AUTOIMPROVE_DIR:-$HOME/.autoimprove}"
DB_PATH="$AUTOIMPROVE_DIR/rules.db"

echo "=========================================="
echo "AutoImprove Database Maintenance"
echo "=========================================="
echo ""

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
  echo "❌ Error: Database not found at $DB_PATH"
  echo "   Make sure AutoImprove is initialized and using SQLite backend"
  exit 1
fi

# Check if sqlite3 is installed
if ! command -v sqlite3 &> /dev/null; then
  echo "❌ Error: sqlite3 CLI not found"
  echo "   Install with: brew install sqlite3 (macOS) or apt-get install sqlite3 (Linux)"
  exit 1
fi

echo "Database: $DB_PATH"
echo ""

# Get current database stats
echo "Current Database Stats:"
echo "-----------------------------------"
DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
echo "  Size: $DB_SIZE"

RULE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM rules;" 2>/dev/null || echo "0")
echo "  Rules: $RULE_COUNT"

PAGE_COUNT=$(sqlite3 "$DB_PATH" "PRAGMA page_count;" 2>/dev/null || echo "unknown")
echo "  Pages: $PAGE_COUNT"

FREELIST_COUNT=$(sqlite3 "$DB_PATH" "PRAGMA freelist_count;" 2>/dev/null || echo "0")
echo "  Free pages: $FREELIST_COUNT"

echo ""

# Run maintenance operations
echo "Running Maintenance Operations:"
echo "-----------------------------------"

# 1. PRAGMA optimize
echo "[1/4] Running PRAGMA optimize..."
sqlite3 "$DB_PATH" "PRAGMA optimize;" && echo "✓ Optimize complete" || echo "⚠ Optimize failed"

# 2. ANALYZE
echo "[2/4] Running ANALYZE..."
sqlite3 "$DB_PATH" "ANALYZE;" && echo "✓ Analyze complete" || echo "⚠ Analyze failed"

# 3. WAL checkpoint
echo "[3/4] Running WAL checkpoint..."
CHECKPOINT_RESULT=$(sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || echo "0|0|0")
BUSY=$(echo "$CHECKPOINT_RESULT" | cut -d'|' -f1)
LOG=$(echo "$CHECKPOINT_RESULT" | cut -d'|' -f2)
CHECKPOINTED=$(echo "$CHECKPOINT_RESULT" | cut -d'|' -f3)

if [ "$BUSY" = "0" ]; then
  echo "✓ WAL checkpoint complete (log: $LOG, checkpointed: $CHECKPOINTED)"
else
  echo "⚠ WAL checkpoint partial (some pages busy)"
fi

# 4. VACUUM (optional, compresses database)
echo "[4/4] Running VACUUM..."
echo "  Note: This may take a while for large databases..."

# Check if we have enough disk space (need ~2x database size)
AVAILABLE_SPACE=$(df -k "$AUTOIMPROVE_DIR" | tail -1 | awk '{print $4}')
DB_SIZE_KB=$(du -k "$DB_PATH" | cut -f1)
REQUIRED_SPACE=$((DB_SIZE_KB * 2))

if [ "$AVAILABLE_SPACE" -lt "$REQUIRED_SPACE" ]; then
  echo "⚠ Warning: Insufficient disk space for VACUUM"
  echo "  Required: $(echo "scale=1; $REQUIRED_SPACE/1024" | bc)MB, Available: $(echo "scale=1; $AVAILABLE_SPACE/1024" | bc)MB"
  echo "  Skipping VACUUM"
else
  sqlite3 "$DB_PATH" "VACUUM;" && echo "✓ Vacuum complete" || echo "⚠ Vacuum failed"
fi

echo ""

# Get updated database stats
echo "Updated Database Stats:"
echo "-----------------------------------"
NEW_DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
echo "  Size: $NEW_DB_SIZE (was $DB_SIZE)"

NEW_PAGE_COUNT=$(sqlite3 "$DB_PATH" "PRAGMA page_count;" 2>/dev/null || echo "unknown")
echo "  Pages: $NEW_PAGE_COUNT (was $PAGE_COUNT)"

NEW_FREELIST_COUNT=$(sqlite3 "$DB_PATH" "PRAGMA freelist_count;" 2>/dev/null || echo "0")
echo "  Free pages: $NEW_FREELIST_COUNT (was $FREELIST_COUNT)"

echo ""

# Integrity check
echo "Running Integrity Check:"
echo "-----------------------------------"
INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>/dev/null || echo "error")

if [ "$INTEGRITY" = "ok" ]; then
  echo "✓ Database integrity: OK"
else
  echo "❌ Database integrity check failed:"
  echo "$INTEGRITY"
  exit 1
fi

echo ""
echo "=========================================="
echo "Maintenance Complete!"
echo "=========================================="
echo ""
echo "Recommendations:"
echo "  • Run this script monthly for optimal performance"
echo "  • If database is large (>100MB), consider running VACUUM quarterly"
echo "  • Monitor free pages - high count indicates fragmentation"
echo ""
