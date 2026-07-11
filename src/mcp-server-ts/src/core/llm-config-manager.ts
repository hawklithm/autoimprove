/**
 * LLM Configuration Manager with Fallback Strategy
 *
 * Priority order:
 * 1. LLM_API_KEY + LLM_BASE_URL + LLM_MODEL (Primary)
 * 2. ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL + ANTHROPIC_MODEL (Fallback 1)
 * 3. ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL + ANTHROPIC_MODEL (Fallback 2)
 *
 * Degradation triggers:
 * - 429 (Rate limit / quota exceeded)
 * - 401/403 (Auth failure)
 * - Network timeout (ECONNREFUSED, ETIMEDOUT)
 * - 5xx server errors
 *
 * Smart Fallback:
 * - Tracks consecutive failures per config
 * - If a config fails 10+ times consecutively, it's automatically deprioritized
 * - On next restart, starts with healthier configs first
 * - Auto-recovers when deprioritized config succeeds again
 */

import OpenAI from "openai";
import { logger } from "./logger.js";
import { LLMFailureTracker } from "./llm-failure-tracker.js";

export interface LLMConfig {
  name: string;
  apiKey: string;
  baseURL?: string;
  model: string;
  priority: number;
}

export interface LLMCallOptions {
  maxRetries?: number;
  timeoutMs?: number;
  fallbackOnError?: boolean;
}

export class LLMConfigManager {
  private configs: LLMConfig[];
  private currentConfigIndex: number = 0;
  private clients: Map<string, OpenAI> = new Map();
  private failedConfigs: Set<string> = new Set();
  private failureTracker: LLMFailureTracker;

  constructor() {
    this.failureTracker = new LLMFailureTracker();
    this.configs = this.loadConfigurations();
    this.reorderConfigsByHealth();
    this.logConfigurationStatus();
  }

