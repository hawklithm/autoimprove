#!/usr/bin/env node
/**
 * Rule usage statistics CLI script for AutoImprove.
 *
 * Usage:
 *   ./scripts/rule-usage-stats.ts [options]
 *
 * Options:
 *   --format <type>      Output format: json, markdown, summary (default: markdown)
 *   --output <file>      Output file path (default: stdout)
 *   --start <date>       Start date (ISO format: YYYY-MM-DD)
 *   --end <date>         End date (ISO format: YYYY-MM-DD)
 *   --last <period>      Time period: 7days, 30days, 90days, 1year
 *   --category <cat>     Filter by category (can be specified multiple times)
 *   --top <n>            Number of top rules to show (default: 10)
 *   --min-feedbacks <n>  Minimum feedbacks for problematic rules (default: 5)
 *   --help               Show this help message
 *
 * Examples:
 *   ./scripts/rule-usage-stats.ts --format=markdown
 *   ./scripts/rule-usage-stats.ts --last=30days --output=report.md
 *   ./scripts/rule-usage-stats.ts --category=Security --top=20
 */

import { RuleIndexManager } from "../src/mcp-server-ts/src/storage/rule-index.js";
import { RuleContentManager } from "../src/mcp-server-ts/src/storage/rule-content.js";
import { AdaptiveConfidenceCalculator } from "../src/mcp-server-ts/src/core/adaptive-confidence.js";
import { RuleUsageStatsAnalyzer } from "../src/mcp-server-ts/src/core/rule-usage-stats.js";
import { writeFileSync } from "fs";

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliOptions {
  format: "json" | "markdown" | "summary";
  output?: string;
  startDate?: Date;
  endDate?: Date;
  categories?: string[];
  topN: number;
  minFeedbacks: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    format: "markdown",
    topN: 10,
    minFeedbacks: 5,
    help: false,
  };

  const categories: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--format=")) {
      const format = arg.split("=")[1];
      if (format === "json" || format === "markdown" || format === "summary") {
        options.format = format;
      } else {
        console.error(`Invalid format: ${format}. Must be json, markdown, or summary.`);
        process.exit(1);
      }
    } else if (arg.startsWith("--output=")) {
      options.output = arg.split("=")[1];
    } else if (arg.startsWith("--start=")) {
      const dateStr = arg.split("=")[1];
      options.startDate = new Date(dateStr);
      if (isNaN(options.startDate.getTime())) {
        console.error(`Invalid start date: ${dateStr}. Use ISO format (YYYY-MM-DD).`);
        process.exit(1);
      }
    } else if (arg.startsWith("--end=")) {
      const dateStr = arg.split("=")[1];
      options.endDate = new Date(dateStr);
      if (isNaN(options.endDate.getTime())) {
        console.error(`Invalid end date: ${dateStr}. Use ISO format (YYYY-MM-DD).`);
        process.exit(1);
      }
    } else if (arg.startsWith("--last=")) {
      const period = arg.split("=")[1];
      const now = new Date();
      const daysAgo = parsePeriod(period);
      if (daysAgo === null) {
        console.error(
          `Invalid period: ${period}. Use format like 7days, 30days, 90days, 1year.`
        );
        process.exit(1);
      }
      options.startDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      options.endDate = now;
    } else if (arg.startsWith("--category=")) {
      categories.push(arg.split("=")[1]);
    } else if (arg.startsWith("--top=")) {
      options.topN = parseInt(arg.split("=")[1], 10);
      if (isNaN(options.topN) || options.topN < 1) {
        console.error(`Invalid top value: ${arg.split("=")[1]}. Must be a positive integer.`);
        process.exit(1);
      }
    } else if (arg.startsWith("--min-feedbacks=")) {
      options.minFeedbacks = parseInt(arg.split("=")[1], 10);
      if (isNaN(options.minFeedbacks) || options.minFeedbacks < 1) {
        console.error(
          `Invalid min-feedbacks value: ${arg.split("=")[1]}. Must be a positive integer.`
        );
        process.exit(1);
      }
    } else {
      console.error(`Unknown option: ${arg}`);
      console.error('Use --help to see available options.');
      process.exit(1);
    }
  }

  if (categories.length > 0) {
    options.categories = categories;
  }

  return options;
}

function parsePeriod(period: string): number | null {
  const match = period.match(/^(\d+)(days?|weeks?|months?|years?)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "day":
    case "days":
      return value;
    case "week":
    case "weeks":
      return value * 7;
    case "month":
    case "months":
      return value * 30; // Approximate
    case "year":
    case "years":
      return value * 365; // Approximate
    default:
      return null;
  }
}

function showHelp() {
  console.log(`
AutoImprove Rule Usage Statistics

Usage:
  rule-usage-stats [options]

Options:
  --format <type>      Output format: json, markdown, summary (default: markdown)
  --output <file>      Output file path (default: stdout)
  --start <date>       Start date (ISO format: YYYY-MM-DD)
  --end <date>         End date (ISO format: YYYY-MM-DD)
  --last <period>      Time period: 7days, 30days, 90days, 1year
  --category <cat>     Filter by category (can be specified multiple times)
  --top <n>            Number of top rules to show (default: 10)
  --min-feedbacks <n>  Minimum feedbacks for problematic rules (default: 5)
  --help, -h           Show this help message

Examples:
  # Generate markdown report
  rule-usage-stats --format=markdown

  # Generate report for last 30 days
  rule-usage-stats --last=30days --output=report.md

  # Filter by Security category and show top 20 rules
  rule-usage-stats --category=Security --top=20

  # Generate JSON statistics for specific date range
  rule-usage-stats --format=json --start=2026-01-01 --end=2026-06-01

  # Quick summary
  rule-usage-stats --format=summary
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const options = parseArgs(process.argv);

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  try {
    console.error("Loading rule data...");

    // Initialize managers
    const indexManager = new RuleIndexManager();
    const contentManager = new RuleContentManager();
    const adaptiveConfidence = new AdaptiveConfidenceCalculator();
    const statsAnalyzer = new RuleUsageStatsAnalyzer(
      indexManager,
      contentManager,
      adaptiveConfidence
    );

    console.error("Analyzing statistics...");

    // Generate statistics
    const stats = statsAnalyzer.getMultiDimensionalStats({
      startDate: options.startDate,
      endDate: options.endDate,
      categories: options.categories,
      minFeedbacks: options.minFeedbacks,
      topN: options.topN,
    });

    // Format output
    let output: string;
    if (options.format === "markdown") {
      output = statsAnalyzer.generateReport(stats, {
        title: "AutoImprove 规则使用统计报告",
      });
    } else if (options.format === "summary") {
      output = statsAnalyzer.generateSummary(stats);
    } else {
      output = JSON.stringify(stats, null, 2);
    }

    // Write output
    if (options.output) {
      writeFileSync(options.output, output, "utf-8");
      console.error(`\nReport saved to: ${options.output}`);
    } else {
      console.log(output);
    }

    // Print summary to stderr
    console.error("\n✅ Statistics generated successfully!");
    console.error(
      `   Total rules: ${stats.overview.total_rules}, Total feedbacks: ${stats.overview.total_feedbacks}`
    );
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
