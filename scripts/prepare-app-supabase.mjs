import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
// Infrastructure only. Application schemas must still come from DevKiller.
const targets={roomledger:{port:55321,schema:'room_ledger'},queuepantry:{port:56321,schema:'queue_pantry'}};
const name=process.argv[2];const target=targets[name];
if(!target)throw new Error('Choose roomledger or queuepantry');
const root=path.resolve('.devkiller/app-infrastructure',name);
let config=await readFile('supabase/config.toml','utf8');
config=config.replace('project_id = "dk_war_room"',`project_id = "dk_${name}"`);
config=config.replace(/\b543(\d\d)\b/g,(_,suffix)=>String(target.port-21+Number(suffix)));
// Expose application schemas only after their migrations have created them.
for(const section of ['studio','inbucket','storage','realtime','analytics','edge_runtime','db.seed']){
 config=config.replace(new RegExp(`(\\[${section.replace('.','\\.')}\\][\\s\\S]*?enabled = )true`),'$1false');
}
await mkdir(path.join(root,'supabase'),{recursive:true});
await writeFile(path.join(root,'supabase/config.toml'),config,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
console.log(JSON.stringify({name,root,apiPort:target.port,dbPort:target.port+1,schema:target.schema}));
