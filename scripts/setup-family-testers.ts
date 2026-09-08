import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {database,closeDatabase} from '../src/lib/server/database';
const accounts=[{name:'Rodrigo',email:'rodrigo@devkiller.local'},{name:'Arthur',email:'arthur@devkiller.local'}];
const password=()=>`${randomBytes(15).toString('base64url')}aA1!`;
async function main(){
  if(!process.argv.includes('--apply'))throw new Error('Use --apply to create the two isolated tester accounts.');
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const listed=await admin.auth.admin.listUsers({page:1,perPage:1000});if(listed.error)throw listed.error;
  const output=[];
  for(const account of accounts){
    const existing=listed.data.users.find(user=>user.email?.toLowerCase()===account.email);
    if(existing){
      await database()`update profiles set display_name=${account.name},role='tester',access_enabled=true,access_revoked_at=null,generator_enabled=true,managed_ai_enabled=false,generation_budget_micros=1000000 where id=${existing.id}`;
      await admin.auth.admin.updateUserById(existing.id,{ban_duration:'none'});
      output.push({...account,userId:existing.id,password:null,existing:true});continue;
    }
    const temporaryPassword=password();
    const created=await admin.auth.admin.createUser({email:account.email,password:temporaryPassword,email_confirm:true,user_metadata:{display_name:account.name}});if(created.error)throw created.error;
    await database()`update profiles set display_name=${account.name},role='tester',credit_limit=1,credits_used=0,access_enabled=true,access_revoked_at=null,generator_enabled=true,managed_ai_enabled=false,generation_budget_micros=1000000 where id=${created.data.user.id}`;
    output.push({...account,userId:created.data.user.id,password:temporaryPassword,existing:false});
  }
  console.log(JSON.stringify(output));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Unable to create tester accounts.');process.exitCode=1;}).finally(closeDatabase);
