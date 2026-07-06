#!/bin/bash

# AutoImprove Unified Setup Script
# Executes setup for Claude Code and/or Codex based on parameters

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse arguments
MODE="${1:-all}"

show_usage() {
  echo "Usage: $0 [MODE]"
  echo ""
  echo "MODE options:"
  echo "  all     - Setup both Claude Code and Codex (default)"
  echo "  claude  - Setup Claude Code only"
  echo "  codex   - Setup Codex only"
  echo ""
  echo "Examples:"
  echo "  $0           # Setup both"
  echo "  $0 claude    # Setup Claude Code only"
  echo "  $0 codex     # Setup Codex only"
  exit 0
}

# Check for help flag
if [ "$MODE" = "-h" ] || [ "$MODE" = "--help" ]; then
  show_usage
fi

# Validate mode
if [ "$MODE" != "all" ] && [ "$MODE" != "claude" ] && [ "$MODE" != "codex" ]; then
  echo -e "${RED}Error: Invalid mode '$MODE'${NC}"
  echo ""
  show_usage
fi

echo "=========================================="
echo "  AutoImprove Unified Setup"
echo "=========================================="
echo ""
echo "Mode: $MODE"
echo ""

# Execute setup based on mode
case "$MODE" in
  all)
    echo -e "${BLUE}=== Setting up Claude Code ===${NC}"
    echo ""
    bash "$SCRIPT_DIR/setup_claude.sh"

    echo ""
    echo -e "${BLUE}=== Setting up Codex ===${NC}"
    echo ""
    bash "$SCRIPT_DIR/setup_codex.sh"

    echo ""
    echo "=========================================="
    echo -e "${GREEN}All setups completed successfully!${NC}"
    echo "=========================================="
    ;;

  claude)
    echo -e "${BLUE}=== Setting up Claude Code ===${NC}"
    echo ""
    bash "$SCRIPT_DIR/setup_claude.sh"

    echo ""
    echo "=========================================="
    echo -e "${GREEN}Claude Code setup completed!${NC}"
    echo "=========================================="
    ;;

  codex)
    echo -e "${BLUE}=== Setting up Codex ===${NC}"
    echo ""
    bash "$SCRIPT_DIR/setup_codex.sh"

    echo ""
    echo "=========================================="
    echo -e "${GREEN}Codex setup completed!${NC}"
    echo "=========================================="
    ;;
esac

echo ""
echo "Summary:"
case "$MODE" in
  all)
    echo "  ✓ Claude Code configured at: ~/.claude"
    echo "  ✓ Codex configured at: ~/.codex"
    ;;
  claude)
    echo "  ✓ Claude Code configured at: ~/.claude"
    ;;
  codex)
    echo "  ✓ Codex configured at: ~/.codex"
    ;;
esac
echo "  ✓ Storage directory: ~/.autoimprove"
echo ""
echo "Next steps:"
case "$MODE" in
  all)
    echo "  • Restart Claude Code and test: /autoimprove-status"
    echo "  • Restart Codex CLI and test: /autoimprove-search test"
    ;;
  claude)
    echo "  • Restart Claude Code and test: /autoimprove-status"
    ;;
  codex)
    echo "  • Restart Codex CLI and test: /autoimprove-search test"
    ;;
esac
echo ""
