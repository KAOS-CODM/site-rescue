// fetchPage — SSRF-safe page fetch with manual redirects, TTFB, and probes.
// Spec ref: spec.md > POST /api/scan (SSRF protection), spec.md > Scanner > fetchPage.
//
// Every destination — original URL and every redirect hop — is validated
// BEFORE any socket is opened, and the socket is pinned to the IP that was
// validated (custom DNS lookup), so a public URL can never be redirected or
// rebound into an internal/private destination.

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { REQUEST_TIMEOUT_MS } from '../checkConfig.js';

const MAX_REDIRECTS = 5; // derived: loop guard (spec does not prescribe a limit)

const USER_AGENT = 'SiteRescue/0.1 (+local proof-of-concept scanner)';

/** Errors that map to the API contract's error codes. */
export class ScanError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // 'invalid_url' | 'unreachable'
  }
}

/** Non-public IPv4/IPv6 ranges to reject (spec > POST /api/scan). */
const BLOCKED_V4_CIDRS = [
  '0.0.0.0/8', // "this network"
  '10.0.0.0/8', // RFC1918
  '100.64.0.0/10', // CGNAT (shared address space)
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local
  '172.16.0.0/12', // RFC1918
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // documentation
  '192.88.99.0/24', // 6to4 relay anycast (deprecated)
  '192.168.0.0/16', // RFC1918
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // documentation
  '203.0.113.0/24', // documentation
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved + broadcast (255.255.255.255 included)
];

function cidrToRange(cidr) {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const baseNum = base.split('.').reduce((acc, o) => (acc << 8) >>> 0 | Number(o), 0) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const start = (baseNum & mask) >>> 0;
  return [start, (start | ~mask) >>> 0];
}

const V4_RANGES = BLOCKED_V4_CIDRS.map(cidrToRange);

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isPublicIpv4(ip) {
  const n = ipv4ToInt(ip);
  return !V4_RANGES.some(([start, end]) => n >= start && n <= end);
}

/** True when an address is safe to connect to (public, routable). */
export function isPublicIp(address) {
  if (net.isIPv4(address)) return isPublicIpv4(address);

  if (net.isIPv6(address)) {
    const addr = address.toLowerCase().split('%')[0]; // strip zone id

    // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) → judge as IPv4.
    const mappedV4 = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) || addr.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedV4) return isPublicIpv4(mappedV4[1]);

    if (addr === '::' || addr === '::1') return false; // unspecified / loopback
    if (/^f[cd]/.test(addr)) return false; // ULA fc00::/7
    if (/^fe[89ab]/.test(addr)) return false; // link-local fe80::/10
    if (/^ff/.test(addr)) return false; // multicast ff00::/8
    if (/^2001:db8:/.test(addr)) return false; // documentation
    return true;
  }

  return false; // unknown family → reject
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost') return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  return false;
}

/**
 * Validate + resolve a target URL. Throws ScanError('invalid_url') for
 * scheme/private/non-public destinations and ScanError('unreachable') when
 * the hostname cannot be resolved. No request is ever attempted on rejection.
 * Returns the normalized URL plus the validated (pinned) destination address.
 */
export async function validateTarget(rawInput) {
  if (typeof rawInput !== 'string' || !rawInput.trim()) {
    throw new ScanError('A URL is required.', 'invalid_url');
  }

  let candidate = rawInput.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new ScanError('That is not a valid URL.', 'invalid_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScanError('Only http:// and https:// URLs can be scanned.', 'invalid_url');
  }

  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (!host) throw new ScanError('The URL has no hostname.', 'invalid_url');
  if (isBlockedHostname(host)) {
    throw new ScanError('That destination is not a public website.', 'invalid_url');
  }

  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      addresses = await dns.lookup(host, { all: true });
    } catch {
      throw new ScanError(`Could not resolve the host "${host}".`, 'unreachable');
    }
    if (!addresses.length) {
      throw new ScanError(`Could not resolve the host "${host}".`, 'unreachable');
    }
  }

  // Reject if ANY resolved address is non-public (spec rule, verbatim).
  const nonPublic = addresses.find((a) => !isPublicIp(a.address));
  if (nonPublic) {
    throw new ScanError('That destination resolves to a non-public address.', 'invalid_url');
  }

  return {
    url,
    hostname: host,
    pinnedIp: addresses[0].address,
    family: addresses[0].family,
  };
}

