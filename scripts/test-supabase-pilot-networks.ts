import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureSupabasePilotNetwork, inspectSupabasePilotNetworkCapacity } from '../src/lib/server/generator/supabasePilotNetworks';
import { supabasePilotScopeHash } from '../src/lib/server/generator/supabasePilotEnvironment';

const exec = promisify(execFile);
const docker = async (args: string[]) => (await exec('docker', args, { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
async function inventory() {
  const ids = (await docker(['network', 'ls', '-q'])).split(/\r?\n/);
  const all: any[] = [];
  for (let index = 0; index < ids.length; index += 32) all.push(...JSON.parse(await docker(['network', 'inspect', ...ids.slice(index, index + 32)])));
  return all.map(item => ({ Id: item.Id, Name: item.Name, Internal: item.Internal, IPAM: item.IPAM, Labels: item.Labels, Options: item.Options }));
}

async function main() {
  if (!process.argv.includes('--apply-qa')) throw new Error('Pass --apply-qa to create three empty QA networks. No services, database, run or provider operations occur.');
  const before = await inventory(), capacity = await inspectSupabasePilotNetworkCapacity();
  const identity = { ownerId: 'v2-infrastructure-qa', projectId: 'small-network-allocation', missionId: `qa-${randomUUID()}`, environmentId: 'network-only' };
  const scopeHash = supabasePilotScopeHash(identity), kinds = ['runner', 'preview', 'services'] as const;
  const names = kinds.map(kind => `dk-v2-${scopeHash.slice(0, 32)}${kind === 'runner' ? '' : '-' + kind}`);
  assert(!before.some(item => names.includes(item.Name)));
  // Parallel distinct names exercise the cross-create IPAM collision path. The
  // production environment creator additionally holds its per-identity file lock.
  await Promise.all(kinds.map(kind => ensureSupabasePilotNetwork(scopeHash, kind)));
  for (const kind of kinds) await ensureSupabasePilotNetwork(scopeHash, kind); // Idempotent attestation, not recreation.
  const after = await inventory(), created = after.filter(item => names.includes(item.Name));
  assert.equal(created.length, 3);
  assert.equal(new Set(created.map(item => item.IPAM.Config[0].Subnet)).size, 3);
  for (const old of before) assert.deepEqual(after.find(item => item.Id === old.Id), old, `Existing network changed: ${old.Name}`);
  for (const item of created) {
    assert.equal(item.Internal, item.Name === names[0]);
    assert.equal(item.Options['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
    assert.equal(item.Labels['devkiller.generator-v2.scope'], scopeHash);
    assert.match(item.IPAM.Config[0].Subnet, /^10\.240\.\d+\.\d+\/28$/);
  }
  console.log(JSON.stringify({ qaOnly: true, priorNetworksUnchanged: before.length, idempotent: true, capacity,
    created: created.map(item => ({ name: item.Name, internal: item.Internal, subnet: item.IPAM.Config[0].Subnet, loopbackDefault: item.Options['com.docker.network.bridge.host_binding_ipv4'] })),
    retainedEmptyQaNetworks: true, servicesStarted: 0, databaseWrites: 0, providerCalls: 0 }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'QA network probe failed.'); process.exitCode = 1; });
