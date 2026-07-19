#!/usr/bin/env node
import('../lib/cli/index.js').catch(err => {
  console.error('Failed to load autoimprove:', err);
  process.exit(1);
});