/** DNS lookup function pinned to a pre-validated IP — the connection can
 *  only go to the destination we validated. */
function pinnedLookup(pinnedIp, family) {
  return (_hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : options;
    if (opts && opts.all) cb(null, [{ address: pinnedIp, family }]);
    else cb(null, pinnedIp, family);
  };
}

function requestOnce(target, timeoutMs) {
  return new Promise((resolve, reject) => {
    const isHttps = target.url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const started = Date.now();
    let ttfbMs = null;

    const req = lib.get(
      target.url,
      {
        lookup: pinnedLookup(target.pinnedIp, target.family),
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,*/*' },
      },
      (res) => {
        ttfbMs = Date.now() - started; // time until response headers received

        // Manual redirect handling: never auto-follow; revalidate each hop.
        const { statusCode = 0, headers } = res;
        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
          res.resume(); // discard body
          clearTimeout(timer);
          resolve({ redirect: headers.location, statusCode });
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timer);
          resolve({
            statusCode,
            headers,
            body: Buffer.concat(chunks).toString('utf8'),
            ttfbMs,
          });
        });
        res.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      },
    );

    // 10s timeout covering headers AND body (spec: 10s request timeout).
    const timer = setTimeout(() => {
      req.destroy(new ScanError('The request timed out after 10 seconds.', 'unreachable'));
    }, timeoutMs);

    req.on('error', (err) => {
      clearTimeout(timer);
      if (err instanceof ScanError) reject(err);
      else reject(new ScanError('Could not connect to the website.', 'unreachable'));
    });
  });
}

/**
 * Fetch a URL under full SSRF rules: validate → connect pinned → follow up to
 * MAX_REDIRECTS redirects with the same validation on every hop.
 * Returns { finalUrl, status, headers, body, ttfbMs, redirectChain }.
 */
export async function fetchSafe(target, timeoutMs = REQUEST_TIMEOUT_MS) {
  const redirectChain = [];
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await requestOnce(current, timeoutMs);

    if (result.redirect !== undefined) {
      if (hop === MAX_REDIRECTS) {
        throw new ScanError('Too many redirects.', 'unreachable');
      }
      let nextUrl;
      try {
        nextUrl = new URL(result.redirect, current.url);
      } catch {
        throw new ScanError('The website sent an invalid redirect.', 'unreachable');
      }
      // Revalidate EVERY redirect destination (scheme + resolve + non-public).
      const nextTarget = await validateTarget(nextUrl.href);
      redirectChain.push({ from: current.url.href, to: nextTarget.url.href });
      current = nextTarget;
      continue;
    }

    return {
      finalUrl: current.url.href,
      status: result.statusCode,
      headers: result.headers,
      body: result.body,
      ttfbMs: result.ttfbMs,
      redirectChain,
    };
  }

  throw new ScanError('Too many redirects.', 'unreachable');
}

/**
 * Probe a path on an already-validated origin (robots.txt / favicon.ico).
 * Never throws: a probe that cannot run comes back { checked: false } so the
 * check becomes "unavailable", NEVER a fabricated pass or finding.
 */
export async function probePath(originUrl, path) {
  try {
    const target = await validateTarget(new URL(path, originUrl).href);
    const res = await fetchSafe(target);
    return { checked: true, status: res.status, ok: res.status > 0 && res.status < 400, body: res.body };
  } catch (err) {
    return { checked: false, reason: err.message || 'probe failed' };
  }
}