  /**
   * Load all available LLM configurations in priority order
   */
  private loadConfigurations(): LLMConfig[] {
    const configs: LLMConfig[] = [];

    // Priority 1: LLM_* environment variables (custom/primary)
    if (process.env.LLM_API_KEY) {
      let baseURL = process.env.LLM_BASE_URL;
      if (baseURL && !baseURL.endsWith('/v1')) {
        baseURL = baseURL.replace(/\/$/, '') + '/v1';
      }

      configs.push({
        name: "LLM_PRIMARY",
        apiKey: process.env.LLM_API_KEY,
        baseURL,
        model: process.env.LLM_MODEL || "claude-sonnet-4-6",
        priority: 1
      });
    }

    // Priority 2: ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN (二选一)
    // ANTHROPIC_API_KEY takes precedence if both are set
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
    if (anthropicApiKey) {
      let baseURL = process.env.ANTHROPIC_BASE_URL;
      if (baseURL && !baseURL.endsWith('/v1')) {
        baseURL = baseURL.replace(/\/$/, '') + '/v1';
      }

      const configName = process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN";
      configs.push({
        name: configName,
        apiKey: anthropicApiKey,
        baseURL,
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        priority: 2
      });
    }

    return configs.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Reorder configurations based on failure history
   * Configs with 10+ consecutive failures are moved to the end
   */
  private reorderConfigsByHealth(): void {
    const deprioritized = this.failureTracker.getDeprioritizedConfigs();

    if (deprioritized.length === 0) {
      return;
    }

    // Separate healthy and unhealthy configs
    const healthy: LLMConfig[] = [];
    const unhealthy: LLMConfig[] = [];

    for (const config of this.configs) {
      if (deprioritized.includes(config.name)) {
        unhealthy.push(config);
      } else {
        healthy.push(config);
      }
    }

    // Log reordering
    if (unhealthy.length > 0) {
      logger.warn("llm-config", `⚠️  Reordering configs due to excessive failures:`);
      unhealthy.forEach(config => {
        const state = this.failureTracker.getFailureState(config.name);
        logger.warn("llm-config", `   • ${config.name}: ${state?.consecutiveFailures} consecutive failures (last: ${state?.lastFailureReason.substring(0, 60)}...)`);
      });
      logger.info("llm-config", `   → ${unhealthy.map(c => c.name).join(", ")} moved to end of fallback chain`);
    }

    // Reorder: healthy first, then unhealthy
    this.configs = [...healthy, ...unhealthy];
  }

  /**
   * Log configuration status on initialization
   */
  private logConfigurationStatus(): void {
    if (this.configs.length === 0) {
      logger.warn("llm-config", "⚠️  No LLM API keys found - LLM features disabled");
      logger.warn("llm-config", "   Set LLM_API_KEY or ANTHROPIC_API_KEY to enable LLM enhancement");
      return;
    }

    logger.info("llm-config", `✓ Loaded ${this.configs.length} LLM configuration(s):`);
    this.configs.forEach((config, idx) => {
      const maskedToken = this.maskApiKey(config.apiKey);
      const baseInfo = config.baseURL || "default endpoint";
      logger.info("llm-config", `  ${idx + 1}. ${config.name}`);
      logger.info("llm-config", `     model=${config.model}, baseURL=${baseInfo}, apiKey=${maskedToken}`);
    });
  }

  /**
   * Get OpenAI client for current configuration
   */
  private getClient(config: LLMConfig): OpenAI {
    const cacheKey = `${config.name}-${config.baseURL || "default"}`;

    if (!this.clients.has(cacheKey)) {
      const clientOptions: any = { apiKey: config.apiKey };
      if (config.baseURL) {
        clientOptions.baseURL = config.baseURL;
      }

      this.clients.set(cacheKey, new OpenAI(clientOptions));
    }

    return this.clients.get(cacheKey)!;
  }

  /**
   * Mask API key for logging (show first 4 and last 4 characters)
   */
  private maskApiKey(apiKey: string): string {
    if (!apiKey || apiKey.length <= 8) {
      return '****';
    }
    const first4 = apiKey.substring(0, 4);
    const last4 = apiKey.substring(apiKey.length - 4);
    const maskedMiddle = '*'.repeat(Math.min(apiKey.length - 8, 12));
    return `${first4}${maskedMiddle}${last4}`;
  }

  /**
   * Check if error indicates API failure requiring fallback
   */
  private shouldFallback(error: any): boolean {
    // Debug: Log error structure
    logger.debug("llm-config", `shouldFallback checking error: ${JSON.stringify({
      code: error.code,
      status: error.status,
      message: error.message,
      type: error.type,
      constructor: error.constructor?.name
    })}`);

    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      logger.debug("llm-config", "shouldFallback: true (network error code match)");
      return true;
    }

    // OpenAI SDK error response
    if (error.status) {
      const status = error.status;
      // Rate limit, quota exceeded, auth failure, or server error
      if (status === 429 || status === 401 || status === 403 || status >= 500) {
        logger.debug("llm-config", `shouldFallback: true (HTTP status ${status} match)`);
        return true;
      }
    }

    // Check error message for common patterns
    const errorMsg = error.message?.toLowerCase() || "";
    if (errorMsg.includes("quota") ||
        errorMsg.includes("rate limit") ||
        errorMsg.includes("insufficient") ||
        errorMsg.includes("timeout") ||
        errorMsg.includes("network")) {
      logger.debug("llm-config", `shouldFallback: true (error message pattern match: "${errorMsg}")`);
      return true;
    }

    logger.debug("llm-config", "shouldFallback: false (no match found)");
    return false;
  }

  /**
   * Mark current configuration as failed and switch to next
   */
  private switchToFallback(): boolean {
    if (this.currentConfigIndex >= this.configs.length - 1) {
      logger.error("llm-config", "❌ All LLM configurations exhausted, no more fallbacks available");
      return false;
    }

    const currentConfig = this.configs[this.currentConfigIndex];
    this.failedConfigs.add(currentConfig.name);
    this.currentConfigIndex++;

    const nextConfig = this.configs[this.currentConfigIndex];
    const maskedToken = this.maskApiKey(nextConfig.apiKey);
    logger.warn("llm-config", `⚠️  Switching to fallback configuration: ${nextConfig.name}`);
    logger.info("llm-config", `   Config: model=${nextConfig.model}, baseURL=${nextConfig.baseURL || "default"}, apiKey=${maskedToken}`);

    return true;
  }

