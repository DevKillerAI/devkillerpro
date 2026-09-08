import { createHash } from 'node:crypto';
type File={path:string;content:string};
/** Metadata and file ordering are not source changes. Keep code bytes exact. */
export function candidateFingerprint(files:File[]){
  return createHash('sha256').update(JSON.stringify(files.map(f=>({path:f.path.replaceAll('\\','/'),content:f.content})).sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');
}
export function repairProgress(previous:File[],next:File[],seen:ReadonlySet<string>){
  const fingerprint=candidateFingerprint(next);
  return {fingerprint,reason:fingerprint===candidateFingerprint(previous)?'unchanged-patch':seen.has(fingerprint)?'repeated-candidate':null};
}
