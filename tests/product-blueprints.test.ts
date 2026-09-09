import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_BLUEPRINTS, PRODUCT_SCOPE_POLICY, selectProductBlueprint, REUSABLE_PRODUCT_PATTERNS } from '../src/lib/knowledge/productBlueprints';
import { PRODUCT_VISUAL_REFERENCES } from '../src/lib/knowledge/productVisualReferences';
import { PRODUCT_BLUEPRINT_KNOWLEDGE } from '../src/lib/server/rag/productBlueprintKnowledge';
import { createWorkbenchQualityPlan } from '../src/lib/server/generator/workbenchQuality';
import { preparePilotRequest } from '../src/lib/server/generator/pilotProvider';
import { CERTIFIED_SEED } from '../src/lib/server/rag/seed';

const cases = [
  ['tasks', 'Crie um app de to-do list com prioridades'],
  ['crm', 'Quero um painel de clientes para minha agência'],
  ['erp', 'Crie um SaaS ERP para minha distribuidora'],
  ['finance', 'App de finanças pessoais com orçamento mensal'],
  ['commerce', 'Create an ecommerce store for ceramics'],
  ['scheduling', 'Agenda para agendamentos do salão'],
  ['nutrition', 'Aplicativo de dieta e diário alimentar'],
  ['fitness', 'A workout tracker for my home gym'],
  ['education', 'Uma plataforma de cursos online'],
  ['support', 'Helpdesk para chamados de manutenção'],
  ['knowledge', 'Wiki de procedimentos internos'],
  ['inventory', 'Controle de estoque para peças da oficina']
] as const;

test('twelve explicit app families select functional and inspected visual references', () => {
  assert.equal(PRODUCT_BLUEPRINTS.length, 12);
  for (const [id, brief] of cases) {
    const plan = createWorkbenchQualityPlan(brief, 'simple');
    assert.equal(plan.productBlueprint?.primary?.id, id, brief);
    assert.equal(plan.visualReferences?.[0].family, id);
    assert.equal(plan.visualReferences?.[0].deliveryToModel, 'text-description-not-image');
    assert.ok(plan.productBlueprint!.primary!.coreFlows.length >= 4);
    assert.ok(plan.productBlueprint!.primary!.screens.length >= 3);
  }
});

test('generic UI terms and excluded app families do not select unrelated blueprints', () => {
  for (const brief of ['SaaS com dashboard e menu', 'Site de arquitetura com menu e banco de imagens',
    'Não quero ERP. Quero um cronômetro simples.', 'Without a CRM or ecommerce. Build a calculator.']) {
    assert.equal(selectProductBlueprint(brief).primary, null, brief);
  }
  assert.equal(selectProductBlueprint('Sem ERP, mas quero uma lista de tarefas').primary?.id, 'tasks');
  assert.equal(selectProductBlueprint('App de notas. Não inclua fitness ou dieta.').primary?.id, 'knowledge');
  assert.equal(selectProductBlueprint('Um aplicativo de tarefas para estudos').primary?.id, 'tasks');
  const mixed = selectProductBlueprint('Um ERP com estoque e CRM');
  assert.equal(mixed.primary?.id, 'erp');
  assert.deepEqual(mixed.relatedFamilies, ['inventory', 'crm']);
});

test('blueprints preserve scope, external capability boundaries and preview delivery', () => {
  const narrow = selectProductBlueprint('To-do list somente com título e concluir; sem prioridades');
  assert.equal(narrow.primary?.id, 'tasks');
  assert.ok(PRODUCT_SCOPE_POLICY.some(p => p.includes('explicitly narrow')));
  assert.ok(PRODUCT_SCOPE_POLICY.some(p => p.includes('never create release-blocking checks')));
  assert.ok(PRODUCT_BLUEPRINTS.every(p => p.integrationBoundaries.length > 0 && p.advanced.length > 0));
  assert.equal(REUSABLE_PRODUCT_PATTERNS.length, 6);
});

test('reviewed seed entries and visual provenance cover each family without fabricated images', () => {
  const ids = new Set(CERTIFIED_SEED.map(s => s.id));
  for (const doc of PRODUCT_BLUEPRINT_KNOWLEDGE) assert.ok(ids.has(doc.id));
  assert.equal(PRODUCT_BLUEPRINT_KNOWLEDGE.length, 13);
  assert.equal(PRODUCT_VISUAL_REFERENCES.length, 12);
  for (const ref of PRODUCT_VISUAL_REFERENCES) {
    assert.equal(new URL(ref.sourcePage).protocol, 'https:');
    assert.equal(new URL(ref.imageUrl).protocol, 'https:');
    assert.match(ref.localEvidenceSha256, /^[a-f0-9]{64}$/);
    assert.ok(ref.observations.length >= 2);
  }
});

test('only selected family is sent, with bounded context and no extra model or image calls', () => {
  for (const [, brief] of cases) {
    const qualityPlan = createWorkbenchQualityPlan(brief, 'detailed');
    assert.ok(JSON.stringify(qualityPlan).length < 14500);
    const req = preparePilotRequest({ instructions: 'Build the explicitly requested app.',
      input: JSON.stringify({ brief, qualityPlan }), schemaName: 'fixture',
      schema: {type:'object',additionalProperties:false,properties:{},required:[]}, maxOutputTokens:16000 });
    assert.equal(typeof req.body.input, 'string');
    assert.ok(req.reservedMicros < 450000, `${brief}: ${req.reservedMicros}`);
    assert.deepEqual(req.body.tools, []);
  }
});
