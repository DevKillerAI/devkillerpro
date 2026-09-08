import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validOperatorEvidence} from '../src/lib/server/operatorBrowserEvidence';
test('operator evidence cannot approve changed, expired, future or failed candidates',()=>{
 const now=Date.now(),data={candidateHash:'hash',passed:true,method:'operator-browser',at:new Date(now).toISOString(),checks:['Sign-in'],limitations:[]};
 assert.equal(validOperatorEvidence(data,'hash',now),true);
 assert.equal(validOperatorEvidence(data,'different',now),false);
 assert.equal(validOperatorEvidence(data,'hash',now+86400001),false);
 assert.equal(validOperatorEvidence(data,'hash',now-1),false);
 assert.equal(validOperatorEvidence({...data,passed:false},'hash',now),false);
 assert.equal(validOperatorEvidence({...data,checks:[]},'hash',now),false);
});
