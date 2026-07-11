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
 */

import OpenAI from "openai";
import { logger } from "./logger.js";

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

  constructor() {
    this.configs = this.loadConfigurations();
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

    // Priority 2: ANTHROPIC_API_KEY (official Anthropic)
    if (process.env.ANTHROPIC_API_KEY) {
      let baseURL = process.env.ANTHROPIC_BASE_URL;
      if (baseURL && !baseURL.endsWith('/v1')) {
        baseURL = baseURL.replace(/\/$/, '') + '/v1';
      }

      configs.push({
        name: "ANTHROPIC_API_KEY",
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL,
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        priority: 2
      });
    }

    // Priority 3: ANTHROPIC_AUTH_TOKEN (legacy/alternative)
    if (process.env.ANTHROPIC_AUTH_TOKEN) {
      let baseURL = process.env.ANTHROPIC_BASE_URL;
      if (baseURL && !baseURL.endsWith('/v1')) {
        baseURL = baseURL.replace(/\/$/, '') + '/v1';
      }

      configs.push({
        name: "ANTHROPIC_AUTH_TOKEN",
        apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
        baseURL,
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        priority: 3
      });
    }

    return configs.sort((a, b) => a.priority - b.priority);
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
      const baseInfo = config.baseURL ? `baseURL=${config.baseURL}` : "default endpoint";
      logger.info("llm-config", `  ${idx + 1}. ${config.name} (${baseInfo}, model=${config.model})`);
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
   * Check if error indicates API failure requiring fallback
   */
  private shouldFallback(error: any): boolean {
    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }

    // OpenAI SDK error response
    if (error.status) {
      const status = error.status;
      // Rate limit, quota exceeded, auth failure, or server error
      if (status === 429 || status === 401 || status === 403 || status >= 500) {
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
      return true;
    }

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
    logger.warn("llm-config", `⚠️  Switching to fallback configuration: ${nextConfig.name}`);
    logger.info("llm-config", `   Model: ${nextConfig.model}, Base URL: ${nextConfig.baseURL || "default"}`);

    return true;
  }

  /**
   * Execute LLM call with automatic fallback on failure
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

    // Try current config and all fallbacks
    while (attemptCount < this.configs.length) {
      const config = this.configs[this.currentConfigIndex];
      const client = this.getClient(config);

      try {
        logger.debug("llm-config", `Attempting LLM call with ${config.name} (attempt ${attemptCount + 1}/${this.configs.length})`);

        const result = await operation(client, config.model);

        // Success - log if we recovered from previous failure
        if (attemptCount > 0) {
          logger.info("llm-config", `✓ LLM call succeeded with fallback configuration: ${config.name}`);
        }

        return result;

      } catch (error: any) {
        lastError = error;
        attemptCount++;

        // Log detailed error info
        const errorDetails = error.status
          ? `HTTP ${error.status}: ${error.message}`
          : error.code
          ? `${error.code}: ${error.message}`
          : error.message || "Unknown error";

        logger.error("llm-config", `✗ LLM call failed with ${config.name}: ${errorDetails}`);

        // Decide whether to fallback
        if (fallbackOnError && this.shouldFallback(error)) {
          const hasFallback = this.switchToFallback();
          if (!hasFallback) {
            break; // No more fallbacks
          }
          continue; // Try next configuration
        } else {
          // Non-retriable error or fallback disabled
          throw error;
        }
      }
    }

    // All configurations failed
    throw new Error(
      `All LLM configurations failed after ${attemptCount} attempts. ` +
      `Last error: ${lastError?.message || "Unknown"}. ` +
      `Failed configs: ${Array.from(this.failedConfigs).join(", ")}`
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
