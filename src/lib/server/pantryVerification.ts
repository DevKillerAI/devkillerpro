import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {localSupabaseConfig} from './supabaseRuntime';
const exec=promisify(execFile);
const MISSION='benchmark-firebase-orders-20260902';

/** Trusted benchmark adapter, not generated code. Never targets a user's production database. */
export async function verifyPantryLive(missionId:string,signal?:AbortSignal){
 if(missionId!==MISSION)throw new Error('Pantry verification requires its dedicated benchmark.');
 const config=await localSupabaseConfig(missionId);
 const folder='.devkiller/app-infrastructure/queuepantry';await mkdir(folder,{recursive:true});
 type User={email:string;password:string};
 let users:User[];
 const call=async(endpoint:string,body?:unknown,token?:string,method=body?'POST':'GET')=>{
  signal?.throwIfAborted();
  const r=await fetch(`${config.url}${endpoint}`,{method,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{apikey:config.anonKey,Authorization:`Bearer ${token||config.anonKey}`,'Content-Type':'application/json','Accept-Profile':'queue_pantry','Content-Profile':'queue_pantry',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});
  const text=await r.text();return {status:r.status,data:text?JSON.parse(text):null};
 };
 try{users=JSON.parse(await readFile(`${folder}/test-users.json`,'utf8'));}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  users=[0,1].map(n=>({email:`qa-pantry-${Date.now()}-${n}@example.test`,password:randomBytes(20).toString('hex')}));
  for(const user of users){const r=await call('/auth/v1/signup',user);assert.equal(r.status,200,'Synthetic account signup failed');}
  await writeFile(`${folder}/test-users.json`,JSON.stringify(users),{flag:'wx'});
 }
 const sessions:{access_token:string;refresh_token:string;user:{id:string}}[]=[];
 const checks:string[]=[],trace:{check:string;status:number;code?:string}[]=[];
 for(const user of users){const r=await call('/auth/v1/token?grant_type=password',user);assert.equal(r.status,200,'Live Auth sign-in failed');sessions.push(r.data);}
 checks.push('Two separate users sign in through real Supabase Auth');
 const rpc=(user:number,name:string,body:unknown)=>call(`/rest/v1/rpc/${name}`,body,sessions[user].access_token);
 const get=(table:string,query:string,user=0)=>call(`/rest/v1/${table}?${query}`,undefined,sessions[user].access_token);
 const itemA=randomUUID(),itemB=randomUUID();
 // Only UUID-named synthetic fixtures are inserted. Real catalog inventory is never edited.
 await exec('docker',['exec','--user','postgres','supabase_db_dk_queuepantry','psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',`insert into queue_pantry.catalog_items(id,name,description,unit_label,stock_quantity) values ('${itemA}','QA-${itemA}','Automated stock contention test','units',1),('${itemB}','QA-${itemB}','Automated duplicate retry test','units',1);`],{windowsHide:true,timeout:15000,signal});
 const owned:{user:number;id:string}[]=[];
 try{
  let r=await call('/rest/v1/rpc/place_order',{p_catalog_item_id:itemA,p_quantity:1,p_idempotency_key:randomUUID()});assert.ok(r.status>=400,'Anonymous mutation must be denied');checks.push('Anonymous reservation denied');
  r=await rpc(0,'place_order',{p_catalog_item_id:itemA,p_quantity:0,p_idempotency_key:randomUUID()});assert.ok(r.status>=400,'Invalid quantity must be denied');checks.push('Invalid quantity rejected');
  const race=await Promise.all([0,1].map(user=>rpc(user,'place_order',{p_catalog_item_id:itemA,p_quantity:1,p_idempotency_key:randomUUID()})));
  race.forEach((r,user)=>{trace.push({check:`last-unit user ${user}`,status:r.status,code:r.data?.code});if(r.status===200)owned.push({user,id:r.data[0].order_id});});
  assert.equal(race.filter(r=>r.status===200).length,1,'Exactly one final-unit request must succeed');
  assert.equal(race.filter(r=>r.status>=400&&/Insufficient sample stock/.test(r.data?.message||'')).length,1,'Losing request must report stock exhaustion');
  assert.equal((await get('catalog_items',`id=eq.${itemA}&select=stock_quantity`)).data[0].stock_quantity,0);checks.push('Two authenticated last-unit requests: one reservation, one stock error, stock zero');
  const winner=owned[0],other=1-winner.user;
  assert.deepEqual((await get('orders',`id=eq.${winner.id}`,other)).data,[]);
  assert.deepEqual((await get('order_lines',`order_id=eq.${winner.id}`,other)).data,[]);
  assert.ok((await rpc(other,'cancel_order',{p_order_id:winner.id})).status>=400);checks.push('Other user cannot read or cancel the reservation');
  r=await call(`/rest/v1/catalog_items?id=eq.${itemA}`,{stock_quantity:99},sessions[0].access_token,'PATCH');assert.ok(r.status>=400);checks.push('Direct inventory tampering denied');
  const key=randomUUID();const retries=await Promise.all([0,1].map(()=>rpc(0,'place_order',{p_catalog_item_id:itemB,p_quantity:1,p_idempotency_key:key})));
  retries.forEach(r=>{trace.push({check:'same-key concurrent request',status:r.status,code:r.data?.code});if(r.status===200&&!owned.some(o=>o.id===r.data[0].order_id))owned.push({user:0,id:r.data[0].order_id});});
  assert.ok(retries.every(r=>r.status===200),'Both duplicate attempts must return successful responses');
  assert.equal(retries[0].data[0].order_id,retries[1].data[0].order_id);assert.equal(retries.filter(r=>r.data[0].reused).length,1);
  assert.equal((await get('orders',`idempotency_key=eq.${key}`)).data.length,1);
  assert.equal((await get('order_lines',`order_id=eq.${retries[0].data[0].order_id}`)).data.length,1);
  assert.equal((await get('catalog_items',`id=eq.${itemB}&select=stock_quantity`)).data[0].stock_quantity,0);checks.push('Concurrent duplicate key returns one order and line with one stock decrement');
  for(const o of owned){assert.equal((await rpc(o.user,'cancel_order',{p_order_id:o.id})).status,200);r=await rpc(o.user,'cancel_order',{p_order_id:o.id});assert.equal(r.status,200);assert.equal(r.data[0].already_cancelled,true);}
  for(const id of [itemA,itemB])assert.equal((await get('catalog_items',`id=eq.${id}&select=stock_quantity`)).data[0].stock_quantity,1);
  checks.push('Repeated cancellation restores each fixture exactly once');
  r=await call('/auth/v1/token?grant_type=refresh_token',{refresh_token:sessions[0].refresh_token});assert.equal(r.status,200);checks.push('Real Auth refresh succeeds');
  assert.equal((await call('/auth/v1/logout',{},r.data.access_token)).status,204);checks.push('Real Auth sign-out succeeds');
  return {passed:true,checks,trace,at:new Date().toISOString(),limitations:['API concurrency requests start together; lock-held SQL sessions and browser rendering are separate checks.'],testData:'Synthetic accounts retained; this run attempts scoped cleanup of its own UUID-labelled fixtures.'};
 }finally{
  // Best-effort release only reservations created by this run, including partial failures.
  for(const o of owned)await rpc(o.user,'cancel_order',{p_order_id:o.id}).catch(()=>undefined);
  const userIds=sessions.map(s=>s.user.id);
  if(userIds.every(id=>/^[a-f0-9-]{36}$/i.test(id))){
    const owners=userIds.map(id=>`'${id}'`).join(','),items=`'${itemA}','${itemB}'`;
    await exec('docker',['exec','--user','postgres','supabase_db_dk_queuepantry','psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',`begin; delete from queue_pantry.order_lines where catalog_item_id in (${items}) and owner_id in (${owners}); delete from queue_pantry.orders where catalog_item_id in (${items}) and owner_id in (${owners}); delete from queue_pantry.catalog_items c where c.id in (${items}) and not exists(select 1 from queue_pantry.orders o where o.catalog_item_id=c.id); commit;`],{windowsHide:true,timeout:15000}).catch(()=>undefined);
  }
 }
}
