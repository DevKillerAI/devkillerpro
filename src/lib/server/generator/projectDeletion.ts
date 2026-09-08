import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { identitySchema, type GeneratorIdentity } from './contract';

/** Deletes only one validated generator identity's artifact subtree. */
export async function deletePilotArtifacts(identity:GeneratorIdentity):Promise<void>{
  const safe=identitySchema.parse(identity),root=path.resolve('.devkiller/generator-v2/artifacts');
  const target=path.resolve(root,safe.ownerId,safe.projectId,safe.missionId);
  if(!target.startsWith(root+path.sep)||target===root)throw new Error('Unsafe artifact deletion target.');
  try{const stat=await lstat(target);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Unsafe artifact deletion target.');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  await rm(target,{recursive:true,force:true});
}
