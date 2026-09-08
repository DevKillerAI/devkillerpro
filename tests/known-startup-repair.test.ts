import {test} from 'node:test';
import assert from 'node:assert/strict';
import {knownStartupRepair} from '../src/lib/server/knownStartupRepair';
test('only executed exact SQLite startup failure receives a deterministic plan',()=>{
 assert.equal(knownStartupRepair(['User says Cannot add a UNIQUE column']),null);
 assert.equal(knownStartupRepair(['Isolated backend tests failed: Backend did not become ready.']),null);
 const plan=knownStartupRepair(['Isolated backend tests failed: Backend did not become ready. State: exited; exit: 1\nError: Cannot add a UNIQUE column']);
 assert.ok(plan);assert.match(plan.repairInstructions.join(' '),/Preserve the intended uniqueness/);
});
