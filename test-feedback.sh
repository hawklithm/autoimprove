#!/bin/bash
# Test script to verify feedback recording

echo "==================================="
echo "Testing AutoImprove Feedback Recording"
echo "==================================="
echo ""

# Check if feedback file exists
FEEDBACK_FILE="$HOME/.autoimprove/feedback_history.jsonl"

echo "1. Checking feedback file..."
if [ -f "$FEEDBACK_FILE" ]; then
    echo "✓ Feedback file exists: $FEEDBACK_FILE"
    echo "  Current entries:"
    wc -l "$FEEDBACK_FILE"
    echo ""
    echo "  Last 5 entries:"
    tail -5 "$FEEDBACK_FILE"
else
    echo "✗ Feedback file does not exist yet"
    echo "  Expected location: $FEEDBACK_FILE"
fi

echo ""
echo "2. Checking rules that should have been used..."
RULES_FILE="$HOME/.autoimprove/rules/index.json"
if [ -f "$RULES_FILE" ]; then
    echo "✓ Rules index exists"
    echo "  Total rules:"
    jq '.rules | length' "$RULES_FILE"
    echo ""
    echo "  Rule IDs:"
    jq -r '.rules[].id' "$RULES_FILE"
else
    echo "✗ Rules index not found"
fi

echo ""
echo "==================================="
echo "Test Instructions"
echo "==================================="
echo ""
echo "To test feedback recording manually:"
echo ""
echo "1. In this Claude Code session, you should see rules loaded above"
echo "2. I should record feedback when I apply RULE-010 (the security rule)"
echo "3. Let me do that now..."
echo ""
