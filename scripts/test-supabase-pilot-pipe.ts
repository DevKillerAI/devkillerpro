import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withSupabasePilotDockerProxy } from '../src/lib/server/generator/supabasePilotDockerProxy';

const exec = promisify(execFile);
async function main() {
  const scope = process.argv[2];
  if (!/^[a-f0-9]{64}$/.test(scope ?? '')) throw new Error('Provide an infrastructure-only QA scope.');
  const directory = path.resolve('.devkiller/generator-v2/environments', scope);
  const binding = JSON.parse(await readFile(path.join(directory, 'binding.json'), 'utf8'));
  if (binding.identity.ownerId !== 'v2-infrastructure-qa') throw new Error('Only infrastructure QA identities are allowed.');
  const auth = JSON.parse((await exec('docker', ['inspect', `supabase_auth_${binding.stackId}`], { windowsHide: true })).stdout)[0];
  if (auth.Config.Labels['com.supabase.cli.project'] !== binding.stackId) throw new Error('Auth fixture binding mismatch.');
  const values: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'TEMP', 'TMP']) values[key] = process.env[key];
  const keys = ['API_EXTERNAL_URL', 'GOTRUE_DB_DRIVER', 'GOTRUE_DB_DATABASE_URL', 'GOTRUE_SITE_URL', 'GOTRUE_JWT_SECRET'];
  for (const key of keys) values[key] = auth.Config.Env.find((value: string) => value.startsWith(`${key}=`))?.slice(key.length + 1);
  await withSupabasePilotDockerProxy({ ...binding, network: `${binding.network}-services`, directory }, async dockerHost => {
    await exec('docker', ['run', '--rm', '--network', `${binding.network}-services`, '--label', `com.supabase.cli.project=${binding.stackId}`, '--label', `com.docker.compose.project=${binding.stackId}`, ...keys.flatMap(key => ['-e', key]), 'public.ecr.aws/supabase/gotrue:v2.196.0', 'gotrue', 'migrate'], { windowsHide: true, env: { ...values, DOCKER_HOST: dockerHost }, timeout: 30000, maxBuffer: 100000 });
  });
  console.log(JSON.stringify({ scopeHash: scope, privateNamedPipeAuthInitialization: true, existingUsersPreserved: true }));
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith('Pinned') ? error.message : 'Private-pipe authentication initialization failed or timed out.'); process.exitCode = 1; });
