#!/bin/bash
# Phase 4 / P1 — Orphaned rule cleanup wrapper.
#
# Runs the TypeScript cleanup CLI via tsx. Defaults to a DRY-RUN (no storage
# mutation). Pass --apply to actually archive/fix rules.
#
# Usage:
#   ./scripts/cleanup-orphaned-rules.sh [--action report|archive|fix] [--apply] [--whitelist id,id2]
#
# Examples:
#   ./scripts/cleanup-orphaned-rules.sh                         # dry-run audit
#   ./scripts/cleanup-orphaned-rules.sh --action archive        # show what would be archived
#   ./scripts/cleanup-orphaned-rules.sh --action archive --apply --whitelist rule-002,rule-003

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$REPO_ROOT/src/mcp-server-ts"

# Pass all arguments through to the TS script. Use the locally installed tsx
# binary directly (avoids `npx` network resolution which can hang).
cd "$MCP_DIR"
exec ./node_modules/.bin/tsx scripts/cleanup-orphaned-rules.ts "$@"
