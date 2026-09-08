import { database } from './database';
import { selectTaskModel } from './modelRouting';
import { policySchema,policyRole,type ModelPolicy } from '../admin/modelPolicy';
export function environmentPolicy():ModelPolicy {
 return {product:selectTaskModel('consultant_contribution'),specialists:selectTaskModel('consultant_contribution'),decision:selectTaskModel('council_decision'),build:selectTaskModel('mission_build'),qa:selectTaskModel('functional_qa_review'),repair:selectTaskModel('mission_patch_repair')} as ModelPolicy;
}
export async function currentPolicy(){
 const [row]=await database()`select id,policy from model_policy_history order by id desc limit 1`;
 return row?{id:String(row.id),policy:policySchema.parse(row.policy)}:{id:'environment',policy:environmentPolicy()};
}
export async function missionModel(missionId:string,schema:string){
 const [row]=await database()`select metadata->'modelPolicy' as policy from missions where id=${missionId}`;
 // Legacy missions retain environment behavior; deployment backfills them before controls are enabled.
 return row?.policy ? policySchema.parse(row.policy)[policyRole(schema)] : selectTaskModel(schema);
}
