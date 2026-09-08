import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import net from 'node:net';

const exec = promisify(execFile);
type Boundary = { stackId: string; network: string; directory: string; apiPort: number; dbPort: number };

/** CLI 2.116 leaves HostIp empty; Docker Desktop ignores bridge defaults. Fix only owned creates. */
export function rewriteSupabasePilotCreate(boundary: Boundary, name: string, body: Record<string, any>): Record<string, any> {
  const allowed = ['db', 'auth', 'rest', 'kong'].map(service => `supabase_${service}_${boundary.stackId}`);
  const authInit = !name && body.Image === 'public.ecr.aws/supabase/gotrue:v2.196.0' && JSON.stringify(body.Cmd) === '["gotrue","migrate"]' && !body.Entrypoint?.length;
  if ((!allowed.includes(name) && !authInit) || body.Labels?.['com.supabase.cli.project'] !== boundary.stackId ||
    (!authInit && path.resolve(body.Labels?.['com.supabase.cli.workdir'] ?? '') !== boundary.directory) || body.HostConfig?.NetworkMode !== boundary.network) throw new Error('CLI container create escaped its dedicated pilot boundary.');
  if (authInit) {
    const databaseUrl = (body.Env ?? []).find((value: string) => value.startsWith('GOTRUE_DB_DATABASE_URL='));
    if (!databaseUrl || new URL(databaseUrl.slice('GOTRUE_DB_DATABASE_URL='.length)).hostname !== `supabase_db_${boundary.stackId}`) throw new Error('Auth initialization escaped its dedicated database.');
    body.Labels['com.supabase.cli.workdir'] = boundary.directory;
  }
  const ports = body.HostConfig.PortBindings ?? {};
  for (const [containerPort, mappings] of Object.entries(ports) as [string, any[]][]) {
    const expected = name === `supabase_db_${boundary.stackId}` && containerPort === '5432/tcp' ? boundary.dbPort : name === `supabase_kong_${boundary.stackId}` && containerPort === '8000/tcp' ? boundary.apiPort : null;
    if (!expected || !Array.isArray(mappings) || mappings.length !== 1 || mappings[0].HostPort !== String(expected)) throw new Error('CLI published an unexpected pilot port.');
    mappings[0].HostIp = '127.0.0.1';
  }
  if (body.HostConfig.Privileged || body.HostConfig.PidMode === 'host' || body.HostConfig.NetworkMode === 'host') throw new Error('Privileged pilot container create rejected.');
  if ((body.HostConfig.CapAdd?.length ?? 0) || (body.HostConfig.Devices?.length ?? 0) || (body.HostConfig.Mounts?.length ?? 0) ||
    (body.HostConfig.VolumesFrom?.length ?? 0) || body.HostConfig.PidMode || body.HostConfig.IpcMode === 'host' ||
    (body.HostConfig.Binds ?? []).some((bind: string) => bind !== `supabase_db_${boundary.stackId}:/var/lib/postgresql/data`)) throw new Error('Unexpected pilot host mount or capability.');
  return body;
}

