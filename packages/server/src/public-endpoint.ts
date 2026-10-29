import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ResolveHost = (hostname: string) => Promise<string[]>;

export const resolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((found) => found.address);

export class NonPublicEndpointError extends Error {
  override name = 'NonPublicEndpointError';
}

// Loopback, private, link-local (cloud metadata included), shared, documentation, multicast and reserved ranges:
// anything a request from the server could reach that the public internet cannot. IPv4-mapped IPv6 addresses are
// checked against the IPv4 ranges.
const nonPublic = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  nonPublic.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  nonPublic.addSubnet(network, prefix, 'ipv6');
}

export async function checkPublicEndpoint(url: URL, resolve: ResolveHost = resolveHost) {
  if (url.protocol !== 'https:') throw new NonPublicEndpointError(`${url.origin} is not https`);
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
  const blocked = addresses.find((address) => nonPublic.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4'));
  if (blocked) throw new NonPublicEndpointError(`${hostname} resolves to ${blocked}, which is not a public address`);
}

// Checks each request's host before sending it, and refuses redirects, which would reach a host never checked;
// provider APIs answer their requests directly.
export function publicOnly(fetch: Fetch, resolve: ResolveHost = resolveHost): Fetch {
  return async (url, init) => {
    await checkPublicEndpoint(new URL(url instanceof Request ? url.url : url), resolve);
    return fetch(url, { ...init, redirect: 'error' });
  };
}
