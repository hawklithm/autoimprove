#!/bin/bash
# Test batch_rebuild parameter validation

echo "=== Testing batch_rebuild MCP tool parameter validation ==="
echo ""

# Test 1: Recommended parameters (5 core params)
echo "Test 1: Recommended parameters (5 core params)"
echo "Parameters: force, use_llm_enhancement, extract_code_examples, auto_cleanup, min_confidence"
echo "Expected: SUCCESS"
echo ""

# Test 2: All available parameters (8 params)
echo "Test 2: All available MCP parameters (8 params)"
echo "Parameters: force, use_llm_enhancement, extract_code_examples, auto_cleanup, min_confidence, session_limit, dry_run, session_dir"
echo "Expected: SUCCESS"
echo ""

# Test 3: Dry run preview
echo "Test 3: Dry run with minimal parameters"
echo "Parameters: dry_run, min_confidence"
echo "Expected: SUCCESS (preview only, no changes)"
echo ""

echo "=== Current MCP Schema (8 parameters) ==="
echo ""
echo "✅ Exposed parameters:"
echo "  1. force (boolean) - Force full rebuild (ignore cache)"
echo "  2. use_llm_enhancement (boolean) - Enable LLM enhancement"
echo "  3. extract_code_examples (boolean) - Extract code examples"
echo "  4. auto_cleanup (boolean) - Auto cleanup duplicates/optimize"
echo "  5. min_confidence (number) - Minimum confidence threshold (default: 0.6)"
echo "  6. session_limit (number) - Limit sessions for testing"
echo "  7. dry_run (boolean) - Preview without saving"
echo "  8. session_dir (string) - Custom session directory"
echo ""
echo "❌ NOT exposed (Engine-only parameters):"
echo "  - incremental (derived from force: incremental = !force)"
echo "  - mergeDuplicates (hardcoded: true)"
echo "  - optimizeLowQuality (hardcoded: true)"
echo "  - deleteVeryLowQuality (hardcoded: false)"
echo "  - veryLowQualityThreshold (hardcoded: 0.3)"
echo "  - useBatchLLM (Engine feature, not exposed)"
echo "  - batchLLMOptions (Engine feature, not exposed)"
echo "  - forceCleanup (Engine feature, not exposed)"
echo ""
echo "📝 Design rationale:"
echo "  - MCP schema kept simple with 8 user-facing parameters"
echo "  - Handler uses sensible defaults for cleanup internally"
echo "  - Advanced features require direct Engine calls (see run_batch_rebuild.ts)"
echo ""
echo "For advanced control (batch LLM, custom cleanup), use direct Engine calls:"
echo "  tsx run_batch_rebuild.ts"
