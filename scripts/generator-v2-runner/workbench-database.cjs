'use strict';
// Trusted generic harness. Candidate code never executes in Node. Only rows
// written by newly created QA accounts can become verification fixtures.
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const verify=(condition,message)=>{if(!condition)throw new Error(message);};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
function validateConfig(value){
  verify(value&&typeof value==='object','Missing trusted database configuration.');
  const url=new URL(value.internalApiUrl);
  verify(url.protocol==='http:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash
    &&/^dk-v2-api-[a-f0-9]{32}$/.test(url.hostname)&&url.port==='8000','Database URL is not the scoped Supabase gateway.');
  verify(typeof value.anonKey==='string'&&value.anonKey.length>20&&value.anonKey.length<4096&&value.schema==='app'
    &&typeof value.storageKey==='string'&&/^[a-zA-Z0-9_-]{1,180}$/.test(value.storageKey),'Invalid public SDK configuration.');
  verify(Array.isArray(value.tableNames)&&value.tableNames.length>0&&value.tableNames.length<=24
    &&new Set(value.tableNames).size===value.tableNames.length&&value.tableNames.every(name=>typeof name==='string'&&/^[a-z][a-z0-9_]{0,62}$/.test(name)),'Invalid table allowlist.');
  return value;
}
async function readConfig(){
  const stat=await fs.lstat('/config/runtime.json').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!stat)return null;
  verify(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<65536,'Invalid trusted configuration file.');
  return validateConfig(JSON.parse(await fs.readFile('/config/runtime.json','utf8')));
}
function allowedRoute(method,pathname,config){
  const match=/^\/rest\/v1\/([a-z][a-z0-9_]*)$/.exec(pathname);
  if(match)return config.tableNames.includes(match[1])&&['GET','HEAD','POST','PATCH','DELETE'].includes(method);
  return (['/auth/v1/signup','/auth/v1/token','/auth/v1/logout'].includes(pathname)&&method==='POST')
    ||(pathname==='/auth/v1/user'&&['GET','PUT'].includes(method));
}
function runtimeScript(config){
  const publicConfig={anonKey:config.anonKey,schema:config.schema,storageKey:config.storageKey};
  return 'window.__DK_SUPABASE__=Object.freeze(Object.assign('+JSON.stringify(publicConfig).replace(/</g,'\\u003c')+',{url:window.location.origin+"/supabase"}));';
}
async function boundedPayload(response){
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  const parts=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;verify(bytes<=1024*1024,'Database response exceeds the verification limit.');parts.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  return Buffer.concat(parts);
}
function createDatabaseHarness(config,{verificationMode=true,fetcher=fetch}={}){
  validateConfig(config);
  const accounts=new Map(),rows=new Map(),concurrency=new Map(),deleted=[];
  let first,second,requestCount=0,unavailable=false;
  const request=async(route,{token,method='GET',body,rawBody,headers={}}={})=>{
    if(verificationMode)verify(++requestCount<=800,'Database verification request budget exhausted.');
    const response=await fetcher(config.internalApiUrl.replace(/\/$/,'')+route,{method,redirect:'error',signal:AbortSignal.timeout(12000),headers:{
      'Content-Type':'application/json',apikey:config.anonKey,Authorization:'Bearer '+(token||config.anonKey),
      'Accept-Profile':'app','Content-Profile':'app',Prefer:'return=representation',...headers,
    },...(!['GET','HEAD'].includes(method)&&(body!==undefined||rawBody!==undefined)?{body:rawBody??JSON.stringify(body)}:{})})
      .catch(()=>{unavailable=true;throw new Error('The isolated Supabase service is unreachable.');});
    if(response.status>=500||response.status===429)unavailable=true;
    const payload=await boundedPayload(response);let data=null;try{data=payload.length?JSON.parse(payload.toString('utf8')):null;}catch{}
    return {ok:response.ok,status:response.status,data,payload,headers:response.headers};
  };
  const login=async(account)=>{
    const response=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:account.email,password:account.password}});
    verify(response.ok&&response.data?.access_token&&response.data?.refresh_token&&UUID.test(response.data?.user?.id),'Real GoTrue login failed.');
    const value={...account,id:response.data.user.id,session:response.data};accounts.set(value.session.access_token,value);return value;
  };
  const signup=async(label)=>{
    const account={email:'dk-wb-'+label+'-'+crypto.randomUUID()+'@example.test',password:'Dk!'+crypto.randomUUID()+'9a'};
    const response=await request('/auth/v1/signup',{method:'POST',body:account});
    verify(response.ok&&UUID.test(response.data?.user?.id),'Real GoTrue signup failed.');return login(account);
  };
  const tableRoute=(table,id)=>'/rest/v1/'+table+(id?'?id=eq.'+encodeURIComponent(id)+'&select=*':'');
  const readRow=async(account,table,id)=>request(tableRoute(table,id),{token:account?.session.access_token});
  const observedRows=data=>Array.isArray(data)?data:data&&typeof data==='object'?[data]:[];
  const observe=(method,table,account,data)=>{
    if(!account||!table)return;
    for(const row of observedRows(data)){
      if(!UUID.test(row.id)||row.owner_id!==account.id)continue;
      const key=table+':'+row.id;
      if(method==='DELETE'){rows.delete(key);deleted.push({table,id:row.id,account});}
      else if(['POST','PATCH'].includes(method)){verify(rows.size<200||rows.has(key),'Too many database verification fixtures.');rows.set(key,{table,id:row.id,row,account});}
    }
  };
  const proxy=async(req,res,url)=>{
    const pathname=url.pathname.slice('/supabase'.length);
    if(!allowedRoute(req.method,pathname,config)){res.writeHead(403);res.end('Outside the scoped application API');return;}
    if(url.search.length>4096){res.writeHead(414);res.end();return;}
    if(req.headers.accept&&!/^(?:\*\/\*|application\/json|application\/vnd\.pgrst\.(?:object|array)\+json(?:;nulls=stripped)?)$/i.test(req.headers.accept)){res.writeHead(406);res.end();return;}
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const rawBody=size?Buffer.concat(chunks):undefined;
    const token=typeof req.headers.authorization==='string'?req.headers.authorization.replace(/^Bearer\s+/i,''):undefined;
    const account=accounts.get(token),table=/^\/rest\/v1\/([a-z][a-z0-9_]*)$/.exec(pathname)?.[1];
    const headers={};for(const name of ['accept','x-client-info','x-supabase-api-version'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
    if(typeof req.headers.prefer==='string'){
      const preferences=req.headers.prefer.split(',').map(value=>value.trim());
      if(preferences.some(value=>! /^(?:resolution=(?:merge-duplicates|ignore-duplicates)|return=(?:minimal|representation)|count=(?:exact|planned|estimated)|missing=default)$/.test(value))){res.writeHead(400);res.end('Unsupported API preference');return;}
      headers.Prefer=[...preferences.filter(value=>!verificationMode||!value.startsWith('return=')),...(verificationMode?['return=representation']:[])].join(',');
    }
    const input={token,method:req.method,rawBody,headers};
    let body=null;try{body=rawBody?JSON.parse(rawBody.toString('utf8')):null;}catch{}
    let response;
    // An explicit idempotency key makes a controlled duplicate safe for a QA
    // fixture. This branch never runs in the hosted preview.
    if(verificationMode&&account&&table&&req.method==='POST'&&body&&!Array.isArray(body)&&UUID.test(body.request_id)&&!concurrency.has(table)){
      concurrency.set(table,{passed:false,requestId:body.request_id,account});
      const responses=await Promise.all([request(pathname+url.search,input),request(pathname+url.search,input)]);
      response=responses.find(result=>result.ok)||responses[0];
      const selected=await request('/rest/v1/'+table+'?request_id=eq.'+body.request_id+'&select=*',{token});
      concurrency.set(table,{passed:responses.some(result=>result.ok)&&responses.every(result=>result.ok||result.status===409)
        &&selected.ok&&Array.isArray(selected.data)&&selected.data.length===1&&selected.data[0].owner_id===account.id
        &&responses.filter(result=>result.ok).every(result=>observedRows(result.data).every(row=>row.id===selected.data[0].id)),requestId:body.request_id,account});
    }else response=await request(pathname+url.search,input);
    if(verificationMode&&response.ok)observe(req.method,table,account,response.data);
    const outgoing={'Content-Type':response.headers.get('content-type')||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    for(const name of ['content-range','preference-applied'])if(response.headers.get(name))outgoing[name]=response.headers.get(name);
    res.writeHead(response.status,outgoing);res.end(response.payload);
  };
  const prepare=async()=>{first=await signup('owner-a');second=await signup('owner-b');verify(first.id!==second.id,'QA users are not independent.');return first;};
  const inject=async(context,account)=>context.addInitScript(({storageKey,session})=>{
    if(location.origin==='http://127.0.0.1:3000')localStorage.setItem(storageKey,JSON.stringify(session));
  },{storageKey:config.storageKey,session:account.session});
  const check=async(record,id,work)=>{try{const detail=await work();record(id,true,detail);return true;}catch(error){record(id,false,String(error.message).slice(0,600));return false;}};
  const verifyEvidence=async(record,browserReadback)=>{
    const twoUsers=await check(record,'platform:auth-two-users',async()=>{
      verify(first&&second&&first.id!==second.id,'Two real QA accounts are missing.');
      const invalid=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:first.email,password:'wrong-password-for-test'}});
      verify([400,401,403].includes(invalid.status)&&!invalid.data?.access_token,'Invalid password was accepted.');
      return 'Independent real GoTrue users signed in; invalid password was rejected.';
    });
    const fixtures=[...rows.values()];
    const covered=()=>verify(config.tableNames.every(table=>fixtures.some(item=>item.table===table)),'Each private table needs an actual browser-created owner fixture; empty or simulated evidence is insufficient.');
    const persistence=await check(record,'platform:persistence',async()=>{
      covered();
      for(const item of fixtures){
        const fresh=await login(item.account),selected=await readRow(fresh,item.table,item.id);
        verify(selected.ok&&Array.isArray(selected.data)&&selected.data.length===1&&canonical(selected.data[0])===canonical(item.row),'Fresh session did not read the exact browser-written '+item.table+' row.');
        await browserReadback(fresh,item);
      }
      for(const item of deleted){const missing=await readRow(item.account,item.table,item.id);verify(missing.ok&&Array.isArray(missing.data)&&missing.data.length===0,'A browser-deleted row remained in PostgreSQL.');}
      return 'Exact browser-written rows were read back from PostgreSQL by newly authenticated sessions and independent browser contexts for every private table.';
    });
    const preserved=async(item)=>{const read=await readRow(item.account,item.table,item.id);verify(read.ok&&read.data?.length===1&&canonical(read.data[0])===canonical(item.row),'An unauthorized request changed an owner fixture.');};
    const denied=response=>[401,403].includes(response.status)||(response.ok&&Array.isArray(response.data)&&response.data.length===0);
    for(const [id,account] of [['platform:authorization-cross-owner',second],['platform:authorization-anonymous',undefined]]){
      await check(record,id,async()=>{
        covered();
        for(const item of fixtures){
          verify(denied(await readRow(account,item.table,item.id)),'Private row exposed by '+id+'.');
          for(const method of ['PATCH','DELETE']){
            const response=await request(tableRoute(item.table,item.id),{token:account?.session.access_token,method,body:method==='PATCH'?{owner_id:account?.id||crypto.randomUUID()}:undefined});
            verify(denied(response),'Unauthorized '+method+' was accepted for '+item.table+'.');
          }
          await preserved(item);
          if(account){
            const transfer=await request(tableRoute(item.table,item.id),{token:item.account.session.access_token,method:'PATCH',body:{owner_id:account.id}});
            verify(denied(transfer)||transfer.status===400,'Owner could transfer a private row outside its authenticated scope.');
            await preserved(item);
            const forged={...item.row,id:crypto.randomUUID(),request_id:crypto.randomUUID(),owner_id:item.account.id};
            const insert=await request('/rest/v1/'+item.table,{token:account.session.access_token,method:'POST',body:forged});
            verify([400,401,403].includes(insert.status),'A foreign user inserted a row owned by another account.');
          }
        }
        return 'Exact owner rows in every private table resisted foreign/anonymous reads, updates and deletes; original contents were independently rechecked.';
      });
    }
    await check(record,'platform:database-concurrency',async()=>{
      verify(config.tableNames.every(table=>concurrency.get(table)?.passed),'Each private table requires a client-generated request_id UUID with enforced uniqueness. Controlled concurrent retries did not establish exactly one persisted row.');
      return 'For every table, two simultaneous QA writes with one client request_id yielded exactly one stable owned record through uniqueness rejection or idempotent upsert. This is not a load or multirow transaction test.';
    });
    const lifecycle=await check(record,'platform:auth-session-lifecycle',async()=>{
      const invalid=await request('/rest/v1/'+config.tableNames[0],{token:'invalid.jwt.value'});verify([401,403].includes(invalid.status),'Invalid JWT was accepted.');
      const session=await login(second);
      const logout=await request('/auth/v1/logout?scope=global',{token:session.session.access_token,method:'POST'});verify(logout.ok,'Real logout failed.');
      const refresh=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.session.refresh_token}});
      verify([400,401,403].includes(refresh.status)&&!refresh.data?.access_token,'Logged-out refresh token still created a session.');
      return 'Real login/logout/refresh semantics verified. Existing access JWT expiry and instant token revocation are not certified.';
    });
    record('requirement:feature.server-persistence',persistence,persistence?'Actual application writes persisted across new authenticated sessions and browser contexts.':'No complete real database persistence evidence.');
    record('requirement:feature.app-authentication',twoUsers&&lifecycle,'Real signup, password login, invalid credentials, logout and refresh-token rejection were exercised; no synthetic session was substituted.');
  };
  return {config,prepare,signup,login,inject,proxy,verifyEvidence,isUnavailable:()=>unavailable,runtimeScript:()=>runtimeScript(config)};
}
module.exports={validateConfig,readConfig,allowedRoute,runtimeScript,createDatabaseHarness};
