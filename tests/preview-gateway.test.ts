import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {issue,verify}=createRequire(import.meta.url)('../scripts/preview-gateway.cjs');
import {validPreviewAddress} from '../src/lib/workspace/previewAddress';
test('browser accepts only configured isolated preview origins',()=>{
 const value='https://dkp-'+ 'a'.repeat(24)+'.preview.example/__dk_access?token=abc.def';
 assert.equal(validPreviewAddress(value,'preview.example'),true);
 for(const altered of [value.replace('https:','http:'),value.replace('preview.example','preview.example.evil.test'),value+'&next=https://evil.test',value.replace('/__dk_access','/'),value.replace('https://','https://user:password@')])assert.equal(validPreviewAddress(altered,'preview.example'),false);
 assert.equal(validPreviewAddress(value,undefined),false);
});
test('preview capabilities are signed, short-lived and bound to exactly one app origin',()=>{
 const secret='test-secret-only-'.repeat(4),host='dkp-abc.test.example',key='a'.repeat(64),now=1000000,token=issue(host,key,secret,now);
 assert.equal(verify(token,host,key,secret,now),true);
 for(const args of [[token,'other.test.example',key,secret,now],[token,host,'b'.repeat(64),secret,now],[token,host,key,'different-key',now],[token,host,key,secret,now+900001],[token+'x',host,key,secret,now]])assert.equal(verify(...args),false);
 assert.equal(verify(token+'.suffix',host,key,secret,now),false);
});
