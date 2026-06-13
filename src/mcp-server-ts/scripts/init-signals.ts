#!/usr/bin/env node

/**
 * Signal Dictionary Initialization Script
 *
 * Initializes the signal dictionary database with seed data from templates.
 * Run this after setting up AutoImprove storage to populate the signal dictionary.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTOIMPROVE_DIR = path.join(process.env.HOME || '~', '.autoimprove');
const SIGNAL_DB_PATH = path.join(AUTOIMPROVE_DIR, 'signal-dictionary.db');
const SEED_FILE_PATH = path.join(__dirname, '../../../templates/seed-signal-dictionary.json');

interface SeedSignal {
  text: string;
  language: string;
  pattern_type: string;
  polarity: string;
  confidence: number;
  typical_context: string[];
  source: string;
}

interface SeedData {
  version: string;
  description: string;
  created_at: string;
  signals: SeedSignal[];
}

function createDatabase(): Database.Database {
  console.log('Creating signal dictionary database...');

  const db = new Database(SIGNAL_DB_PATH);

  // Create signals table
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      language TEXT NOT NULL,
      pattern_type TEXT NOT NULL,
      polarity TEXT NOT NULL,
      confidence REAL NOT NULL,
      typical_context TEXT,
      source TEXT NOT NULL DEFAULT 'seed',
      usage_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create indexes for fast lookup
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_signals_text ON signals(text);
    CREATE INDEX IF NOT EXISTS idx_signals_language ON signals(language);
    CREATE INDEX IF NOT EXISTS idx_signals_pattern_type ON signals(pattern_type);
    CREATE INDEX IF NOT EXISTS idx_signals_polarity ON signals(polarity);
  `);

  console.log('✓ Database schema created');

  return db;
}

function loadSeedData(): SeedData {
  console.log(`Loading seed data from: ${SEED_FILE_PATH}`);

  if (!fs.existsSync(SEED_FILE_PATH)) {
    throw new Error(`Seed file not found: ${SEED_FILE_PATH}`);
  }

  const content = fs.readFileSync(SEED_FILE_PATH, 'utf-8');
  const data = JSON.parse(content) as SeedData;

  console.log(`✓ Loaded ${data.signals.length} signals from seed file`);

  return data;
}

function insertSignals(db: Database.Database, signals: SeedSignal[]): number {
  console.log('Inserting signals into database...');

  const stmt = db.prepare(`
    INSERT INTO signals (text, language, pattern_type, polarity, confidence, typical_context, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insert = db.transaction((signals: SeedSignal[]) => {
    let count = 0;
    for (const signal of signals) {
      stmt.run(
        signal.text,
        signal.language,
        signal.pattern_type,
        signal.polarity,
        signal.confidence,
        JSON.stringify(signal.typical_context),
        signal.source
      );
      count++;
    }
    return count;
  });

  const count = insert(signals);

  console.log(`✓ Inserted ${count} signals`);

  return count;
}

function printStatistics(db: Database.Database): void {
  console.log('\n=================================');
  console.log('Signal Dictionary Statistics');
  console.log('=================================\n');

  // Total signals
  const total = db.prepare('SELECT COUNT(*) as count FROM signals').get() as { count: number };
  console.log(`Total signals: ${total.count}`);

  // By language
  console.log('\nBy language:');
  const byLanguage = db.prepare(`
    SELECT language, COUNT(*) as count
    FROM signals
    GROUP BY language
    ORDER BY count DESC
  `).all() as { language: string; count: number }[];

  for (const row of byLanguage) {
    console.log(`  ${row.language}: ${row.count}`);
  }

  // By pattern type
  console.log('\nBy pattern type:');
  const byPatternType = db.prepare(`
    SELECT pattern_type, COUNT(*) as count
    FROM signals
    GROUP BY pattern_type
    ORDER BY count DESC
  `).all() as { pattern_type: string; count: number }[];

  for (const row of byPatternType) {
    console.log(`  ${row.pattern_type}: ${row.count}`);
  }

  // By polarity
  console.log('\nBy polarity:');
  const byPolarity = db.prepare(`
    SELECT polarity, COUNT(*) as count
    FROM signals
    GROUP BY polarity
    ORDER BY count DESC
  `).all() as { polarity: string; count: number }[];

  for (const row of byPolarity) {
    console.log(`  ${row.polarity}: ${row.count}`);
  }

  // Average confidence
  const avgConfidence = db.prepare(`
    SELECT AVG(confidence) as avg_confidence
    FROM signals
  `).get() as { avg_confidence: number | null };

  if (avgConfidence.avg_confidence !== null) {
    console.log(`\nAverage confidence: ${avgConfidence.avg_confidence.toFixed(3)}`);
  }

  console.log('\n=================================\n');
}

function main(): void {
  console.log('Signal Dictionary Initialization\n');

  try {
    // Check if AutoImprove directory exists
    if (!fs.existsSync(AUTOIMPROVE_DIR)) {
      throw new Error(
        `AutoImprove directory not found: ${AUTOIMPROVE_DIR}\n` +
        'Please run setup.sh first to initialize AutoImprove storage.'
      );
    }

    // Check if database already exists
    const dbExists = fs.existsSync(SIGNAL_DB_PATH);

    if (dbExists) {
      console.log('⚠ Signal dictionary database already exists');
      console.log(`Location: ${SIGNAL_DB_PATH}`);

      // Ask if user wants to reinitialize (in script context, we skip)
      console.log('Skipping initialization (database already exists)');
      console.log('To reinitialize, delete the database file and run this script again.\n');

      // Print current statistics
      const db = new Database(SIGNAL_DB_PATH, { readonly: true });
      printStatistics(db);
      db.close();

      return;
    }

    // Create database and schema
    const db = createDatabase();

    // Load seed data
    const seedData = loadSeedData();

    // Insert signals
    const count = insertSignals(db, seedData.signals);

    // Print statistics
    printStatistics(db);

    // Close database
    db.close();

    console.log('✓ Signal dictionary initialized successfully');
    console.log(`Database location: ${SIGNAL_DB_PATH}\n`);

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main as initSignals };
