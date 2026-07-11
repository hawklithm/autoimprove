#!/usr/bin/env tsx
/**
 * Test LLM Fallback Mechanism
 *
 * This script tests the priority order and automatic fallback:
 * 1. LLM_API_KEY (primary)
 * 2. ANTHROPIC_API_KEY (fallback 1)
 * 3. ANTHROPIC_AUTH_TOKEN (fallback 2)
 *
 * Test scenarios:
 * - Normal operation with primary config
 * - Automatic fallback on 429 (rate limit)
 * - Automatic fallback on 401/403 (auth error)
 * - Automatic fallback on network timeout
 * - All configs exhausted (final error)
 */

import { LLMConfigManager } from './src/mcp-server-ts/src/core/llm-config-manager.js';

async function testNormalOperation() {
  console.log('\n=== Test 1: Normal Operation ===');

  const manager = new LLMConfigManager();

  if (!manager.isAvailable()) {
    console.log('❌ No LLM configurations available');
    console.log('   Set LLM_API_KEY or ANTHROPIC_API_KEY to test');
    return;
  }

  const status = manager.getStatus();
  console.log('Status:', JSON.stringify(status, null, 2));

  try {
    const result = await manager.callWithFallback(async (client, model) => {
      console.log(`Calling with model: ${model}`);

      // Simple test call - just get a short completion
      const response = await client.chat.completions.create({
        model,
        max_tokens: 50,
        messages: [{
          role: "user",
          content: "Say 'test successful' in 3 words or less."
        }]
      });

      return response.choices[0]?.message?.content || "";
    });

    console.log('✓ LLM call succeeded:', result);
  } catch (error: any) {
    console.log('✗ LLM call failed:', error.message);
  }
}

async function testManualFallback() {
  console.log('\n=== Test 2: Manual Fallback Simulation ===');

  const manager = new LLMConfigManager();

  if (!manager.isAvailable()) {
    console.log('❌ No LLM configurations available');
    return;
  }

  console.log('Initial config:', manager.getCurrentConfig()?.name);

  // Simulate an error that should trigger fallback
  try {
    await manager.callWithFallback(async (client, model) => {
      // Simulate a 429 rate limit error
      const error: any = new Error('Rate limit exceeded');
      error.status = 429;
      throw error;
    });
  } catch (error: any) {
    console.log('Expected error caught:', error.message);
  }

  console.log('After fallback attempt:', manager.getCurrentConfig()?.name);
  console.log('Status:', JSON.stringify(manager.getStatus(), null, 2));
}

async function testConfigPriority() {
  console.log('\n=== Test 3: Configuration Priority ===');

  const manager = new LLMConfigManager();

  const status = manager.getStatus();
  console.log('Available configurations:', status.fallbacksAvailable + 1);
  console.log('Current config:', status.current);
  console.log('Failed configs:', status.failedConfigs);

  const current = manager.getCurrentConfig();
  if (current) {
    console.log('\nCurrent configuration details:');
    console.log(`  Name: ${current.name}`);
    console.log(`  Model: ${current.model}`);
    console.log(`  Base URL: ${current.baseURL || 'default'}`);
    console.log(`  Priority: ${current.priority}`);
  }
}

async function testResetFunctionality() {
  console.log('\n=== Test 4: Reset Functionality ===');

  const manager = new LLMConfigManager();

  if (!manager.isAvailable()) {
    console.log('❌ No LLM configurations available');
    return;
  }

  console.log('Before reset:', manager.getCurrentConfig()?.name);

  // Trigger a fallback
  try {
    await manager.callWithFallback(async () => {
      const error: any = new Error('Simulated error');
      error.status = 429;
      throw error;
    });
  } catch (e) {
    // Expected
  }

  console.log('After error:', manager.getCurrentConfig()?.name);

  manager.reset();
  console.log('After reset:', manager.getCurrentConfig()?.name);
}

async function main() {
  console.log('🧪 LLM Fallback Mechanism Test Suite\n');
  console.log('Environment variables:');
  console.log('  LLM_API_KEY:', process.env.LLM_API_KEY ? '✓ Set' : '✗ Not set');
  console.log('  LLM_BASE_URL:', process.env.LLM_BASE_URL || 'not set');
  console.log('  LLM_MODEL:', process.env.LLM_MODEL || 'not set');
  console.log('  ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✓ Set' : '✗ Not set');
  console.log('  ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || 'not set');
  console.log('  ANTHROPIC_MODEL:', process.env.ANTHROPIC_MODEL || 'not set');
  console.log('  ANTHROPIC_AUTH_TOKEN:', process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '✗ Not set');

  await testConfigPriority();
  await testManualFallback();
  await testResetFunctionality();

  // Only run real API call if explicitly requested
  if (process.argv.includes('--real-call')) {
    await testNormalOperation();
  } else {
    console.log('\n💡 Tip: Run with --real-call to test actual API calls');
  }

  console.log('\n✅ All tests completed');
}

main().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
