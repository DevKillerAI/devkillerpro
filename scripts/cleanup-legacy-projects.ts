import { readdir, lstat, realpath, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { database, closeDatabase } from '../src/lib/server/database';

// Explicit operator command. No RAG, accounts, credit ledger or v2 data is targeted.
async function main() {
  const sql = database();
  const [owner] = await sql`select u.id from auth.users u join profiles p on p.id=u.id where lower(u.email)=lower(${process.env.DEVKILLER_PILOT_EMAIL || ''}) and p.role='admin'`;
  if (!owner) throw new Error('Configured owner administrator not found.');
  const missions = await sql`select id,owner_id,status,metadata from missions order by id`;
  const active = await sql<{ mission_id: string; status: string }[]>`select mission_id,status from mission_jobs where status in ('queued','running','retrying')`;
  const remote = await sql<{ mission_id: string; status: string }[]>`select mission_id,status from provider_requests where status in ('queued','in_progress')`;
  const root = await realpath('.devkiller');
  const targets: { source: string; group: string; id: string; orphan: boolean }[] = [];
  // Per-app backend sandboxes belong to the legacy projects too. Platform
  // checkpoints, RAG, v2 evidence, accounts and shared infrastructure do not.
  for (const group of ['missions', 'discarded', 'app-infrastructure']) {
    const parent = path.join(root, group);
    for (const entry of await readdir(parent, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
      const row = group === 'app-infrastructure' ? undefined : missions.find(m => m.id === entry.name);
      if (row?.owner_id && row.owner_id !== owner.id) continue;
      const source = path.join(parent, entry.name);
      if ((await lstat(source)).isSymbolicLink() || await realpath(source) !== source) throw new Error('Unexpected linked cleanup target.');
      targets.push({ source, group, id: entry.name, orphan: !row });
    }
  }
  const ids = missions.filter(m => !m.owner_id || m.owner_id === owner.id).map(m => String(m.id));
  const blockers: { mission_id: string; status: string; source: 'job' | 'provider' }[] = [
    ...active.map(r => ({ ...r, source: 'job' as const })),
    ...remote.map(r => ({ ...r, source: 'provider' as const })),
  ].filter(r => ids.includes(r.mission_id));
  console.log(JSON.stringify({ apply: process.argv.includes('--apply'), registryCount: ids.length, directories: targets, blockers }, null, 2));
  if (!process.argv.includes('--apply')) return;
  if (blockers.length) throw new Error('Active legacy work must be cancelled and reconciled before cleanup.');
  const backup = path.join(root, 'backups', `legacy-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(backup, { recursive: false });
  const records = await sql`select * from missions where id=any(${ids})`;
  await writeFile(path.join(backup, 'registry.json'), JSON.stringify(records, null, 2), { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(backup, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), ids, targets, recovery: 'Restore directory mappings and mission metadata from registry.json. Platform accounts, balances and v2 are unchanged.' }, null, 2), { flag: 'wx', mode: 0o600 });
  await sql.begin(async tx => {
    await tx`select id from missions where id=any(${ids}) for update`;
    const busy = await tx`select id from mission_jobs where mission_id=any(${ids}) and status in ('queued','running','retrying')`;
    if (busy.length) throw new Error('Legacy mission became active during cleanup.');
    await tx`update missions set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('discarded',true,'cleanupVersion','legacy-v2-cutover-20260903') where id=any(${ids})`;
  });
  for (const target of targets) {
    const destination = path.join(backup, target.group, target.id);
    if (!target.source.startsWith(root + path.sep) || !destination.startsWith(backup + path.sep) || await realpath(target.source) !== target.source) throw new Error('Unsafe cleanup mapping.');
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(target.source, destination);
  }
  console.log(JSON.stringify({ removedFromRegistry: ids.length, relocatedDirectories: targets.length, recoverableBackup: backup }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(closeDatabase);
