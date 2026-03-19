/**
 * Update Checker Service
 *
 * Periodically checks GitHub Releases for a newer version of Mixarr.
 * Results are cached in Redis so multiple API instances share one check.
 */

import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { createLogger } from '../lib/logger.js';
import { VERSION } from '../version.js';
import { redis } from '../lib/redis.js';

const log = createLogger('UpdateChecker');
const GITHUB_API = 'https://api.github.com/repos/aquantumofdonuts/mixarr/releases/latest';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const REDIS_KEY = 'mixarr:update-check';
const REDIS_TTL = 6 * 60 * 60; // 6 hours in seconds

export interface UpdateInfo {
  available: boolean;
  latest: string;
  url: string;
  checkedAt: string;
}

/** Simple semver comparison: returns true if remote > local */
function isNewer(remote: string, local: string): boolean {
  const r = remote.replace(/^v/, '').split('.').map(Number);
  const l = local.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    // Check Redis cache first
    const cached = await redis.get(REDIS_KEY);
    if (cached) return JSON.parse(cached);

    const res = await fetchWithTimeout(GITHUB_API, {
      timeout: 10_000,
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (!res.ok) {
      log.warn(`GitHub API returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { tag_name: string; html_url: string };
    const latest = data.tag_name.replace(/^v/, '');
    const info: UpdateInfo = {
      available: isNewer(latest, VERSION),
      latest,
      url: data.html_url,
      checkedAt: new Date().toISOString(),
    };

    // Cache in Redis
    await redis.set(REDIS_KEY, JSON.stringify(info), 'EX', REDIS_TTL);

    if (info.available) {
      log.info(`🔔 Update available: v${latest} (current: v${VERSION}) — ${data.html_url}`);
    } else {
      log.debug(`Up to date (v${VERSION})`);
    }

    return info;
  } catch (err) {
    log.warn('Update check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function startUpdateChecker(): void {
  // First check 30 seconds after boot (don't block startup)
  setTimeout(() => {
    checkForUpdate();
    intervalId = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
  }, 30_000);
}

export function stopUpdateChecker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/** Read cached update status for the API endpoint — triggers a fresh check if cache is empty */
export async function getUpdateStatus(): Promise<UpdateInfo | null> {
  try {
    const cached = await redis.get(REDIS_KEY);
    if (cached) return JSON.parse(cached);
    // No cache — run a live check so the first API call after boot/expiry isn't empty
    return await checkForUpdate();
  } catch {
    return null;
  }
}
