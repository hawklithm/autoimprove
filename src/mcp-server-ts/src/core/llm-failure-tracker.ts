/**
 * LLM Failure Tracker
 *
 * Tracks consecutive failures per LLM configuration and persists state to disk.
 * When a config fails 10+ times consecutively, it's automatically deprioritized
 * until it succeeds again.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { logger } from "./logger.js";

export interface FailureState {
  configName: string;
  consecutiveFailures: number;
  lastFailureTime: string;
  lastFailureReason: string;
  totalFailures: number;
  firstFailureTime: string;
}

export interface FailureTrackerState {
  version: string;
  configs: Record<string, FailureState>;
  lastUpdated: string;
}

export class LLMFailureTracker {
  private static readonly STATE_FILE = join(homedir(), ".autoimprove", "llm_failure_state.json");
  private static readonly FAILURE_THRESHOLD = 10;
  private static readonly STATE_VERSION = "1.0";

  private state: FailureTrackerState;

  constructor() {
    this.state = this.loadState();
  }

  /**
   * Load failure state from disk
   */
  private loadState(): FailureTrackerState {
    if (!existsSync(LLMFailureTracker.STATE_FILE)) {
      return {
        version: LLMFailureTracker.STATE_VERSION,
        configs: {},
        lastUpdated: new Date().toISOString()
      };
    }

    try {
      const data = readFileSync(LLMFailureTracker.STATE_FILE, "utf8");
      const state = JSON.parse(data) as FailureTrackerState;

      // Version migration if needed
      if (state.version !== LLMFailureTracker.STATE_VERSION) {
        logger.warn("failure-tracker", `State version mismatch (${state.version} vs ${LLMFailureTracker.STATE_VERSION}), resetting`);
        return {
          version: LLMFailureTracker.STATE_VERSION,
          configs: {},
          lastUpdated: new Date().toISOString()
        };
      }

      return state;
    } catch (error) {
      logger.error("failure-tracker", `Failed to load state file: ${error}`);
      return {
        version: LLMFailureTracker.STATE_VERSION,
        configs: {},
        lastUpdated: new Date().toISOString()
      };
    }
  }

  /**
   * Save failure state to disk
   */
  private saveState(): void {
    try {
      const dir = dirname(LLMFailureTracker.STATE_FILE);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      this.state.lastUpdated = new Date().toISOString();
      writeFileSync(
        LLMFailureTracker.STATE_FILE,
        JSON.stringify(this.state, null, 2),
        "utf8"
      );
    } catch (error) {
      logger.error("failure-tracker", `Failed to save state file: ${error}`);
    }
  }

  /**
   * Record a failure for a config
   */
  recordFailure(configName: string, reason: string): void {
    const now = new Date().toISOString();

    if (!this.state.configs[configName]) {
      this.state.configs[configName] = {
        configName,
        consecutiveFailures: 1,
        lastFailureTime: now,
        lastFailureReason: reason,
        totalFailures: 1,
        firstFailureTime: now
      };
    } else {
      const config = this.state.configs[configName];
      config.consecutiveFailures++;
      config.totalFailures++;
      config.lastFailureTime = now;
      config.lastFailureReason = reason;
    }

    const failures = this.state.configs[configName].consecutiveFailures;

    if (failures === LLMFailureTracker.FAILURE_THRESHOLD) {
      logger.warn(
        "failure-tracker",
        `⚠️  ${configName} reached ${LLMFailureTracker.FAILURE_THRESHOLD} consecutive failures - will be deprioritized on next restart`
      );
    } else if (failures > LLMFailureTracker.FAILURE_THRESHOLD) {
      logger.debug(
        "failure-tracker",
        `${configName} failure count: ${failures} (threshold: ${LLMFailureTracker.FAILURE_THRESHOLD})`
      );
    }

    this.saveState();
  }

  /**
   * Record a success for a config (resets consecutive failures)
   */
  recordSuccess(configName: string): void {
    if (this.state.configs[configName]) {
      const previousFailures = this.state.configs[configName].consecutiveFailures;

      if (previousFailures >= LLMFailureTracker.FAILURE_THRESHOLD) {
        logger.info(
          "failure-tracker",
          `✓ ${configName} recovered after ${previousFailures} consecutive failures - restored to normal priority`
        );
      }

      // Reset consecutive failures but keep total count for statistics
      this.state.configs[configName].consecutiveFailures = 0;
      this.saveState();
    }
  }

  /**
   * Check if a config should be deprioritized due to excessive failures
   */
  shouldDeprioritize(configName: string): boolean {
    const config = this.state.configs[configName];
    if (!config) {
      return false;
    }

    return config.consecutiveFailures >= LLMFailureTracker.FAILURE_THRESHOLD;
  }

  /**
   * Get failure state for a config
   */
  getFailureState(configName: string): FailureState | null {
    return this.state.configs[configName] || null;
  }

  /**
   * Get all configs that exceed failure threshold
   */
  getDeprioritizedConfigs(): string[] {
    return Object.keys(this.state.configs).filter(name =>
      this.state.configs[name].consecutiveFailures >= LLMFailureTracker.FAILURE_THRESHOLD
    );
  }

  /**
   * Manually reset failure count for a config
   */
  resetConfig(configName: string): boolean {
    if (this.state.configs[configName]) {
      logger.info("failure-tracker", `Manually resetting failure state for ${configName}`);
      delete this.state.configs[configName];
      this.saveState();
      return true;
    }
    return false;
  }

  /**
   * Reset all failure tracking
   */
  resetAll(): void {
    logger.info("failure-tracker", "Resetting all failure tracking state");
    this.state = {
      version: LLMFailureTracker.STATE_VERSION,
      configs: {},
      lastUpdated: new Date().toISOString()
    };
    this.saveState();
  }

  /**
   * Get summary of all tracked configs
   */
  getSummary(): {
    totalConfigs: number;
    deprioritizedConfigs: string[];
    recentFailures: Array<{ name: string; failures: number; lastReason: string }>;
  } {
    const deprioritized = this.getDeprioritizedConfigs();
    const recentFailures = Object.values(this.state.configs)
      .filter(c => c.consecutiveFailures > 0)
      .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures)
      .map(c => ({
        name: c.configName,
        failures: c.consecutiveFailures,
        lastReason: c.lastFailureReason
      }));

    return {
      totalConfigs: Object.keys(this.state.configs).length,
      deprioritizedConfigs: deprioritized,
      recentFailures
    };
  }
}
