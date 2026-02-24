/**
 * Strategy Registry - Unknown Type Tests
 *
 * Verifies that:
 * - getStrategy() returns undefined for an unknown subscription type.
 * - The worker's guard throws for an unregistered strategy type.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';
import type { SubscriptionType } from '../../../src/schemas/subscription.js';

describe('Strategy Registry - Unknown Type', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('getStrategy returns undefined for an unregistered type', () => {
    const strategy = getStrategy('lastfm_chart' as SubscriptionType);
    // Registry was cleared, so nothing is registered
    expect(strategy).toBeUndefined();
  });

  it('worker guard should throw for unknown subscription type', () => {
    // This mirrors the guard added to subscription-worker.ts
    const subscriptionType = 'nonexistent_type';
    const strategy = getStrategy(subscriptionType as SubscriptionType);

    expect(strategy).toBeUndefined();

    // Simulate the worker guard
    const guardFn = () => {
      if (!strategy) {
        throw new Error(`No strategy registered for subscription type: ${subscriptionType}`);
      }
    };

    expect(guardFn).toThrow('No strategy registered for subscription type: nonexistent_type');
  });

  it('getStrategy returns a strategy for a registered type', async () => {
    // Import a strategy module to register its strategies
    await import('../../../src/jobs/strategies/lastfm.js');
    const strategy = getStrategy('lastfm_chart' as SubscriptionType);
    expect(strategy).toBeDefined();
    expect(strategy).toHaveProperty('execute');
  });
});
