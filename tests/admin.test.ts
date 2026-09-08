import test from 'node:test';
import assert from 'node:assert/strict';
import { policyRole,policySchema } from '../src/lib/admin/modelPolicy';
test('Luna product route is separate from technical specialists and final decision',()=>{
 assert.equal(policyRole('consultant_product'),'product');
 assert.equal(policyRole('consultant_contribution'),'specialists');
 assert.equal(policyRole('council_decision'),'decision');
 assert.equal(policyRole('functional_qa_review'),'qa');
 assert.equal(policySchema.safeParse({product:'gpt-image-2'}).success,false);
});
import { ownerAdminAllowed,cacheEstimate } from '../src/lib/admin/metrics';
import { isSameOriginRequest } from '../src/lib/server/requestOrigin';
test('only configured owner administrator can access administration',()=>{
 assert.equal(ownerAdminAllowed('admin','owner@example.com','owner@example.com'),true);
 assert.equal(ownerAdminAllowed('tester','owner@example.com','owner@example.com'),false);
 assert.equal(ownerAdminAllowed('admin','other@example.com','owner@example.com'),false);
 assert.equal(ownerAdminAllowed('admin','owner@example.com',undefined),false);
 assert.equal(ownerAdminAllowed('admin','owner@example.com','owner@example.com',true),false);
});
test('cache estimates require evidence and include write overhead',()=>{
 assert.equal(cacheEstimate(100,null,0),null);
 assert.equal(cacheEstimate(100,100,null),null);
 assert.equal(cacheEstimate(0,0,0),null);
 assert.equal(cacheEstimate(100,80,50),null);
 assert.equal(cacheEstimate(100,0,100)?.percent,-25);
 assert.equal(cacheEstimate(100,100,0)?.percent,90);
});
test('same-origin protection supports trusted HTTPS reverse proxies',()=>{
 const direct=new Request('http://127.0.0.1:3000/api/auth/login',{headers:{origin:'http://127.0.0.1:3000'}});
 const proxied=new Request('http://127.0.0.1:3000/api/auth/login',{headers:{origin:'https://devkiller.example.ts.net','x-forwarded-host':'devkiller.example.ts.net','x-forwarded-proto':'https'}});
 const foreign=new Request('http://127.0.0.1:3000/api/auth/login',{headers:{origin:'https://evil.example','x-forwarded-host':'devkiller.example.ts.net','x-forwarded-proto':'https'}});
 assert.equal(isSameOriginRequest(direct),true);
 assert.equal(isSameOriginRequest(proxied),true);
 assert.equal(isSameOriginRequest(foreign),false);
});
