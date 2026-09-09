import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const exec = promisify(execFile);
const SCOPE_LABEL = 'devkiller.generator-v2.scope';
const SUBNET_LABEL = 'devkiller.generator-v2.subnet';
const POLICY_LABEL = 'devkiller.generator-v2.network-policy';
const POLICY = 'explicit-small-v1';
const POOL = '10.240.0.0/16';
const PREFIX = 28; // Fourteen host addresses; the fixed service stack needs at most six.
const MAX_NETWORKS = 1024;
type Range = { start: number; end: number; prefix: number };
type Network = { Id: string; Name: string; Driver: string; Internal: boolean; EnableIPv6?: boolean; Labels?: Record<string, string>; Options?: Record<string, string>; IPAM?: { Driver?: string; Config?: { Subnet?: string; Gateway?: string }[] } };
export type SupabasePilotNetworkKind = 'runner' | 'preview' | 'services';

export class SupabasePilotNetworkUnavailableError extends Error {
  readonly name = 'SupabasePilotNetworkUnavailableError';
}
const unavailable = (message: string): never => { throw new SupabasePilotNetworkUnavailableError(message); };

function range(cidr: string): Range {
  if (typeof cidr !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(cidr)) return unavailable('The local IPv4 network inventory is invalid.');
  const [address, bits] = cidr.split('/'), prefix = Number(bits), octets = address.split('.').map(Number);
  if (prefix > 32 || octets.some(octet => octet > 255)) return unavailable('The local IPv4 network inventory is invalid.');
  const value = octets.reduce((total, octet) => total * 256 + octet, 0), size = 2 ** (32 - prefix);
  const start = Math.floor(value / size) * size;
  return { start, end: start + size - 1, prefix };
}
const address = (value: number) => [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');
const overlaps = (left: Range, right: Range) => left.start <= right.end && right.start <= left.end;

/** Defaults (including VPN's two /1 defaults) route the internet, not an attached LAN. */
export function supabasePilotHostExclusions(routes: readonly string[], interfaces: readonly string[]): string[] {
  const specific = routes.filter(cidr => {
    range(cidr);
    return !['0.0.0.0/0', '0.0.0.0/1', '128.0.0.0/1'].includes(cidr);
  });
  for (const cidr of interfaces) range(cidr);
  return [...new Set([...specific, ...interfaces])];
}

/** iproute2 JSON inventory, including policy-routing tables and host addresses. */
export function supabasePilotLinuxHostExclusions(routes: unknown, interfaces: unknown): string[] {
  if (!Array.isArray(routes) || !routes.length || !Array.isArray(interfaces) || !interfaces.length || routes.length + interfaces.length > 8192)
    return unavailable('The Linux host route inventory is unavailable or exceeds its bound.');
  const routeCidrs = routes.map(entry => {
    if (!entry || typeof entry.dst !== 'string') return unavailable('The Linux host route inventory is invalid.');
    return entry.dst === 'default' ? '0.0.0.0/0' : entry.dst.includes('/') ? entry.dst : `${entry.dst}/32`;
  });
  const addressCidrs: string[] = [];
  for (const entry of interfaces) {
    if (!entry || !Array.isArray(entry.addr_info)) return unavailable('The Linux interface inventory is invalid.');
    for (const item of entry.addr_info) {
      if (!item || item.family !== 'inet' || typeof item.local !== 'string' || !Number.isInteger(item.prefixlen) || item.prefixlen < 0 || item.prefixlen > 32)
        return unavailable('The Linux interface address is invalid.');
      addressCidrs.push(`${item.local}/${item.prefixlen}`);
      if (routeCidrs.length + addressCidrs.length > 8192) return unavailable('The Linux host route inventory exceeds its bound.');
    }
  }
  if (!addressCidrs.length) return unavailable('The Linux interface inventory is empty.');
  return supabasePilotHostExclusions(routeCidrs, addressCidrs);
}

/** No fallback to public, link-local, VPN, LAN, or Docker-default address space. */
export function planSupabasePilotSubnets(exclusions: readonly string[], count = 6): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 12 || exclusions.length > 16384) return unavailable('The pilot network allocation request exceeds its bound.');
  const occupied = exclusions.map(range), pool = range(POOL), selected: string[] = [], size = 2 ** (32 - PREFIX);
  for (let start = pool.start; start <= pool.end && selected.length < count; start += size) {
    const candidate = { start, end: start + size - 1, prefix: PREFIX };
    if (!occupied.some(other => overlaps(candidate, other))) selected.push(`${address(start)}/${PREFIX}`);
  }
  if (selected.length < count) return unavailable('No sufficient non-conflicting small subnets remain for the isolated pilot. No generation is authorized.');
  return selected;
}

