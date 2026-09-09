import test from 'node:test';
import assert from 'node:assert/strict';
const {matchesText,matchesObservation,matchesCount}=require('../scripts/generator-v2-runner/workbench.cjs');
test('TDL visible case and block spacing differences do not block a preview',()=>{
 assert.equal(matchesText('Prepare release notes\nSummarize completed work\nHigh','Prepare release notesSummarize completed workhigh'),true);
 assert.equal(matchesText('Review pull request\nNo notes\nMedium','Review pull requestNo notesmedium'),true);
 assert.equal(matchesText('TAREFA CONCLUÍDA','Tarefa concluída'),true);
});
test('real content and numeric failures remain failures',()=>{
 for(const [actual,expected] of [['Prepare release notes High','Prepare release notesSummarize completed workhigh'],['Task low','Task high'],['150','50'],['1 50','150'],['R$ 500,00','R$ 50,00'],['not saved','saved'],['saved extra record','saved']])assert.equal(matchesText(actual,expected),false);
 assert.equal(matchesCount(3,2),false);
});
test('editable values retain exact case and spacing even when display text tolerates presentation changes',()=>{
 assert.equal(matchesObservation({control:true,value:'Ab C'},'abc'),false);
 assert.equal(matchesObservation({control:true,value:'high'},'High'),false);
 assert.equal(matchesObservation({control:true,value:'high'},'high'),true);
 assert.equal(matchesObservation({control:false,value:'High'},'high'),true);
});
