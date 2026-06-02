# AutoImprove Templates

This directory contains template files used by the setup script.

## Files

### `config.json`
Default configuration for AutoImprove storage (`~/.autoimprove/config.json`).

Contains:
- **confidence_thresholds**: Minimum confidence scores for different pattern types
- **confidence_weights**: Weights for confidence calculation components
- **rule_matching**: Parameters for rule matching and search
- **business_domain_mappings**: Project path to business domain mappings

### `rules-index.json`
Initial empty rules index (`~/.autoimprove/rules/index.json`).

This file stores metadata for all rules in the knowledge base.

## Skills

Skills are stored in `src/skills-ts/src/*/SKILL.md`:
- `autoimprove-status/SKILL.md` - System health check skill
- `autoimprove-summarize/SKILL.md` - Session analysis skill
- `autoimprove-rules/SKILL.md` - Rule management skill
- `autoimprove-lessons/SKILL.md` - Lessons viewer skill

Each `SKILL.md` contains:
- Frontmatter with skill metadata (name, description, allowed-tools)
- Instructions for Claude Code on how to use the skill
- Documentation on what the skill does

## Modifying Templates

To customize the AutoImprove installation:

1. **Edit configuration defaults**: Modify `config.json` to change thresholds, weights, or mappings
2. **Edit skill behavior**: Modify `src/skills-ts/src/*/SKILL.md` to change skill instructions
3. **Re-run setup**: Execute `./setup.sh` to apply changes

**Note**: Changing templates only affects new installations. To update existing installations:
- Configuration: Edit `~/.autoimprove/config.json` directly
- Skills: Re-run `./setup.sh` to reinstall skills

## Template Usage in setup.sh

The setup script uses these templates as follows:

```bash
# Storage initialization (Step 5)
cp "$TEMPLATES_DIR/config.json" "$AUTOIMPROVE_DIR/config.json"
cp "$TEMPLATES_DIR/rules-index.json" "$AUTOIMPROVE_DIR/rules/index.json"

# Skills installation (Step 4)
cp "$SKILLS_DIR_SRC/src/$skill/SKILL.md" "$CLAUDE_DIR/skills/$skill/"
```

This approach keeps the setup script clean and makes templates easy to maintain.
