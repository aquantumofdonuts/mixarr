/**
 * Rate Limiter Service
 * 
 * Provides rate limiting for external API calls to prevent hitting rate limits.
 */

import { setTimeout as delay } from 'node:timers/promises';

interface RateLimitConfig {
  requestsPerSecond: number;
  burstSize?: number;
}

interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

const limiters = new Map<string, RateLimitState>();

const configs: Record<string, RateLimitConfig> = {
  lidarr: { requestsPerSecond: 2, burstSize: 5 },      // Conservative for Lidarr stability
  lidarr_add: { requestsPerSecond: 0.5, burstSize: 2 }, // Very slow for artist adds (1 per 2 seconds)
  spotify: { requestsPerSecond: 5, burstSize: 10 },
  lastfm: { requestsPerSecond: 5, burstSize: 10 },
  musicbrainz: { requestsPerSecond: 1, burstSize: 1 },
  listenbrainz: { requestsPerSecond: 2, burstSize: 5 }, // ListenBrainz: No strict limits, be respectful
  tautulli: { requestsPerSecond: 5, burstSize: 10 },   // Tautulli is self-hosted, can be faster
  deezer: { requestsPerSecond: 10, burstSize: 20 },    // Deezer: 50 req/5s = 10 req/s official limit
  tidal: { requestsPerSecond: 1, burstSize: 3 },       // TIDAL: Conservative, no official docs
  discogs: { requestsPerSecond: 1, burstSize: 5 },     // Discogs: 60 req/min = 1 req/s
  bandcamp: { requestsPerSecond: 2, burstSize: 4 },    // Bandcamp: Conservative, no official API
};

function getOrCreateLimiter(service: string): RateLimitState {
  if (!limiters.has(service)) {
    const config = configs[service] || { requestsPerSecond: 5, burstSize: 10 };
    limiters.set(service, {
      tokens: config.burstSize || config.requestsPerSecond,
      lastRefill: Date.now(),
    });
  }
  return limiters.get(service)!;
}

function refillTokens(service: string): void {
  const state = getOrCreateLimiter(service);
  const config = configs[service] || { requestsPerSecond: 5, burstSize: 10 };
  const now = Date.now();
  const elapsed = (now - state.lastRefill) / 1000;
  const tokensToAdd = elapsed * config.requestsPerSecond;
  
  state.tokens = Math.min(
    config.burstSize || config.requestsPerSecond,
    state.tokens + tokensToAdd
  );
  state.lastRefill = now;
}

export async function rateLimit(service: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  refillTokens(service);
  const state = getOrCreateLimiter(service);
  
  if (state.tokens < 1) {
    const config = configs[service] || { requestsPerSecond: 5 };
    const waitTime = (1 - state.tokens) / config.requestsPerSecond * 1000;
    await delay(waitTime, undefined, { signal });
    refillTokens(service);
  }
  
  signal?.throwIfAborted();
  state.tokens -= 1;
}

export function setRateLimitConfig(service: string, config: RateLimitConfig): void {
  configs[service] = config;
  limiters.delete(service); // Reset the limiter
}
