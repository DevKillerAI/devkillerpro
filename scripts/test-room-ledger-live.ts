import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {localSupabaseConfig} from '../src/lib/server/supabaseRuntime';
async function main(){
 const config=await localSupabaseConfig('benchmark-supabase-booking-20260902');
 const folder='.devkiller/app-infrastructure/roomledger';await mkdir(folder,{recursive:true});
 let users:{email:string;password:string}[];
 try{users=JSON.parse(await readFile(`${folder}/test-users.json`,'utf8'));}catch{
  users=[1,2].map(n=>({email:`qa-room-${Date.now()}-${n}@example.test`,password:randomBytes(20).toString('hex')}));
  for(const user of users){const response=await fetch(`${config.url}/auth/v1/signup`,{method:'POST',headers:{apikey:config.anonKey,'Content-Type':'application/json'},body:JSON.stringify(user)});if(!response.ok)throw new Error(`Test account setup failed (${response.status})`);}
  await writeFile(`${folder}/test-users.json`,JSON.stringify(users),{flag:'wx'});
 }
 const sessions:{access_token:string;user:{id:string}}[]=[];
 for(const user of users){const response=await fetch(`${config.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.anonKey,'Content-Type':'application/json'},body:JSON.stringify(user)});const data=await response.json();assert.equal(response.status,200,`Real Auth sign-in failed (${data.error_code||''})`);sessions.push(data);}
 const request=async(user:number|null,method:string,query:string,body?:unknown)=>{
  const response=await fetch(`${config.url}/rest/v1/reservations${query}`,{method,headers:{apikey:config.anonKey,Authorization:`Bearer ${user===null?config.anonKey:sessions[user].access_token}`,'Content-Type':'application/json','Accept-Profile':'room_ledger','Content-Profile':'room_ledger',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
 };
 const checks:string[]=['Two users signed in through real Supabase Auth'];
 const marker=`QA-${Date.now()}`;
 let result=await request(null,'GET','?select=id');assert.ok([401,403].includes(result.status),JSON.stringify(result));checks.push('Anonymous read denied');
 result=await request(0,'POST','',{room_name:marker,starts_at:'2030-06-01T09:00:00Z',ends_at:'2030-06-01T10:00:00Z'});assert.equal(result.status,201,JSON.stringify(result));const id=result.data[0].id;
 assert.equal(result.data[0].owner_id,sessions[0].user.id);checks.push('Owner create derives identity from Auth');
 result=await request(1,'GET',`?id=eq.${id}&select=id`);assert.deepEqual(result.data,[]);checks.push('Second user cannot read owner record');
 result=await request(1,'PATCH',`?id=eq.${id}`,{room_name:'Stolen'});assert.deepEqual(result.data,[]);checks.push('Second user cannot update owner record');
 result=await request(0,'PATCH',`?id=eq.${id}`,{owner_id:sessions[1].user.id});assert.ok(result.status>=400);checks.push('Owner transfer denied');
 result=await request(0,'PATCH',`?id=eq.${id}`,{starts_at:'2030-06-01T08:45:00Z'});assert.equal(result.status,200);checks.push('Owner edit confirmed');
 result=await request(0,'POST','',{room_name:marker,starts_at:'2030-06-01T10:00:00Z',ends_at:'2030-06-01T11:00:00Z'});assert.equal(result.status,201);checks.push('Exact adjacency allowed');
 result=await request(0,'POST','',{room_name:marker,starts_at:'2030-06-01T09:30:00Z',ends_at:'2030-06-01T10:30:00Z'});assert.ok(result.status>=400,JSON.stringify(result));assert.equal(result.data.code,'23P01',JSON.stringify(result));checks.push('Overlapping reservation denied');
 result=await request(0,'PATCH',`?id=eq.${id}`,{cancelled_at:new Date().toISOString()});assert.equal(result.status,200);
 result=await request(0,'POST','',{room_name:marker,starts_at:'2030-06-01T09:00:00Z',ends_at:'2030-06-01T10:00:00Z'});assert.equal(result.status,201);checks.push('Cancellation releases slot');
 const races=await Promise.all([0,1].map(user=>request(user,'POST','',{room_name:marker+'-race',starts_at:'2030-06-02T09:00:00Z',ends_at:'2030-06-02T10:00:00Z'})));
 assert.equal(races.filter(r=>r.status===201).length,1,JSON.stringify(races));assert.equal(races.filter(r=>r.status>=400&&r.data.code==='23P01').length,1,JSON.stringify(races));checks.push('Two simultaneous overlapping requests: exactly one succeeds');
 // Keep clearly named cancelled QA records as a transparent test history.
 for(const user of [0,1]){
  await request(user,'PATCH',`?room_name=like.${marker}*&cancelled_at=is.null`,{cancelled_at:new Date().toISOString()});
 }
 const report={passed:true,checks,at:new Date().toISOString(),limitations:['Browser interaction and restart persistence are separate checks.'],testData:'Two synthetic local accounts and cancelled QA-prefixed reservation history retained.'};
 await writeFile('.devkiller/incident-reviews/supabase-migration/room-ledger-live-api.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
