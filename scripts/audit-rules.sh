#!/bin/bash
# Phase 4 / P2 — Full rule-set audit wrapper.
#
# Runs the TypeScript audit CLI via tsx. Writes a report to
# ~/.autoimprove/audit_report.json and can batch-archive high-severity flagged
# rules. Defaults to a DRY-RUN (no storage mutation).
#
# Usage:
#   ./scripts/audit-rules.sh [--quality-threshold 0.5] [--no-report]
#                            [--batch-archive] [--apply] [--whitelist id,id2]
#
# Examples:
#   ./scripts/audit-rules.sh                          # audit + write report (dry-run)
#   ./scripts/audit-rules.sh --batch-archive          # show what would be archived
#   ./scripts/audit-rules.sh --batch-archive --apply --whitelist rule-002

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$REPO_ROOT/src/mcp-server-ts"

cd "$MCP_DIR"
exec ./node_modules/.bin/tsx scripts/audit-rules.ts "$@"
