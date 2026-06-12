import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import dns from 'node:dns';
import net from 'node:net';
import { applyNetworkPreflight } from '../../src/lib/network-preflight.js';

describe('applyNetworkPreflight', () => {
  let originalResultOrder: 'ipv4first' | 'ipv6first' | 'verbatim';
  let originalAutoSelectFamily: boolean;
  let originalSkip: string | undefined;
  let originalProbeHost: string | undefined;

  beforeEach(() => {
    originalResultOrder = dns.getDefaultResultOrder();
    originalAutoSelectFamily = net.getDefaultAutoSelectFamily();
    originalSkip = process.env.MIXARR_SKIP_NETWORK_PREFLIGHT;
    originalProbeHost = process.env.IPV6_PROBE_HOST;
  });

  afterEach(() => {
    dns.setDefaultResultOrder(originalResultOrder);
    net.setDefaultAutoSelectFamily(originalAutoSelectFamily);
    if (originalSkip === undefined) delete process.env.MIXARR_SKIP_NETWORK_PREFLIGHT;
    else process.env.MIXARR_SKIP_NETWORK_PREFLIGHT = originalSkip;
    if (originalProbeHost === undefined) delete process.env.IPV6_PROBE_HOST;
    else process.env.IPV6_PROBE_HOST = originalProbeHost;
  });

  it('is a no-op when MIXARR_SKIP_NETWORK_PREFLIGHT=1', async () => {
    process.env.MIXARR_SKIP_NETWORK_PREFLIGHT = '1';
    // Point at a host that would otherwise fail and trigger fallback,
    // to prove the skip flag short-circuits before the probe runs.
    process.env.IPV6_PROBE_HOST = 'nonexistent.invalid';

    await applyNetworkPreflight();

    expect(dns.getDefaultResultOrder()).toBe(originalResultOrder);
    expect(net.getDefaultAutoSelectFamily()).toBe(originalAutoSelectFamily);
  });

  it('falls back to IPv4 when the probe host is unresolvable', async () => {
    // RFC 6761 guarantees .invalid never resolves — exercises the failure
    // path without mocking DNS or network.
    process.env.IPV6_PROBE_HOST = 'nonexistent.invalid';
    delete process.env.MIXARR_SKIP_NETWORK_PREFLIGHT;

    await applyNetworkPreflight();

    expect(dns.getDefaultResultOrder()).toBe('ipv4first');
    expect(net.getDefaultAutoSelectFamily()).toBe(false);
  });
});
