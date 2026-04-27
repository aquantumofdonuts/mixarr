/**
 * Network Preflight
 *
 * Some Docker/host networking setups (Hetzner LXC, OCI, misconfigured bridges)
 * advertise IPv6 via DNS and a default route, but silently drop outbound v6
 * packets. Node's `fetch` (undici) uses Happy Eyeballs and may attempt IPv6
 * first, hanging until the request times out instead of falling back cleanly.
 *
 * On startup we probe a known dual-stack host over IPv6 with a short timeout.
 * If that fails, we prefer IPv4 in DNS results and disable autoSelectFamily so
 * outbound fetches go straight to v4. This is a no-op on healthy networks and
 * on hosts without any IPv6 stack.
 */
import dns from 'node:dns';
import net from 'node:net';
import { createLogger } from './logger.js';

const logger = createLogger('NetworkPreflight');

const PROBE_PORT = 443;
const PROBE_TIMEOUT_MS = 1500;

async function ipv6EgressWorks(host: string): Promise<boolean> {
  let address: string;
  try {
    address = await new Promise<string>((resolve, reject) => {
      dns.lookup(host, { family: 6 }, (err, addr) => err ? reject(err) : resolve(addr));
    });
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const sock = net.connect({ host: address, port: PROBE_PORT, family: 6 });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, PROBE_TIMEOUT_MS);
    sock.once('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.once('error',   () => { clearTimeout(timer); resolve(false); });
  });
}

export async function applyNetworkPreflight(): Promise<void> {
  if (process.env.MIXARR_SKIP_NETWORK_PREFLIGHT === '1') return;

  const host = process.env.IPV6_PROBE_HOST || 'musicbrainz.org';
  const v6Works = await ipv6EgressWorks(host);
  if (v6Works) return;

  logger.warn(`IPv6 egress to ${host} unavailable — preferring IPv4 for outbound fetches`);
  dns.setDefaultResultOrder('ipv4first');
  net.setDefaultAutoSelectFamily(false);
}
