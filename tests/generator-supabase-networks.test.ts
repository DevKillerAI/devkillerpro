import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planSupabasePilotSubnets, supabasePilotHostExclusions, supabasePilotLinuxHostExclusions, assertSupabasePilotNetwork, isSupabasePilotSubnetCollision } from '../src/lib/server/generator/supabasePilotNetworks';

test('Linux inventory reserves policy routes, interface subnets and individual hosts', () => {
  const excluded = supabasePilotLinuxHostExclusions([
    { dst: 'default', gateway: '192.0.2.1' },
    { dst: '10.240.0.0/24', table: 100 },
    { dst: '10.240.1.2', type: 'local' },
  ], [{ addr_info: [{ family: 'inet', local: '10.240.2.1', prefixlen: 24 }] }]);
  assert.deepEqual(excluded, ['10.240.0.0/24', '10.240.1.2/32', '10.240.2.1/24']);
  assert.deepEqual(planSupabasePilotSubnets(excluded, 1), ['10.240.1.16/28']);
});

test('Linux network inventory rejects missing, malformed and oversized evidence', () => {
  const addresses = [{ addr_info: [{ family: 'inet', local: '192.0.2.2', prefixlen: 24 }] }];
  for (const routes of [null, {}, [], [{}], [{ dst: 'invalid' }], Array(8193).fill({ dst: 'default' })])
    assert.throws(() => supabasePilotLinuxHostExclusions(routes, addresses));
  for (const interfaces of [null, [], [{}], [{ addr_info: [] }], [{ addr_info: [{ family: 'inet', local: '1.2.3.4', prefixlen: -1 }] }]])
    assert.throws(() => supabasePilotLinuxHostExclusions([{ dst: 'default' }], interfaces));
});

test('pilot subnet allocation is bounded, deterministic, small and disjoint', () => {
  const selected = planSupabasePilotSubnets(['172.17.0.0/16', '192.168.0.0/16'], 6);
  assert.deepEqual(selected, ['10.240.0.0/28', '10.240.0.16/28', '10.240.0.32/28', '10.240.0.48/28', '10.240.0.64/28', '10.240.0.80/28']);
  assert.deepEqual(selected, planSupabasePilotSubnets(['192.168.0.0/16', '172.17.0.0/16'], 6));
  assert.deepEqual(planSupabasePilotSubnets(selected, 2), ['10.240.0.96/28', '10.240.0.112/28']);
});

test('all containing, contained and unaligned host CIDRs exclude the corresponding subnet', () => {
  assert.deepEqual(planSupabasePilotSubnets(['10.240.0.15/32'], 1), ['10.240.0.16/28']);
  assert.deepEqual(planSupabasePilotSubnets(['10.240.0.16/28'], 1), ['10.240.0.0/28']);
  assert.deepEqual(planSupabasePilotSubnets(['10.240.0.153/24'], 1), ['10.240.1.0/28']);
  for (const blocked of ['10.0.0.0/8', '10.240.0.0/16', '0.0.0.0/0', '0.0.0.0/1']) assert.throws(() => planSupabasePilotSubnets([blocked]), /No sufficient/);
  assert.throws(() => planSupabasePilotSubnets(['10.240.0.0/17', '10.240.128.0/17']), /No sufficient/);
});

test('only actual default routes are ignored, never Docker pools or interface networks', () => {
  const filtered = supabasePilotHostExclusions(['0.0.0.0/0', '0.0.0.0/1', '128.0.0.0/1', '10.0.0.0/8'], ['192.168.1.153/24']);
  assert.deepEqual(filtered, ['10.0.0.0/8', '192.168.1.153/24']);
  assert.throws(() => planSupabasePilotSubnets(filtered), /No sufficient/);
  assert.deepEqual(supabasePilotHostExclusions(['0.0.0.0/0'], ['0.0.0.0/1']), ['0.0.0.0/1']);
});

