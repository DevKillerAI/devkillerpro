'use strict';
// Trusted harness. Candidate code executes only inside an offline Chromium container.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const {readConfig,createDatabaseHarness}=require('./workbench-database.cjs');
const ROOT='/candidate', OUT='/output';
const CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'";
const normalizedText = value => String(value).replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
const matchesText = (observed, expected) => normalizedText(observed) === normalizedText(expected);
const matchesCount = (observed, expected) => observed === expected;
function validateJourneys(journeys) {
  if(!Array.isArray(journeys)||journeys.length<1||journeys.length>4)throw new Error('Invalid journey count.');
  for(const j of journeys) {
    if(typeof j.name!=='string'||j.name.length<3||j.name.length>140||!Array.isArray(j.requirementIds)||j.requirementIds.length>20
      ||new Set(j.requirementIds).size!==j.requirementIds.length||j.requirementIds.some(id=>typeof id!=='string'||!/^[a-z0-9][a-z0-9._-]{1,119}$/i.test(id)))throw new Error('Invalid or legacy requirement binding; requalification required.');
    if(!Array.isArray(j.steps)||j.steps.length<2||j.steps.length>12||!j.steps.some(s=>['text','count','disabled','enabled'].includes(s.action)))throw new Error('Invalid journey.');
    for(const s of j.steps)if(!['fill','click','select','check','uncheck','text','count','reload','disabled','enabled'].includes(s.action)||typeof s.testId!=='string'||!/^[a-zA-Z0-9_-]{0,80}$/.test(s.testId)||typeof s.value!=='string'||s.value.length>400)throw new Error('Invalid journey step.');
  }
}
function createAppServer(database,report){
  const assets=new Map([['/','index.html'],['/index.html','index.html'],['/assets/app.js','assets/app.js'],['/assets/app.css','assets/app.css']]);
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://127.0.0.1:3000');
    if(database&&url.pathname.startsWith('/supabase/')){await database.proxy(req,res,url);return;}
    if(database&&url.pathname==='/runtime-config.js'&&['GET','HEAD'].includes(req.method)){
      res.writeHead(200,{'Content-Type':'text/javascript','Content-Security-Policy':CSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(database.runtimeScript());return;
    }
    const file=assets.get(url.pathname);
    if(!file||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':CSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    let content=await fs.readFile(path.join(ROOT,file),'utf8');
    if(database&&file==='index.html')content=content.replace('<head>','<head><script src="/runtime-config.js"></script>');
    res.end(content);
  }catch{if(report)report.unavailable=true;if(!res.headersSent)res.writeHead(502);res.end('Application service unavailable');}});
  server.on('upgrade',(_req,socket)=>socket.destroy());
  return server;
}
async function main() {
  if(process.argv[2]==='compile') {
    const result=spawnSync(process.execPath,['/opt/generator-v2/compile.cjs','compile'],{stdio:'inherit'});
    if(result.status!==0) {process.exitCode=result.status||1; return;}
    // Re-hash after applying a platform-owned neutral document title.
    const crypto=require('node:crypto'), digest=x=>crypto.createHash('sha256').update(x).digest('hex');
    const html=(await fs.readFile(path.join(OUT,'index.html'),'utf8')).replace('<title>Briefboard</title>','<title>DevKiller app</title>')
      .replace(/<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/g,'');
    await fs.writeFile(path.join(OUT,'index.html'),html);
    const metadata=JSON.parse(await fs.readFile(path.join(OUT,'build.json'),'utf8'));
    const artifact=metadata.artifacts.find(a=>a.path==='index.html'); artifact.hash=digest(html);artifact.bytes=Buffer.byteLength(html);
    await fs.writeFile(path.join(OUT,'build.json'),JSON.stringify(metadata)); return;
  }
  const config=await readConfig(),database=config?createDatabaseHarness(config,{verificationMode:process.argv[2]!=='serve'}):null;
  if(process.argv[2]==='serve'){
    const server=createAppServer(database);
    await new Promise(resolve=>server.listen(3000,'0.0.0.0',resolve));
    await new Promise(resolve=>{const stop=()=>server.close(resolve);process.once('SIGTERM',stop);process.once('SIGINT',stop);});return;
  }
  const raw=await fs.readFile(path.join(ROOT,'journeys.json'),'utf8');
  if(Buffer.byteLength(raw)>16000)throw new Error('Journey plan exceeds bound.');
  const journeys=JSON.parse(raw);
  validateJourneys(journeys);
  const report={checks:[],failures:[],limitations:['AI-proposed source-bound journeys prove their declared cases, not exhaustive product coverage.',database?'Real isolated PostgreSQL/Auth QA; external deployment, token expiry and full production security are not certified.':'Browser-only profile: no backend or real app authentication.'],screenshots:[],unavailable:false};
  const record=(id,passed,details)=>{report.checks.push({id,passed,details});if(!passed)report.failures.push(id+': '+details);};
  const server=createAppServer(database,report);
  let browser;const errors=[];
  try {
    await new Promise(resolve=>server.listen(3000,'127.0.0.1',resolve));
    const {chromium}=require('/runner/node_modules/playwright');browser=await chromium.launch({headless:true});report.browserVersion=browser.version();
    const defaultAccount=database?await database.prepare():null;
    async function pageAt(width,account=defaultAccount) {
      const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
      if(database&&account)await database.inject(context,account);
      await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3000' ? route.continue() : route.abort());
      const page=await context.newPage();page.setDefaultTimeout(2200);
      page.on('pageerror',e=>{if(errors.length<20)errors.push(e.message.slice(0,350));});
      page.on('console',m=>{if(m.type()==='error'&&errors.length<20)errors.push(m.text().slice(0,350));});
      await page.goto('http://127.0.0.1:3000',{waitUntil:'networkidle',timeout:10000});return {context,page};
    }
    let layouts=true, allJourneys=true;
    const boot=await pageAt(1440);
    record('platform:startup',(await boot.page.locator('#root').innerText()).trim().length>0&&errors.length===0,'Compiled React app boots with visible content.');
    await boot.page.evaluate(()=>localStorage.setItem('__dk_isolation_probe__','primary'));
    const other=await pageAt(390);
    record('platform:scope-isolation',await other.page.evaluate(()=>localStorage.getItem('__dk_isolation_probe__'))===null,'Two isolated browser contexts do not share local storage; not server authorization proof.');
    await boot.context.close();await other.context.close();

    // Multi-viewport layout smoke matrix
    const SMOKE_VIEWPORTS=[320,375,430,768,1024,1920];
    let smokeLayouts=true;
    for(const width of SMOKE_VIEWPORTS){
      const smoke=await pageAt(width);
      try{
        const hasOverflow=await smoke.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
        if(hasOverflow){smokeLayouts=false;errors.push(`Horizontal overflow at ${width}px initial render`);}
      }catch(err){errors.push(`Layout smoke error at ${width}px: ${err.message}`);}
      finally{await smoke.context.close();}
    }
    record('platform:layout-smoke-matrix',smokeLayouts,smokeLayouts?'Checked responsive layout across 320px, 375px, 430px, 768px, 1024px, 1920px without overflow.':'Horizontal overflow detected during multi-viewport layout smoke matrix.');

    for(const width of [1440,390]) {
      for(let i=0;i<journeys.length;i++) {
        const account=database?await database.signup('journey-'+width+'-'+i):null;
        const {context,page}=await pageAt(width,account);let failed='';
        try {
          for(const s of journeys[i].steps) {
            if(s.action==='reload'){await page.reload({waitUntil:'networkidle'});continue;}
            if(!s.testId)throw new Error('An action requires a testId.');
            const target=page.getByTestId(s.testId);
            if(s.action==='count') {
              if(!/^\d{1,3}$/.test(s.value))throw new Error('Invalid expected count.');
              const expected=Number(s.value);
              const until=Date.now()+2200;
              const observedCountMatches=async()=>{
                const c=await target.count();
                return matchesCount(c, expected);
              };
              while(!await observedCountMatches()&&Date.now()<until)await page.waitForTimeout(40);
              if(!await observedCountMatches())throw new Error(`Expected count ${expected} at ${s.testId}, found ${await target.count()}`);
              continue;
            }
            if(s.action==='text') {
              await target.waitFor({state:'visible'});
              const observed=async()=>await target.evaluate(element=>
                ['INPUT','TEXTAREA','SELECT'].includes(element.tagName)
                  ? String(element.value||'')
                  : String(element.innerText||element.textContent||''));
              const until=Date.now()+2200;while(!matchesText(await observed(),s.value)&&Date.now()<until)await page.waitForTimeout(40);
              if(!matchesText(await observed(),s.value))throw new Error('Expected visible text or control value '+s.value+' at '+s.testId);continue;
            }
            if(s.action==='fill')await target.fill(s.value);
            else if(s.action==='click')await target.click();
            else if(s.action==='select')await target.selectOption(s.value);
            else if(s.action==='disabled') {
              const until=Date.now()+2200;
              while(!await target.isDisabled()&&Date.now()<until)await page.waitForTimeout(40);
              if(!await target.isDisabled())throw new Error('Expected control '+s.testId+' to be disabled.');
            }
            else if(s.action==='enabled') {
              const until=Date.now()+2200;
              while(await target.isDisabled()&&Date.now()<until)await page.waitForTimeout(40);
              if(await target.isDisabled())throw new Error('Expected control '+s.testId+' to be enabled.');
            }
            else {
              if(await target.getAttribute('type')!=='checkbox')throw new Error('Expected native checkbox.');
              const expected=s.action==='check';if(await target.isChecked()!==expected)await target.click();
              const until=Date.now()+2200;while(await target.isChecked()!==expected&&Date.now()<until)await page.waitForTimeout(40);
              if(await target.isChecked()!==expected)throw new Error('Checkbox state did not persist.');
            }
          }
          if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)){layouts=false;throw new Error('Horizontal overflow after interaction.');}
          if(i===0){const file=`layout-${width}.png`;await page.screenshot({path:path.join(OUT,file)});report.screenshots.push(file);}
        }catch(e){failed=String(e.message).slice(0,900);allJourneys=false;}finally{await context.close();}
        record(`journey:${width}:${i+1}`,!failed,failed||journeys[i].name);
      }
    }
    record('platform:responsive-layout',layouts&&allJourneys,'Visible journeys run at 1440px and 390px without horizontal overflow.');
    record('requirement:application:journeys',allJourneys,'Executed bounded model-proposed UI journeys at both viewport sizes.');
    record('platform:browser-core',allJourneys&&errors.length===0,errors.length?errors.join('; '):'Recorded journeys completed without browser errors. Full product validation still needs user review.');
    if(database)await database.verifyEvidence(record,async(account,item)=>{
      const {context,page}=await pageAt(390,account);
      try{
        const observed=await page.evaluate(async({token,anonKey,table,id})=>{
          const response=await fetch('/supabase/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id)+'&select=*',{headers:{apikey:anonKey,Authorization:'Bearer '+token,'Accept-Profile':'app'}});
          return {status:response.status,data:await response.json()};
        },{token:account.session.access_token,anonKey:config.anonKey,table:item.table,id:item.id});
        const canonical=value=>value&&typeof value==='object'?JSON.stringify(Object.keys(value).sort().map(key=>[key,value[key]])):JSON.stringify(value);
        if(observed.status!==200||!Array.isArray(observed.data)||observed.data.length!==1||canonical(observed.data[0])!==canonical(item.row))throw new Error('Independent browser context did not recover the exact persisted row.');
      }finally{await context.close();}
    });
  }catch(e){record('harness:execution',false,String(e.message).slice(0,1000));}
  finally{if(database?.isUnavailable())report.unavailable=true;if(browser)await browser.close();await new Promise(r=>server.close(r));report.executedAt=new Date().toISOString();await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify(report),{flag:'wx'});}
  if(report.failures.length)process.exitCode=1;
}
module.exports = { validateJourneys, matchesText, matchesCount, createAppServer };
if(require.main===module)main().catch(e=>{console.error(String(e.message).slice(0,2000));process.exitCode=1;});
