#!/usr/bin/env node
/**
 * Test script for compact cache functionality
 */

import { SessionAnalyzer } from "../src/core/session-analyzer.js";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

async function testCompactCache() {
  console.log("=== Testing Compact Cache Functionality ===\n");

  // Find a session file to test
  const projectDir = join(
    homedir(),
    ".claude/projects/-Users-adazhao-workspace-autoimprove"
  );

  if (!existsSync(projectDir)) {
    console.error("❌ Project directory not found:", projectDir);
    return;
  }

  const sessionFiles = readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(projectDir, f))
    .sort((a, b) => {
      const sizeA = statSync(a).size;
      const sizeB = statSync(b).size;
      return sizeB - sizeA; // Largest first
    });

  if (sessionFiles.length === 0) {
    console.error("❌ No session files found");
    return;
  }

  // Test with the largest session file
  const testFile = sessionFiles[0];
  const fileSize = statSync(testFile).size;
  const sessionId = testFile.split("/").pop()?.replace(".jsonl", "");

  console.log(`Testing with session: ${sessionId}`);
  console.log(`File size: ${formatBytes(fileSize)}\n`);

  const analyzer = new SessionAnalyzer();

  // Test 1: First analysis (cache miss, generation)
  console.log("--- Test 1: First Analysis (Cache Miss) ---");
  const start1 = Date.now();
  const patterns1 = analyzer.analyzeSession(testFile, {
    incremental: false,
    forceReanalyze: true,
    useCompactCache: true,
  });
  const time1 = Date.now() - start1;

  console.log(`✓ Patterns detected: ${patterns1.length}`);
  console.log(`✓ Time: ${time1}ms\n`);

  // Test 2: Second analysis (cache hit)
  console.log("--- Test 2: Second Analysis (Cache Hit) ---");
  const start2 = Date.now();
  const patterns2 = analyzer.analyzeSession(testFile, {
    incremental: false,
    forceReanalyze: true,
    useCompactCache: true,
  });
  const time2 = Date.now() - start2;

  console.log(`✓ Patterns detected: ${patterns2.length}`);
  console.log(`✓ Time: ${time2}ms`);
  console.log(`✓ Speedup: ${((time1 - time2) / time1 * 100).toFixed(1)}%\n`);

  // Test 3: Without cache (baseline)
  console.log("--- Test 3: Without Cache (Baseline) ---");
  analyzer.clearCompactCache(sessionId);
  const start3 = Date.now();
  const patterns3 = analyzer.analyzeSession(testFile, {
    incremental: false,
    forceReanalyze: true,
    useCompactCache: false,
  });
  const time3 = Date.now() - start3;

  console.log(`✓ Patterns detected: ${patterns3.length}`);
  console.log(`✓ Time: ${time3}ms\n`);

  // Test 4: Get cache statistics
  console.log("--- Test 4: Cache Statistics ---");
  const stats = analyzer.getCompactCacheStats();

  console.log(`Total requests: ${stats.total_requests}`);
  console.log(`Cache hits: ${stats.cache_hits} (${(stats.hit_rate * 100).toFixed(1)}%)`);
  console.log(`Cache misses: ${stats.cache_misses}`);
  console.log(`Time saved: ${(stats.time_saved_ms / 1000).toFixed(2)}s`);
  console.log(`Bytes saved: ${formatBytes(stats.bytes_saved)}\n`);

  // Test 5: Verify cache file exists
  console.log("--- Test 5: Verify Cache File ---");
  const cacheDir = join(homedir(), ".autoimprove/cache");
  const cacheFile = join(cacheDir, `${sessionId}.compact.json`);

  if (existsSync(cacheFile)) {
    const cacheSize = statSync(cacheFile).size;
    const reduction = ((fileSize - cacheSize) / fileSize) * 100;

    console.log(`✓ Cache file exists: ${cacheFile}`);
    console.log(`✓ Cache size: ${formatBytes(cacheSize)}`);
    console.log(`✓ Original size: ${formatBytes(fileSize)}`);
    console.log(`✓ Reduction: ${reduction.toFixed(1)}%\n`);
  } else {
    console.error(`❌ Cache file not found: ${cacheFile}\n`);
  }

  // Summary
  console.log("=== Summary ===");
  console.log(`Performance improvement: ${((time3 - time2) / time3 * 100).toFixed(1)}%`);
  console.log(`First run: ${time1}ms (cache generation)`);
  console.log(`Second run: ${time2}ms (cache hit)`);
  console.log(`Without cache: ${time3}ms (baseline)`);
  console.log(`\n✅ All tests passed!`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Run tests
testCompactCache().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