test('invalid or oversized allocation inventory fails closed', () => {
  for (const cidr of ['10.256.0.0/16', '10.1.2.3/33', '10.1.2.3/-1', '10.1.2.3', '', 'garbage', '10.240.0.0/16 extra']) assert.throws(() => planSupabasePilotSubnets([cidr]), /invalid/);
  for (const count of [0, -1, 13, 1.5, NaN, Infinity]) assert.throws(() => planSupabasePilotSubnets([], count), /bound/);
  assert.throws(() => planSupabasePilotSubnets(Array(16385).fill('192.168.0.0/16')), /bound/);
  assert.throws(() => supabasePilotHostExclusions(['bad'], []), /invalid/);
});

test('network attestation preserves legacy ranges but rejects cross-scope, exposure and changed new IPAM', () => {
  const scopeHash = 'a'.repeat(64), name = 'dk-v2-' + scopeHash.slice(0, 32);
  const legacy = { Id: 'b'.repeat(64), Name: name, Driver: 'bridge', Internal: true, EnableIPv6: false,
    Labels: { 'devkiller.generator-v2.scope': scopeHash }, Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' },
    IPAM: { Driver: 'default', Config: [{ Subnet: '172.30.0.0/16', Gateway: '172.30.0.1' }] } };
  assert.doesNotThrow(() => assertSupabasePilotNetwork(legacy, scopeHash, 'runner'));
  for (const changed of [{ Name: 'devkiller-local' }, { Internal: false }, { EnableIPv6: true }, { Driver: 'host' }, { Labels: {} }, { Options: {} }])
    assert.throws(() => assertSupabasePilotNetwork({ ...legacy, ...changed }, scopeHash, 'runner'), /binding mismatch/);
  const explicit = { ...legacy, Labels: { ...legacy.Labels, 'devkiller.generator-v2.network-policy': 'explicit-small-v1', 'devkiller.generator-v2.subnet': '10.240.0.0/28' },
    IPAM: { Driver: 'default', Config: [{ Subnet: '10.240.0.0/28', Gateway: '10.240.0.1' }] } };
  assert.doesNotThrow(() => assertSupabasePilotNetwork(explicit, scopeHash, 'runner'));
  assert.throws(() => assertSupabasePilotNetwork({ ...explicit, IPAM: legacy.IPAM }, scopeHash, 'runner'), /subnet attestation/);
  assert.throws(() => assertSupabasePilotNetwork(explicit, 'c'.repeat(64), 'runner'), /binding/);
  assert.throws(() => assertSupabasePilotNetwork(explicit, scopeHash, 'services'), /binding/);
});

test('only confirmed Docker overlap rejection may retry, never abort, timeout or other errors', () => {
  const overlap = { code: 1, stderr: 'Error response from daemon: invalid pool request: Pool overlaps with other one on this address space' };
  assert.equal(isSupabasePilotSubnetCollision(overlap), true);
  for (const error of [null, undefined, new Error('timeout'), { ...overlap, code: 'ETIMEDOUT' }, { ...overlap, killed: true }, { ...overlap, signal: 'SIGTERM' },
    { code: 1, stderr: 'permission denied' }, { code: 1, stderr: 'all predefined address pools have been fully subnetted' }, { code: 1, stderr: 'network name already exists' }])
    assert.equal(isSupabasePilotSubnetCollision(error), false);
});

test('pre-call guard uses subnet capacity, creation is explicit and no cleanup/global changes exist', () => {
  const environment = readFileSync('src/lib/server/generator/supabasePilotEnvironment.ts', 'utf8');
  const allocator = readFileSync('src/lib/server/generator/supabasePilotNetworks.ts', 'utf8');
  assert.match(environment.slice(environment.indexOf('export async function inspectSupabasePilotPrerequisites'), environment.indexOf('const bindingSchema')), /await inspectSupabasePilotNetworkCapacity\(signal\)/);
  assert.match(allocator, /planSupabasePilotSubnets\(current.exclusions, 6\)/);
  assert.match(allocator, /attempt < 4/);
  assert.match(allocator, /'--subnet', subnet, '--gateway', gateway/);
  assert.doesNotMatch(allocator, /\['network', '(?:rm|prune)'\]|daemon\.json|default-address-pools/);
});
