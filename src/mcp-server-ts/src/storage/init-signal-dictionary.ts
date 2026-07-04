/**
 * Initialize signal dictionary with seed data
 */

import { SignalDictionaryDB, SignalEntry } from "../storage/signal-dictionary-db.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function initializeSignalDictionary() {
  const db = new SignalDictionaryDB();

  // Check if already initialized
  const stats = db.getDictionaryStats();
  if (stats.total_signals > 0) {
    // console.error(`Signal dictionary already initialized with ${stats.total_signals} signals`);
    db.close();
    return;
  }

  // Load seed data
  const seedPath = join(__dirname, "../../../templates/seed-signal-dictionary.json");
  const seedData = JSON.parse(readFileSync(seedPath, "utf-8"));

  // console.error("Initializing signal dictionary with seed data...");

  // Transform seed signals to DB format
  const now = new Date().toISOString();
  const signals: Omit<SignalEntry, "id">[] = seedData.signals.map((s: any) => ({
    text: s.text,
    language: s.language,
    pattern_type: s.pattern_type,
    polarity: s.polarity,
    confidence: s.confidence,
    typical_context: s.typical_context || [],
    related_signals: [],
    match_count: 0,
    true_positive: 0,
    false_positive: 0,
    first_seen: now,
    last_seen: now,
    source: s.source,
    created_at: now,
    updated_at: now
  }));

  // Batch insert
  db.batchInsertSignals(signals);

  const finalStats = db.getDictionaryStats();
  // console.error(`✓ Initialized signal dictionary with ${finalStats.total_signals} signals`);
  // console.error(`  By type:`, finalStats.by_type);
  // console.error(`  By source:`, finalStats.by_source);

  db.close();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeSignalDictionary();
}
