/** Exact executed SQLite diagnostic, not a guess from the user's prompt or RAG. */
export function knownStartupRepair(problems:string[]){
 if(problems.some(p=>p.startsWith('Runtime CSP contract: inline event handlers'))){
  return {coreOutcomes:['Preserve all requested workflows and preview security.'],repairInstructions:['Move all inline HTML event handlers and handlers in dynamically generated markup into the external JavaScript file using addEventListener or delegated data-action handlers. Preserve each button, form and input behavior. Do not loosen CSP. Test New setup, save, editing and duplication in the browser after startup.','Also fix each reported JavaScript syntax error in the same minimal patch. Never fabricate base64 images; use a valid existing asset or an honestly labelled code-native demo illustration. Do not redesign or rewrite unrelated business logic.'],deferredCapabilities:[],rationale:'The runtime enforces default-src self. Inline event attributes cannot execute under this policy; external scripts are already supported. This is a runtime-contract correction, not a request to redesign the app.'};
 }
 const failures=problems.filter(p=>p.startsWith('Isolated backend tests failed:'));
 if(failures.length!==1||!failures[0].includes('Backend did not become ready. State: exited;')||!failures[0].includes('Error: Cannot add a UNIQUE column'))return null;
 return {
  coreOutcomes:['Preserve all explicitly requested user workflows and existing healthy source. Restore a verifiably starting SQLite application before further functional review.'],
  repairInstructions:[
   'Fix only the executed migration/startup defect first. SQLite ALTER TABLE ADD COLUMN cannot add a UNIQUE constraint. Find the failing migration; use an appropriate separate unique index after adding/backfilling the column, or a documented transactional table rebuild when required. Preserve the intended uniqueness semantics and existing records. Do not drop the constraint simply to pass startup.',
   'Test migration on an empty database and on existing records; test duplicate rejection and restart. Keep other working application files unchanged unless directly required. Do not report full application completion from migration success alone.',
  ],deferredCapabilities:[],rationale:'Executed SQLite startup reported Cannot add a UNIQUE column. Use the reviewed SQLite ALTER TABLE repair procedure; no paid diagnostic planning call is necessary. Source: https://www.sqlite.org/lang_altertable.html',
 };
}
