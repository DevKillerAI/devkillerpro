import test from 'node:test';import assert from 'node:assert/strict';
import {createWorkbenchQualityPlan} from '../src/lib/server/generator/workbenchQuality';
const {selectTarget}=require('../scripts/generator-v2-runner/workbench.cjs');
test('database relation selectors can use observed option labels without guessing UUIDs',()=>{assert.deepEqual(selectTarget('label:Cliente Filtro'),{label:'Cliente Filtro'});assert.equal(selectTarget('pendente'),'pendente');});
test('client management gets an operational layout rather than a generic site recipe',()=>{const p=createWorkbenchQualityPlan('Crie um painel de clientes e tarefas para freelancers','detailed');assert.equal(p.domain,'client-operations');assert.equal(p.visualRecipe.id,'client-operations-desk');assert.ok(p.avoid.includes('decorative metrics or charts without data'));});