/** A short-lived private-pipe adapter for the trusted pinned CLI, never a TCP/browser/model API. */
export async function withSupabasePilotDockerProxy<T>(boundary: Boundary, operation: (dockerHost: string) => Promise<T>): Promise<T> {
  let rejection = '';
  let attachState = 'not requested';
  let attachHandshake: Record<string, unknown> = {};
  const endpoint = (await exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { windowsHide: true, timeout: 15000 })).stdout.trim();
  const socketPath = endpoint.startsWith('npipe:////./pipe/') ? `\\\\.\\pipe\\${endpoint.slice('npipe:////./pipe/'.length)}` : endpoint.startsWith('unix://') ? endpoint.slice(7) : null;
  if (!socketPath) throw new Error('Pilot provisioning requires a local Docker named pipe or Unix socket; remote daemons are not allowed.');
  const names = new Set(['db', 'auth', 'rest', 'kong', 'auth_init'].map(service => `supabase_${service}_${boundary.stackId}`));
  const ids = new Set<string>();
  const networkIds = new Set<string>([boundary.network]);
  for (const name of names) {
    try {
      const info = JSON.parse((await exec('docker', ['container', 'inspect', name], { windowsHide: true, timeout: 15000 })).stdout)[0];
      if (info.Config?.Labels?.['com.supabase.cli.project'] !== boundary.stackId || path.resolve(info.Config?.Labels?.['com.supabase.cli.workdir'] ?? '') !== boundary.directory) throw new Error('Container boundary mismatch.');
      ids.add(info.Id);
    } catch (error) { if (!/No such (object|container)/i.test(String((error as { stderr?: string }).stderr))) throw error; }
  }
  const network = JSON.parse((await exec('docker', ['network', 'inspect', boundary.network], { windowsHide: true, timeout: 15000 })).stdout)[0];
  networkIds.add(network.Id);
  const volumeName = `supabase_db_${boundary.stackId}`;
  const active = new Set<http.ClientRequest>();
  const upgraded = new Set<import('node:net').Socket>();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      let endpointPath = url.pathname.replace(/^\/v[0-9]+\.[0-9]+/, '');
      const method = request.method ?? 'GET';
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; if (length > 2_000_000) throw new Error('Docker request is too large.'); chunks.push(chunk); }
      let body = Buffer.concat(chunks);
      const read = method === 'GET' || method === 'HEAD';
      let allowed = read && ['/_ping', '/version', '/info'].includes(endpointPath);
      if (read && /^\/images\/.+\/json$/.test(endpointPath)) allowed = true;
      if (read && endpointPath === '/images/json') allowed = true;
      if (read && endpointPath === '/containers/json') {
        const filters = JSON.parse(url.searchParams.get('filters') ?? '{}');
        filters.label = [`com.supabase.cli.project=${boundary.stackId}`];
        url.searchParams.set('filters', JSON.stringify(filters)); allowed = true;
      }
      const container = endpointPath.match(/^\/containers\/([^/]+)(?:\/(json|start|stop|wait|logs|kill|archive))?$/);
      if (container && (names.has(decodeURIComponent(container[1])) || ids.has(container[1]))) {
        allowed = (read && ['json', 'logs'].includes(container[2])) || (method === 'POST' && ['start', 'stop', 'wait', 'kill'].includes(container[2])) || method === 'DELETE';
        // The pinned CLI uploads its own generated configuration/secrets before first start.
        // Never permit archive downloads (which could expose keys) or writes to other containers.
        if (container[2] === 'archive' && url.searchParams.get('path') === '/' && ['HEAD', 'PUT'].includes(method)) allowed = true;
      }
      if (method === 'POST' && endpointPath === '/containers/create') {
        if (!/^application\/json/i.test(String(request.headers['content-type'] ?? ''))) throw new Error('JSON container configuration required.');
        body = Buffer.from(JSON.stringify(rewriteSupabasePilotCreate(boundary, url.searchParams.get('name') ?? '', JSON.parse(body.toString())))); allowed = true;
        if (!url.searchParams.get('name')) url.searchParams.set('name', `supabase_auth_init_${boundary.stackId}`);
      }
      const networkPath = endpointPath.match(/^\/networks\/([^/]+)(?:\/(connect|disconnect))?$/);
      if (networkPath && networkIds.has(decodeURIComponent(networkPath[1]))) {
        allowed = read && !networkPath[2];
        if (method === 'POST' && networkPath[2] === 'connect') { const value = JSON.parse(body.toString()); allowed = names.has(value.Container) || ids.has(value.Container); }
      }
      if (read && endpointPath === `/volumes/${volumeName}`) allowed = true;
      if (read && endpointPath === '/volumes') { url.searchParams.set('filters', JSON.stringify({ name: [volumeName] })); allowed = true; }
      if (method === 'POST' && endpointPath === '/volumes/create') {
        const value = JSON.parse(body.toString());
        allowed = value.Name === volumeName && (!value.Driver || value.Driver === 'local') && !Object.keys(value.DriverOpts ?? {}).length &&
          Object.entries(value.Labels ?? {}).every(([key, value]) => (key === 'com.supabase.cli.project' || key === 'com.docker.compose.project') ? value === boundary.stackId : key === 'com.supabase.cli.workdir' && path.resolve(String(value)) === boundary.directory);
      }
      // No image pulls, exec, build, archive downloads, arbitrary networks, volume deletion, or global pruning.
      if (!allowed) { rejection = `${method} ${endpointPath}`; response.writeHead(403, { 'content-type': 'application/json' }); response.end(JSON.stringify({ message: `Outside dedicated pilot Docker boundary: ${method} ${endpointPath}` })); return; }
      const headers = { ...request.headers, host: 'docker', 'content-length': String(body.length) };
      delete headers.connection;
      const upstream = http.request({ socketPath, path: `${url.pathname}${url.search}`, method, headers, timeout: 175000 }, upstreamResponse => {
        if (!(method === 'POST' && endpointPath === '/containers/create')) {
          // /wait sends headers before the container starts, then its body when it exits.
          // Buffering it deadlocks docker run's wait-before-start handshake.
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          response.flushHeaders();
          let bytes = 0;
          upstreamResponse.on('data', chunk => { bytes += chunk.length; if (bytes > 16_000_000) { rejection = 'Scoped Docker response exceeded its byte limit'; upstream.destroy(); response.destroy(); } });
          upstreamResponse.pipe(response);
          return;
        }
        const output: Buffer[] = []; let size = 0;
        upstreamResponse.on('data', chunk => { size += chunk.length; if (size > 16_000_000) upstream.destroy(); else output.push(chunk); });
        upstreamResponse.on('end', () => {
          const result = Buffer.concat(output);
          if (method === 'POST' && endpointPath === '/containers/create' && upstreamResponse.statusCode === 201) {
            try { ids.add(JSON.parse(result.toString()).Id); } catch { /* The CLI reports malformed responses. */ }
          }
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers); response.end(result);
        });
      });
      active.add(upstream); upstream.on('close', () => active.delete(upstream));
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Local Docker adapter unavailable'); });
      upstream.end(body);
    } catch (error) { rejection = error instanceof Error ? error.message : 'Invalid Docker request'; if (!response.headersSent) response.writeHead(403); response.end('Dedicated pilot Docker request rejected'); }
  });
  // The pinned Auth-migration job attaches its output while it runs. No exec or arbitrary attach is allowed.
  server.on('upgrade', (request, socket, head) => {
    attachState = 'request received';
    attachHandshake = { httpVersion: request.httpVersion, contentLength: request.headers['content-length'], transferEncoding: request.headers['transfer-encoding'], connection: request.headers.connection, upgrade: request.headers.upgrade, headLength: head.length, upstreamBytes: false };
    const route = new URL(request.url ?? '/', 'http://127.0.0.1').pathname.replace(/^\/v[0-9]+\.[0-9]+/, '');
    const match = route.match(/^\/containers\/([^/]+)\/attach$/);
    if (request.method !== 'POST' || !match || !ids.has(match[1])) { attachState = 'rejected unknown attach'; socket.destroy(); return; }
    attachState = 'validated';
    // Relay raw bytes for this one approved route: preserve Docker's 101/200 handshake and framing.
    const remote = net.createConnection(socketPath);
    upgraded.add(socket as net.Socket); upgraded.add(remote);
    remote.once('connect', () => {
      attachState = 'connected to local engine';
      const headers: string[] = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) headers.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
      remote.write(`POST ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`);
      if (head.length) remote.write(head);
      socket.pipe(remote); remote.pipe(socket);
    });
    remote.once('data', chunk => { attachState = 'engine handshake received'; attachHandshake.upstreamBytes = true; attachHandshake.upstreamStatus = chunk.toString('ascii', 0, 80).split('\r\n')[0].match(/^HTTP\/[0-9.]+ [0-9]{3}/)?.[0] ?? 'non-HTTP'; });
    let attachBytes = 0;
    remote.on('data', chunk => { attachBytes += chunk.length; if (attachBytes > 16_000_000) { rejection = 'Scoped Auth initialization stream exceeded its byte limit'; remote.destroy(); socket.destroy(); } });
    remote.setTimeout(60000, () => remote.destroy());
    socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
    socket.on('close', () => { upgraded.delete(socket as net.Socket); remote.destroy(); });
    remote.on('close', () => { upgraded.delete(remote); socket.destroy(); });
  });
  server.requestTimeout = 180000; server.headersTimeout = 10000;
  const pipeName = `dk-v2-${randomUUID()}`;
  const adapterPath = endpoint.startsWith('npipe:') ? `\\\\.\\pipe\\${pipeName}` : path.join(tmpdir(), `${pipeName}.sock`);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(adapterPath, () => resolve()); });
  try { return await operation(endpoint.startsWith('npipe:') ? `npipe:////./pipe/${pipeName}` : `unix://${adapterPath}`); }
  catch (error) { if (rejection || attachState !== 'not requested') throw new Error(`Pinned Supabase CLI Docker transport failed: ${rejection || `Auth initialization attach ${attachState} ${JSON.stringify(attachHandshake)}`}`); throw error; }
  finally { for (const request of active) request.destroy(); for (const socket of upgraded) socket.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
