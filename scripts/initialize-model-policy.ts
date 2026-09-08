import { database,closeDatabase } from '../src/lib/server/database';
import { environmentPolicy } from '../src/lib/server/modelPolicy';
async function main(){const sql=database();const policy=environmentPolicy();await sql.begin(async tx=>{
 const [owner]=await tx`select p.id from profiles p join auth.users u on u.id=p.id where p.role='admin' and lower(u.email)=${process.env.DEVKILLER_PILOT_EMAIL?.toLowerCase() || ''}`;
 if(!owner)throw new Error('Configured owner administrator not found.');
 await tx`update missions set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('modelPolicy',${tx.json(policy)},'modelPolicyVersion','legacy-environment') where not(coalesce(metadata,'{}'::jsonb) ? 'modelPolicy')`;
 await tx`insert into model_policy_history(owner_id,policy) select ${owner.id},${tx.json(policy)} where not exists(select 1 from model_policy_history)`;
 });console.log('Legacy missions pinned; baseline history initialized. No model changed.');}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(closeDatabase);
