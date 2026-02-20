/**
 * Strategy registry — maps subscription type strings to their strategy
 * implementation so the worker can look them up at runtime.
 */

import type { SubscriptionType } from '../../schemas/subscription.js';
import type { SubscriptionStrategy } from './types.js';

const strategies = new Map<SubscriptionType, SubscriptionStrategy>();

/** Register a strategy for the given subscription type. Throws if already registered. */
export function registerStrategy(type: SubscriptionType, strategy: SubscriptionStrategy): void {
  if (strategies.has(type)) {
    throw new Error(`Strategy already registered for type: ${type}`);
  }
  strategies.set(type, strategy);
}

/** Look up the strategy for a subscription type. Returns undefined if none registered. */
export function getStrategy(type: SubscriptionType): SubscriptionStrategy | undefined {
  return strategies.get(type);
}

/** @internal — for tests only. Clears all registered strategies. */
export function clearRegistry(): void {
  strategies.clear();
}
