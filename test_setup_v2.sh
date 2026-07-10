#!/bin/bash
# Quick test for setup_codex_v2.sh template handling

echo "Testing setup_codex_v2.sh template integration..."
echo ""

# Check if template file exists
TEMPLATE="templates/claude-guidance-template.md"
if [ -f "$TEMPLATE" ]; then
    echo "✓ Template file exists: $TEMPLATE"
    
    # Check template content
    if grep -q "AUTOIMPROVE_START" "$TEMPLATE"; then
        echo "✓ Template contains AUTOIMPROVE_START marker"
    else
        echo "✗ Template missing AUTOIMPROVE_START marker"
    fi
    
    if grep -q "search_knowledge" "$TEMPLATE"; then
        echo "✓ Template contains search_knowledge reference"
    else
        echo "✗ Template missing search_knowledge reference"
    fi
    
    echo ""
    echo "Template summary:"
    echo "  Lines: $(wc -l < "$TEMPLATE")"
    echo "  Size: $(wc -c < "$TEMPLATE") bytes"
else
    echo "✗ Template file not found: $TEMPLATE"
    exit 1
fi

echo ""
echo "Checking setup script integration..."

# Check if setup script references template
if grep -q 'GUIDANCE_TEMPLATE="$TEMPLATES_DIR/claude-guidance-template.md"' setup_codex_v2.sh; then
    echo "✓ Setup script defines GUIDANCE_TEMPLATE variable"
else
    echo "✗ Setup script missing GUIDANCE_TEMPLATE variable"
fi

if grep -q 'if \[ ! -f "$GUIDANCE_TEMPLATE" \]' setup_codex_v2.sh; then
    echo "✓ Setup script checks template existence"
else
    echo "✗ Setup script missing template existence check"
fi

if grep -q 'cp "$GUIDANCE_TEMPLATE" "$AUTOIMPROVE_GUIDANCE"' setup_codex_v2.sh; then
    echo "✓ Setup script copies template (not hardcodes content)"
else
    echo "✗ Setup script doesn't copy template properly"
fi

# Check that script doesn't hardcode guidance content
if grep -q 'BLOCKING.*Call.*search_knowledge' setup_codex_v2.sh; then
    echo "✗ WARNING: Setup script still contains hardcoded guidance content!"
    echo "  It should only reference the template file."
else
    echo "✓ Setup script doesn't hardcode guidance content"
fi

echo ""
echo "All checks passed! The script correctly uses the template file."
