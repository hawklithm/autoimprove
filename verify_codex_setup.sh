#!/bin/bash
# Quick verification script for Codex setup

set -e

echo "=========================================="
echo "Codex Setup Verification Script"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Counters
PASSED=0
FAILED=0

# Test function
test_item() {
    local name="$1"
    local command="$2"
    
    echo -n "Testing: $name ... "
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}"
        ((FAILED++))
    fi
}

# 1. Check shell
echo -e "${YELLOW}1. Environment Checks${NC}"
echo "------------------------"
test_item "Bash version >= 4" "[[ \"\$(bash --version | head -1 | grep -o '[0-9]\+\.[0-9]\+' | head -1)\" >= \"4.0\" ]]"
test_item "Node.js installed" "which node"
test_item "Node.js version >= 18" "[[ \"\$(node --version | sed 's/v//' | cut -d. -f1)\" -ge 18 ]]"
test_item "npm installed" "which npm"
test_item "npx available" "which npx"
echo ""

# 2. Check directories
echo -e "${YELLOW}2. Directory Structure${NC}"
echo "------------------------"
test_item "AutoImprove dir exists" "[ -d ~/.autoimprove ]"
test_item "Codex config dir exists" "[ -d ~/.codex ]"
test_item "Codex skills dir exists" "[ -d ~/.codex/skills ]"
test_item "MCP config exists" "[ -f ~/.codex/mcp.json ]"
test_item "Skills installed" "[ \$(ls ~/.codex/skills/ 2>/dev/null | wc -l) -gt 0 ]"
echo ""

# 3. Check MCP server
echo -e "${YELLOW}3. MCP Server (Node.js)${NC}"
echo "------------------------"
test_item "@modelcontextprotocol/sdk installed" "npm list -g @modelcontextprotocol/sdk 2>/dev/null"
test_item "MCP server file exists" "[ -f ~/.autoimprove/mcp-server.js ]"
test_item "MCP server executable" "[ -x ~/.autoimprove/mcp-server.js ]"
echo ""

# 4. Check skills content
echo -e "${YELLOW}4. Skills Content${NC}"
echo "------------------------"
test_item "analyze-project skill" "[ -f ~/.codex/skills/analyze-project.md ]"
test_item "index-cpg skill" "[ -f ~/.codex/skills/index-cpg.md ]"
test_item "find-knowledge skill" "[ -f ~/.codex/skills/find-knowledge.md ]"
test_item "autoimprove-analyze skill" "[ -f ~/.codex/skills/autoimprove-analyze.md ]"
test_item "autoimprove-index skill" "[ -f ~/.codex/skills/autoimprove-index.md ]"
test_item "autoimprove-search skill" "[ -f ~/.codex/skills/autoimprove-search.md ]"
test_item "autoimprove-rules skill" "[ -f ~/.codex/skills/autoimprove-rules.md ]"
test_item "autoimprove-lessons skill" "[ -f ~/.codex/skills/autoimprove-lessons.md ]"
echo ""

# 5. Check MCP configuration
echo -e "${YELLOW}5. MCP Configuration${NC}"
echo "------------------------"
test_item "mcp.json is valid JSON" "jq empty ~/.codex/mcp.json 2>/dev/null"
test_item "MCP server configured" "jq '.mcpServers[\"autoimprove\"]' ~/.codex/mcp.json > /dev/null 2>&1"
test_item "Correct port (18066)" "jq '.mcpServers[\"autoimprove\"].env.PORT' ~/.codex/mcp.json | grep -q '18066'"
echo ""

# Summary
echo "=========================================="
echo "Verification Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed! Codex setup is complete.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Restart OpenAI Codex CLI"
    echo "  2. Try /analyze-project to test skills"
    echo "  3. Check MCP server: ~/.autoimprove/restart-mcp-codex.sh"
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Please review the errors above.${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Run ./setup_codex.sh again"
    echo "  2. Check the installation log: ~/.autoimprove/logs/setup.log"
    echo "  3. Ensure all dependencies are installed"
    exit 1
fi
