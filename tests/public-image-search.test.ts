import test from 'node:test';
import assert from 'node:assert/strict';
import {clearPublicImageSearchCache,searchPublicImage} from '../src/lib/server/publicImageSearch';
import {publicImageBridgeResult} from '../src/lib/workspace/publicImageBridgeProtocol';

const id='54641805-4c02-4018-9f62-e87b778812d4';
const candidate=(thumbnail=`https://api.openverse.org/v1/images/${id}/thumb/`,overrides:Record<string,unknown>={})=>({id,title:'Mushroom dish',creator:'Cook',creator_url:'https://example.com/cook',license:'cc0',license_version:'1.0',license_url:'https://creativecommons.org/publicdomain/zero/1.0/',foreign_landing_url:'https://example.com/work',thumbnail,provider:'openverse',source:'stocksnap',category:'photograph',mature:false,width:1200,height:900,...overrides});

test('public image search returns bounded copied media with provenance and caches it',async()=>{
  clearPublicImageSearchCache();let calls=0;
  const fetcher:typeof fetch=async input=>{calls++;const url=new URL(String(input));return url.pathname.endsWith('/thumb/')
    ?new Response(Buffer.from([0xff,0xd8,0xff,0xd9]),{status:200,headers:{'Content-Type':'image/jpeg','Content-Length':'4'}})
    :Response.json({results:[candidate()]});};
  const first=await searchPublicImage('mushroom restaurant dish',undefined,fetcher),second=await searchPublicImage('mushroom restaurant dish',undefined,fetcher);
  assert.equal(first.license,'CC0');assert.match(first.imageDataUrl,/^data:image\/jpeg;base64,/);assert.equal(first.sourceUrl,'https://example.com/work');assert.deepEqual(second,first);assert.equal(calls,3);
});

test('public image search refuses a thumbnail outside the Openverse proxy',async()=>{
  clearPublicImageSearchCache();const fetcher:typeof fetch=async()=>Response.json({results:[candidate('http://127.0.0.1/private.jpg')]});
  await assert.rejects(searchPublicImage('private image',undefined,fetcher),/No suitable/);
});

test('public image search broadens a styled prompt to its concrete subject',async()=>{
  clearPublicImageSearchCache();const searches:string[]=[];
  const fetcher:typeof fetch=async input=>{const url=new URL(String(input));if(url.pathname.endsWith('/thumb/'))return new Response(Buffer.from([1,2,3]),{status:200,headers:{'Content-Type':'image/webp'}});
    const query=url.searchParams.get('q')||'';searches.push(query);return Response.json({results:query==='risotto'?[candidate()]:[]});};
  const result=await searchPublicImage('creamy risotto vegetable restaurant',undefined,fetcher);
  assert.equal(result.title,'Mushroom dish');assert.ok(searches.includes('risotto'));assert.ok(searches.length<=8);
});

test('public image search rejects wildlife for an architecture request',async()=>{
  clearPublicImageSearchCache();
  const animalId='95bb2a51-2559-491d-a38c-4af6c5941b3b',buildingId='1ae0aee4-462d-4e0f-817a-0c26531a58ca';
  const animal=candidate(`https://api.openverse.org/v1/images/${animalId}/thumb/`,{id:animalId,title:'Common marmoset in Brazil',tags:[{name:'wildlife'},{name:'monkey'},{name:'Brazil'}]});
  const building=candidate(`https://api.openverse.org/v1/images/${buildingId}/thumb/`,{id:buildingId,title:'Sustainable office building',tags:[{name:'architecture'},{name:'commercial'}]});
  const fetcher:typeof fetch=async input=>{const url=new URL(String(input));return url.pathname.endsWith('/thumb/')
    ?new Response(Buffer.from([1,2,3]),{status:200,headers:{'Content-Type':'image/webp'}})
    :Response.json({results:[animal,building]});};
  const result=await searchPublicImage('modern sustainable office building brazil architecture',undefined,fetcher);
  assert.equal(result.title,'Sustainable office building');
});

test('public image search fails closed when only an unrelated subject is available',async()=>{
  clearPublicImageSearchCache();let thumbnailRequests=0;
  const animalId='95bb2a51-2559-491d-a38c-4af6c5941b3b';
  const animal=candidate(`https://api.openverse.org/v1/images/${animalId}/thumb/`,{id:animalId,title:'Common marmoset in Brazil',tags:[{name:'wildlife'},{name:'monkey'},{name:'Brazil'}]});
  const fetcher:typeof fetch=async input=>{const url=new URL(String(input));if(url.pathname.endsWith('/thumb/')){thumbnailRequests++;return new Response(Buffer.from([1]),{headers:{'Content-Type':'image/webp'}});}return Response.json({results:[animal]});};
  await assert.rejects(searchPublicImage('modern sustainable office building brazil architecture',undefined,fetcher),/No suitable/);
  assert.equal(thumbnailRequests,0);
});

test('public image bridge preserves the host identity and flat payload',()=>{
  const result=publicImageBridgeResult('request-1',{success:true,asset:{license:'CC0'}}) as unknown as {type:string;id:string;success:boolean};
  assert.deepEqual({type:result.type,id:result.id,success:result.success},{type:'DEVKILLER_PUBLIC_IMAGE_RESULT',id:'request-1',success:true});
});