async function docker(args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return (await exec('docker', args, { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, signal })).stdout.trim();
}

async function assertLocalDocker(signal?: AbortSignal): Promise<void> {
  const contextEndpoint = await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], signal);
  for (const endpoint of [contextEndpoint, ...(process.env.DOCKER_HOST ? [process.env.DOCKER_HOST] : [])]) {
    if (!/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint) && !/^unix:\/\/\/[A-Za-z0-9_./-]+$/.test(endpoint))
      unavailable('Pilot network allocation requires a local Docker pipe or Unix socket.');
  }
}

async function inspectNetworks(signal?: AbortSignal): Promise<Network[]> {
  await assertLocalDocker(signal);
  const listed = await docker(['network', 'ls', '--format', '{{.ID}}'], signal), ids = listed ? listed.split(/\r?\n/) : [];
  if (!ids.length || ids.length > MAX_NETWORKS || ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) return unavailable('The Docker network inventory is unavailable or exceeds its bound.');
  const result: Network[] = [];
  for (let index = 0; index < ids.length; index += 32) {
    const batch = JSON.parse(await docker(['network', 'inspect', ...ids.slice(index, index + 32)], signal));
    if (!Array.isArray(batch)) return unavailable('The Docker network inventory is invalid.');
    result.push(...batch);
  }
  return result;
}

async function inspectHostExclusions(signal?: AbortSignal): Promise<string[]> {
  if (process.platform === 'linux') {
    const options = { timeout: 15000, maxBuffer: 512 * 1024, signal };
    const [routes, interfaces] = await Promise.all([
      exec('ip', ['-j', '-4', 'route', 'show', 'table', 'all'], options),
      exec('ip', ['-j', '-4', 'address', 'show'], options),
    ]);
    return supabasePilotLinuxHostExclusions(JSON.parse(routes.stdout), JSON.parse(interfaces.stdout));
  }
  if (process.platform !== 'win32') return unavailable('Pilot subnet allocation requires the reviewed Windows host-route inspector.');
  // Fixed read-only command. Never interpolate generated identifiers or credentials.
  const command = "$ErrorActionPreference='Stop'; $pilotRoutes=@(Get-NetRoute -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty DestinationPrefix); $pilotAddresses=@(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | ForEach-Object { $_.IPAddress + '/' + $_.PrefixLength }); ConvertTo-Json -Compress -InputObject @{routes=$pilotRoutes;interfaces=$pilotAddresses}";
  const output = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000, maxBuffer: 512 * 1024, signal });
  const value = JSON.parse(output.stdout);
  if (!Array.isArray(value.routes) || !value.routes.length || !Array.isArray(value.interfaces) || !value.interfaces.length || value.routes.length + value.interfaces.length > 8192)
    return unavailable('The local host/VPN route inventory is unavailable.');
  return supabasePilotHostExclusions(value.routes, value.interfaces);
}

