import {textOutput,number} from './core';import type {Values} from './options';
export async function textEngine(action:string,text:string,other:string,v:Values,signal:AbortSignal){
 if(text.length+other.length>1000000)throw Error('Text limit: 1 million characters. / Limite: 1 milhão de caracteres.');
 let result='';
 switch(action){
 case 'json':case 'minify':result=JSON.stringify(JSON.parse(text),null,action==='json'?2:undefined);break;
 case 'base64':if(v.mode==='decode'){const binary=atob(text.trim());result=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));}else{const bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));result=btoa(binary);}break;
 case 'url':result=v.mode==='decode'?decodeURIComponent(text):encodeURIComponent(text);break;
 case 'uuid':result=Array.from({length:number(v.count,1,1,1000)},()=>crypto.randomUUID()).join('\n');break;
 case 'hash':result=Array.from(new Uint8Array(await crypto.subtle.digest(v.algorithm||'SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');break;
 case 'jwt':{const parts=text.trim().split('.');if(parts.length!==3)throw Error('Expected a 3-part JWT. / JWT deve ter 3 partes.');const decode=(part:string)=>{const s=part.replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(s.padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0))));};result=JSON.stringify({header:decode(parts[0]),payload:decode(parts[1]),verification:'NOT VERIFIED / NÃO VERIFICADO'},null,2);break;}
 case 'count':result=JSON.stringify({words:text.trim()?text.trim().split(/\s+/u).length:0,characters:Array.from(text).length,lines:text?text.split(/\r\n|\r|\n/).length:0},null,2);break;
 case 'diff':{if(text.length+other.length>100000)throw Error('Diff limit: 100,000 characters. / Limite de comparação: 100.000 caracteres.');const {diffLines}=await import('diff');result=diffLines(text,other,{timeout:1000})?.map(p=>(p.added?'+ ':p.removed?'- ':'  ')+p.value.replace(/\n(?=.)/g,'\n'+(p.added?'+ ':p.removed?'- ':'  '))).join('')||'Comparison timed out. / Tempo de comparação excedido.';break;}
 case 'regex':result=await new Promise<string>((resolve,reject)=>{const worker=new Worker('/tools-assets/regex-worker.js');let ended=false;const stop=()=>{if(ended)return;ended=true;clearTimeout(timer);worker.terminate();signal.removeEventListener('abort',abort);};const abort=()=>{stop();reject(new DOMException('Cancelled','AbortError'));};const timer=setTimeout(()=>{stop();reject(Error('Regex exceeded 1 second. / Regex excedeu 1 segundo.'));},1000);worker.onmessage=e=>{stop();e.data.error?reject(Error(e.data.error)):resolve(JSON.stringify(e.data.matches,null,2));};worker.onerror=()=>{stop();reject(Error('Regex worker failed. / Falha no worker regex.'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)return abort();worker.postMessage({text,pattern:v.pattern,flags:v.flags});});break;
 default:throw Error('Unknown text operation');
 }return [textOutput(result,['json','minify','jwt','count','regex'].includes(action)?'result.json':'result.txt')];
}