  /**
   * Execute LLM call with automatic fallback on failure
   * IMPORTANT: This method is concurrency-safe. Each call maintains its own
   * attempt state without modifying shared instance state.
   */
  async callWithFallback<T>(
    operation: (client: OpenAI, model: string) => Promise<T>,
    options: LLMCallOptions = {}
  ): Promise<T> {
    const { maxRetries = 1, fallbackOnError = true } = options;

    if (this.configs.length === 0) {
      throw new Error("No LLM configurations available - set LLM_API_KEY or ANTHROPIC_API_KEY");
    }

    let lastError: any;
    let attemptCount = 0;
    const failedConfigNames: string[] = [];

    // Use local index to avoid race conditions in concurrent calls
    let localConfigIndex = this.currentConfigIndex;

    logger.debug("llm-config", `Starting callWithFallback: ${this.configs.length} configs available, starting from index ${localConfigIndex}, fallbackOnError: ${fallbackOnError}`);

    // Try all configs starting from current index
    while (attemptCount < this.configs.length) {
      // Check if localConfigIndex is valid
      if (localConfigIndex >= this.configs.length) {
        logger.debug("llm-config", `Reached end of config list (index ${localConfigIndex}), breaking loop`);
        break;
      }

      const config = this.configs[localConfigIndex];
      if (!config) {
        logger.error("llm-config", `❌ No config found at index ${localConfigIndex}, breaking loop`);
        break;
      }

      const client = this.getClient(config);

      try {
        const maskedToken = this.maskApiKey(config.apiKey);
        logger.debug("llm-config", `Attempting LLM call with ${config.name} (attempt ${attemptCount + 1}/${this.configs.length}, index: ${localConfigIndex})`);
        logger.debug("llm-config", `  Config: model=${config.model}, baseURL=${config.baseURL || 'default'}, apiKey=${maskedToken}`);

        const result = await operation(client, config.model);

        // Success - reset failure tracking and log if we recovered from previous failure
        this.failureTracker.recordSuccess(config.name);

        if (attemptCount > 0) {
          logger.info("llm-config", `✓ LLM call succeeded with fallback configuration: ${config.name}`);
          logger.info("llm-config", `  Config: model=${config.model}, baseURL=${config.baseURL || 'default'}, apiKey=${maskedToken}`);
        }

        return result;

      } catch (error: any) {
        lastError = error;
        attemptCount++;
        failedConfigNames.push(config.name);

        // Record failure for tracking
        const errorDetails = error.status
          ? `HTTP ${error.status}: ${error.message}`
          : error.code
          ? `${error.code}: ${error.message}`
          : error.message || "Unknown error";

        this.failureTracker.recordFailure(config.name, errorDetails);

        // Log detailed error info with full config details

        const maskedToken = this.maskApiKey(config.apiKey);
        logger.error("llm-config", `✗ [Attempt ${attemptCount}/${this.configs.length}] LLM call failed with ${config.name}: ${errorDetails}`);
        logger.error("llm-config", `  Config: model=${config.model}, baseURL=${config.baseURL || 'default'}, apiKey=${maskedToken}`);

        // Decide whether to fallback
        const shouldFallbackResult = this.shouldFallback(error);
        logger.debug("llm-config", `shouldFallback(error) = ${shouldFallbackResult}, fallbackOnError = ${fallbackOnError}`);

        if (fallbackOnError && shouldFallbackResult) {
          // Check if there's a next config to try
          if (localConfigIndex >= this.configs.length - 1) {
            logger.error("llm-config", "❌ All LLM configurations exhausted, no more fallbacks available");
            break;
          }

          // Move to next config (local index only, no shared state mutation)
          localConfigIndex++;
          const nextConfig = this.configs[localConfigIndex];
          const nextMaskedToken = this.maskApiKey(nextConfig.apiKey);
          logger.warn("llm-config", `⚠️  Switching to fallback configuration: ${nextConfig.name}`);
          logger.info("llm-config", `   Config: model=${nextConfig.model}, baseURL=${nextConfig.baseURL || "default"}, apiKey=${nextMaskedToken}`);

          continue; // Try next configuration
        } else {
          // Non-retriable error or fallback disabled
          logger.error("llm-config", `Not falling back (fallbackOnError: ${fallbackOnError}, shouldFallback: ${shouldFallbackResult}), throwing error`);
          throw error;
        }
      }
    }

    // All configurations failed
    throw new Error(
      `All LLM configurations failed after ${attemptCount} attempts. ` +
      `Last error: ${lastError?.message || "Unknown"}. ` +
      `Failed configs: ${failedConfigNames.join(", ")}`
    );
  }

  /**
   * Get current active configuration
   */
  getCurrentConfig(): LLMConfig | null {
    return this.configs[this.currentConfigIndex] || null;
  }

  /**
   * Check if any LLM configuration is available
   */
  isAvailable(): boolean {
    return this.configs.length > 0;
  }

  /**
   * Reset to primary configuration (for testing or after recovery)
   */
  reset(): void {
    this.currentConfigIndex = 0;
    this.failedConfigs.clear();
    logger.info("llm-config", "Reset to primary LLM configuration");
  }

  /**
   * Get status summary
   */
  getStatus(): {
    available: boolean;
    current: string | null;
    fallbacksAvailable: number;
    failedConfigs: string[];
  } {
    return {
      available: this.isAvailable(),
      current: this.getCurrentConfig()?.name || null,
      fallbacksAvailable: this.configs.length - this.currentConfigIndex - 1,
      failedConfigs: Array.from(this.failedConfigs)
    };
  }
}