async function inspectDesktopExclusions(): Promise<string[]> {
  // Native Linux Docker has no hidden Docker Desktop VM; its networks and
  // all host routing tables are inspected separately before allocation.
  if (process.platform === 'linux') return [];
  if (!process.env.APPDATA) return unavailable('Docker Desktop network settings are unavailable.');
  let contents: string;
  try { contents = await readFile(path.join(process.env.APPDATA, 'Docker', 'settings-store.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    contents = await readFile(path.join(process.env.APPDATA, 'Docker', 'settings.json'), 'utf8');
  }
  if (Buffer.byteLength(contents) > 512 * 1024) return unavailable('Docker Desktop settings exceed their inspection bound.');
  const settings = JSON.parse(contents);
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') return unavailable('Docker Desktop network settings are invalid.');
  // Desktop's internal services are not listed as Docker bridge networks. The
  // reviewed default remains excluded even when a configured override is present.
  const cidrs = ['192.168.65.0/24'];
  for (const [key, value] of Object.entries(settings)) if (key.toLowerCase() === 'vpnkitcidr') {
    if (typeof value !== 'string') return unavailable('Docker Desktop private subnet is invalid.');
    range(value); cidrs.push(value);
  }
  return cidrs;
}

function dockerExclusions(networks: Network[]): string[] {
  return networks.flatMap(network => {
    if (!network || typeof network.Name !== 'string' || !/^[a-f0-9]{64}$/.test(network.Id)) return unavailable('The Docker network inventory is invalid.');
    const config = network.IPAM?.Config ?? [];
    if (!Array.isArray(config) || (network.Driver === 'bridge' && !config.length)) return unavailable('A Docker bridge has no inspectable IP allocation.');
    return config.flatMap(item => {
      if (typeof item.Subnet !== 'string') return unavailable('A Docker network has an uninspectable IP allocation.');
      if (net.isIP(item.Subnet.split('/')[0]) === 6) return [];
      range(item.Subnet); return [item.Subnet];
    });
  });
}

async function inventory(signal?: AbortSignal) {
  try {
    const [networks, host, desktop] = await Promise.all([inspectNetworks(signal), inspectHostExclusions(signal), inspectDesktopExclusions()]);
    return { networks, exclusions: [...host, ...desktop, ...dockerExclusions(networks)] };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof SupabasePilotNetworkUnavailableError) throw error;
    return unavailable('The local Docker/host network inventory could not be verified. No generation is authorized.');
  }
}

/** Read-only pre-call guard: two deployments each require runner, preview and service networks. */
export async function inspectSupabasePilotNetworkCapacity(signal?: AbortSignal): Promise<{ available: true; availableSubnets: number; subnetPrefix: 28 }> {
  const current = await inventory(signal);
  const planned = planSupabasePilotSubnets(current.exclusions, 6);
  return { available: true, availableSubnets: planned.length, subnetPrefix: PREFIX };
}

function networkName(scopeHash: string, kind: SupabasePilotNetworkKind): string {
  if (!/^[a-f0-9]{64}$/.test(scopeHash) || !['runner', 'preview', 'services'].includes(kind)) return unavailable('Invalid dedicated pilot network identity.');
  return `dk-v2-${scopeHash.slice(0, 32)}${kind === 'runner' ? '' : `-${kind}`}`;
}

/** Existing networks retain their original IPAM; only new policy-labelled networks use /28. */
export function assertSupabasePilotNetwork(network: Network, scopeHash: string, kind: SupabasePilotNetworkKind): void {
  const expected = networkName(scopeHash, kind);
  if (network.Name !== expected || network.Driver !== 'bridge' || network.Internal !== (kind === 'runner') || network.EnableIPv6 ||
    network.Labels?.[SCOPE_LABEL] !== scopeHash || network.Options?.['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1')
    unavailable('Dedicated pilot network binding mismatch.');
  if (network.Labels?.[POLICY_LABEL] || network.Labels?.[SUBNET_LABEL]) {
    const subnet = network.Labels?.[SUBNET_LABEL] ?? '', parsed = range(subnet), pool = range(POOL);
    if (network.Labels?.[POLICY_LABEL] !== POLICY || parsed.prefix !== PREFIX || parsed.start < pool.start || parsed.end > pool.end ||
      subnet !== `${address(parsed.start)}/${PREFIX}` || network.IPAM?.Driver !== 'default' || network.IPAM.Config?.length !== 1 ||
      network.IPAM.Config[0].Subnet !== subnet || network.IPAM.Config[0].Gateway !== address(parsed.start + 1))
      unavailable('Dedicated pilot subnet attestation mismatch.');
  }
}

/** Docker IPAM atomically rejects overlap; retry only that confirmed no-create collision. */
export function isSupabasePilotSubnetCollision(error: unknown): boolean {
  const result = error as { code?: unknown; killed?: unknown; signal?: unknown; stderr?: unknown };
  return result?.code === 1 && !result.killed && !result.signal && typeof result.stderr === 'string' &&
    /Pool overlaps with other one on this address space/i.test(result.stderr);
}

export async function ensureSupabasePilotNetwork(scopeHash: string, kind: SupabasePilotNetworkKind, signal?: AbortSignal): Promise<void> {
  const name = networkName(scopeHash, kind);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await inventory(signal), matches = current.networks.filter(item => item.Name === name);
    if (matches.length > 1) return unavailable('Duplicate dedicated network names require operator inspection.');
    if (matches[0]) { assertSupabasePilotNetwork(matches[0], scopeHash, kind); return; }
    const [subnet] = planSupabasePilotSubnets(current.exclusions, 1), gateway = address(range(subnet).start + 1);
    try {
      await docker(['network', 'create', '--driver', 'bridge', '--subnet', subnet, '--gateway', gateway,
        ...(kind === 'runner' ? ['--internal'] : []), '--label', `${SCOPE_LABEL}=${scopeHash}`,
        '--label', `${POLICY_LABEL}=${POLICY}`, '--label', `${SUBNET_LABEL}=${subnet}`,
        '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', name], signal);
      const created = JSON.parse(await docker(['network', 'inspect', name], signal))[0];
      assertSupabasePilotNetwork(created, scopeHash, kind);
      return;
    } catch (error) {
      signal?.throwIfAborted();
      // A timeout/unknown outcome is never retried or cleaned up. The next explicit
      // ensure can attest the exact owned network if Docker finished creating it.
      if (!isSupabasePilotSubnetCollision(error)) throw error;
    }
  }
  unavailable('Concurrent Docker allocations exhausted the bounded pilot subnet retry. No existing network was changed.');
}
