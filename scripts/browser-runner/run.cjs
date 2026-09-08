const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const root = '/candidate';
const report={version:1,checks:[],failures:[],limitations:['Static browser execution only. No backend, live AI, or external network access.','Passing declared tests is not proof of exhaustive feature coverage.']};
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try {
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const filename=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
    if(!filename.startsWith(root+'/'))throw new Error('Forbidden path');
    const real=await fs.realpath(filename);if(!real.startsWith(root+'/'))throw new Error('Forbidden path');
    res.setHeader('Content-Type',types[path.extname(real)]||'application/octet-stream');
    res.end(await fs.readFile(real));
  } catch {res.statusCode=404;res.end('Not found');}
});
async function main(){
  await new Promise(resolve=>server.listen(3000,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try {
    const freshPage=async()=>{
      const context=await browser.newContext({serviceWorkers:'block'});
      await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:3000'?route.continue():route.abort());
      const page=await context.newPage();page.setDefaultTimeout(4000);
      page.on('pageerror',error=>report.failures.push(`Browser exception: ${error.message.slice(0,500)}`));
      return {context,page};
    };
    let {context,page}=await freshPage();
    const eventually=async(check,message)=>{const deadline=Date.now()+4000;do{if(await check())return;await new Promise(r=>setTimeout(r,50));}while(Date.now()<deadline);throw new Error(message);};
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      await page.setViewportSize(viewport);await page.goto('http://127.0.0.1:3000');
      const metrics=await page.evaluate(()=>({text:document.body.innerText.trim().length,overflow:document.documentElement.scrollWidth>innerWidth+2}));
      const passed=metrics.text>0&&!metrics.overflow;
      report.checks.push({name:`Initial layout ${viewport.width}x${viewport.height}`,passed,metrics});
      if(!passed)report.failures.push(`Empty page or horizontal overflow at ${viewport.width}px`);
      await page.screenshot({path:`/output/layout-${viewport.width}.png`,fullPage:false});
    }
    const contract=JSON.parse(await fs.readFile('/runner/contract.json','utf8'));
    if(!contract.tests.length)report.limitations.push('No declared functional journeys were supplied. Only smoke checks ran.');
    for(const test of contract.tests){
      await context.close();({context,page}=await freshPage());
      await page.setViewportSize(test.viewport||{width:1440,height:900});await page.goto('http://127.0.0.1:3000');
      const steps=[];
      try {
        for(const step of test.steps){
          const locator=step.selector?page.locator(step.selector):null;
          if(step.action==='click')await locator.click();
          else if(step.action==='fill')await locator.fill(step.value);
          else if(step.action==='select')await locator.selectOption(step.value);
          else if(step.action==='reload')await page.reload();
          else if(step.action==='expectText')await eventually(async()=>((await locator.textContent())||'').includes(step.value),`Expected text: ${step.value}`);
          else if(step.action==='expectCount')await eventually(async()=>await locator.count()===step.count,'Unexpected element count');
          else if(step.action==='expectValue')await eventually(async()=>await locator.inputValue()===step.value,'Unexpected input value');
          else if(step.action==='upload'){
            // Trusted synthetic fixture; never read user-selected host paths.
            const fixture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=','base64');
            await locator.setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:fixture});
          } else if(step.action==='download'){
            const downloadPromise=page.waitForEvent('download',{timeout:5000});await locator.click();const download=await downloadPromise;
            const bytes=await fs.readFile(await download.path());
            if(!bytes.length)throw new Error('Empty download');
            if(step.png){if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Not a PNG');
              if(step.width&&bytes.readUInt32BE(16)!==step.width)throw new Error('Unexpected PNG width');
              if(step.height&&bytes.readUInt32BE(20)!==step.height)throw new Error('Unexpected PNG height');}
            steps.push({action:'downloadEvidence',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
          } else throw new Error('Unsupported browser action');
          steps.push({action:step.action,passed:true});
        }
        report.checks.push({name:test.name,passed:true,steps});
      }catch(error){report.checks.push({name:test.name,passed:false,steps,error:error.message});report.failures.push(`${test.name}: ${error.message}`);}
    }
    report.browser=browser.version();await context.close();
  }finally{await browser.close();server.close();}
}
main().catch(error=>report.failures.push(error.message)).finally(async()=>{report.executedAt=new Date().toISOString();await fs.writeFile('/output/report.json',JSON.stringify(report,null,2));process.exit(report.failures.length?1:0);});
