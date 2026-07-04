# Signal Dictionary Database Path Migration

## Problem

The signal dictionary database path was inconsistent between different parts of the codebase, causing data persistence failures when running in different environments.

## Root Cause

Two different paths were being used:

### Old Path (deprecated)
```
~/.autoimprove/signal-dictionary.db
```
Used by: `src/mcp-server-ts/scripts/init-signals.ts`

### New Path (standardized)
```
~/.autoimprove/signal_dictionary/signals.db
```
Used by: `src/mcp-server-ts/src/storage/signal-dictionary-db.ts`

## Differences

1. **Directory structure**:
   - Old: Database file in root directory
   - New: Database file in subdirectory `signal_dictionary/`

2. **File naming**:
   - Old: `signal-dictionary.db` (with hyphen)
   - New: `signals.db` (simplified)

## Solution

### 1. Unified to New Path

All code now uses the standardized path:
```typescript
const SIGNAL_DB_DIR = join(storageRoot, "signal_dictionary");
const SIGNAL_DB_PATH = join(SIGNAL_DB_DIR, "signals.db");
```

### 2. Added Migration Logic

The `init-signals.ts` script now includes automatic migration:

```typescript
// Ensure directory exists
if (!fs.existsSync(SIGNAL_DB_DIR)) {
  fs.mkdirSync(SIGNAL_DB_DIR, { recursive: true });
}

// Migrate old database if exists
if (fs.existsSync(OLD_SIGNAL_DB_PATH) && !fs.existsSync(SIGNAL_DB_PATH)) {
  console.log(`\n⚠️  Migrating database from old location:`);
  console.log(`   ${OLD_SIGNAL_DB_PATH}`);
  console.log(`   → ${SIGNAL_DB_PATH}\n`);
  fs.copyFileSync(OLD_SIGNAL_DB_PATH, SIGNAL_DB_PATH);
  console.log(`✅ Migration complete. Old file kept for backup.\n`);
}
```

### 3. Files Modified

- `src/mcp-server-ts/scripts/init-signals.ts` - Added migration logic and updated paths

### 4. Files Already Using Correct Path

- `src/mcp-server-ts/src/storage/signal-dictionary-db.ts` - Already correct
- `src/mcp-server-ts/src/index.ts` - Uses SignalDictionaryDB class (correct)

## Migration Process

The migration happens automatically when running `init-signals.ts`:

1. Check if old database exists at `~/.autoimprove/signal-dictionary.db`
2. Check if new database already exists at `~/.autoimprove/signal_dictionary/signals.db`
3. If old exists and new doesn't exist, copy old to new location
4. Keep old file as backup (manual cleanup recommended after verification)

## Verification

After migration, verify:

```bash
# Check new location exists
ls -la ~/.autoimprove/signal_dictionary/signals.db

# Check database is readable
sqlite3 ~/.autoimprove/signal_dictionary/signals.db "SELECT COUNT(*) FROM signals;"
```

## Cleanup (Optional)

After confirming the migration worked correctly, you can remove the old database:

```bash
rm ~/.autoimprove/signal-dictionary.db
```

## Environment Variable Support

Both paths support the `AUTOIMPROVE_STORAGE_ROOT` environment variable for custom storage locations:

```bash
export AUTOIMPROVE_STORAGE_ROOT=/custom/path
# Database will be at: /custom/path/signal_dictionary/signals.db
```

## Related Files

- `src/mcp-server-ts/src/storage/init.ts` - Storage root configuration
- `src/mcp-server-ts/src/storage/signal-dictionary-db.ts` - Main database class
- `src/mcp-server-ts/scripts/init-signals.ts` - Initialization script with migration
- `templates/seed-signal-dictionary.json` - Seed data

## Testing

To test the migration:

```bash
# 1. Build the project
cd src/mcp-server-ts
npm run build

# 2. Run the initialization script
node scripts/init-signals.ts

# 3. Verify migration message appears if old DB exists
# 4. Check that new database is created and populated
```

## Future Considerations

- All new storage paths should be defined in `src/mcp-server-ts/src/storage/init.ts`
- Use `STORAGE_ROOT` constant consistently
- Add migration logic for any future path changes
- Document path structure in `docs/STORAGE_SCHEMA.md`
