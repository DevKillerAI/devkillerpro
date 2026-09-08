import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchContract, assertWorkbenchContract, assessWorkbenchCapabilities, parseWorkbenchBuild, reconcileWorkbenchGaps, requestedOutputLocale, workbenchRequestSchema, workbenchJourneysSchema, WORKBENCH_INSTRUCTIONS } from '../src/lib/server/generator/workbenchContract';
import { workbenchEditSchema } from '../src/lib/server/generator/workbenchStore';
import { createWorkbenchQualityPlan } from '../src/lib/server/generator/workbenchQuality';

const request = {
  requestId: 'b1da59f0-a35e-4d5a-a904-0ae47b70849d', title: 'Tip Splitter', briefingMode: 'simple' as const,
  prompt: 'Create a local tip calculator with bill, tip and guest fields and visible totals.', localScopeAccepted: true as const,
};

test('workbench contract binds one owner, app, environment, brief and finite budget', () => {
  const contract = createWorkbenchContract('owner-a', request);
  assert.deepEqual(assertWorkbenchContract(contract), { title: request.title, brief: request.prompt });
  assert.equal(contract.identity.ownerId, 'owner-a');
  assert.equal(contract.runtime.id, 'react-workbench');
  assert.equal(contract.budget.maxProviderCalls, 5);
  assert.equal(contract.budget.maxRepairAttempts, 1);
  assert.throws(() => assertWorkbenchContract({ ...contract, identity: { ...contract.identity, ownerId: 'owner-b' } }));
  assert.throws(() => assertWorkbenchContract({ ...contract, budget: { ...contract.budget, maxProviderCalls: 6 } }));
});

test('workbench rejects credentials in briefs and edits before a provider call', () => {
  assert.throws(() => workbenchRequestSchema.parse({ ...request, prompt: `Build this with sk-${'a'.repeat(30)}` }), /secrets/i);
  assert.throws(() => workbenchEditSchema.parse({ runId: 'safe-run', requestId: request.requestId, baseHash: 'a'.repeat(64), prompt: `Use sk-${'b'.repeat(30)}`, scope: 'app' }), /secrets/i);
});

test('supported output requires bounded source and observed browser journeys', () => {
  const output = parseWorkbenchBuild({ status: 'supported', summary: 'A compact calculator.', files: [
    { path: 'src/App.tsx', content: 'export default function App(){return <button data-testid="calculate">Calculate</button>}' },
    { path: 'src/styles.css', content: 'button{color:black}' },
  ], journeys: [{ name: 'Calculate', steps: [
    { action: 'click', testId: 'calculate', value: '' }, { action: 'text', testId: 'calculate', value: 'Calculate' },
  ] }] });
  assert.equal(output.status, 'supported');
  assert.throws(() => parseWorkbenchBuild({ status: 'supported', summary: 'Missing proof', files: output.files, journeys: [{ name: 'No assertion', steps: [
    { action: 'click', testId: 'calculate', value: '' }, { action: 'reload', testId: '', value: '' },
  ] }] }));
  assert.throws(() => workbenchJourneysSchema.parse([{ name: 'Arbitrary code', steps: [
    { action: 'click', testId: 'button > *', value: '' }, { action: 'text', testId: 'result', value: 'ok' },
  ] }]));
});

test('unsupported requirements end explicitly without source or fake integrations', () => {
  const gap={id:'network.product-import',label:'Product import',reason:'Needs protected server access.',fallback:'Use manual editable entry now.'};
  assert.deepEqual(parseWorkbenchBuild({ status: 'needs_input', summary: 'A user choice is required.', files: [], journeys: [], capabilityGaps:[gap] }),
    { status: 'needs_input', summary: 'A user choice is required.', capabilityGaps:[gap] });
  assert.throws(()=>parseWorkbenchBuild({ status:'needs_input',summary:'Blocked too eagerly.',files:[],journeys:[],capabilityGaps:[] }),/must contain gaps/i);
});

test('managed product import remains eligible while unavailable generic services are staged',()=>{
  const plan=assessWorkbenchCapabilities('Cole o link da loja e extraia automaticamente o produto. Se falhar, permita preenchimento manual e localStorage. Não implemente login.');
  assert.deepEqual(plan.deferred,[]);
  assert.ok(plan.available.includes('network.product-import'));
  assert.ok(plan.available.includes('manual.data-entry'));
  assert.match(WORKBENCH_INSTRUCTIONS,/distinguish confirmed incompatibility from insufficient data/i);
  const result=parseWorkbenchBuild({status:'supported',summary:'Usable catalog with protected import and manual fallback.',capabilityGaps:[],files:[
    {path:'src/App.tsx',content:'export default function App(){return <button data-testid="save">Save manually</button>}'},
    {path:'src/styles.css',content:'button{color:black}'},
  ],journeys:[
    {name:'Save a manual item',steps:[{action:'click',testId:'save',value:''},{action:'text',testId:'save',value:'Save'}]},
  ]});
  assert.equal(result.status,'supported');
  assert.equal(result.journeys.length,1);
  assert.deepEqual(assessWorkbenchCapabilities('Upload a photo, analyze it with AI, create captions, and export a meme.').deferred,[]);
  assert.deepEqual(assessWorkbenchCapabilities('Crie o Meme Studio sem login ou autenticação. Gere memes com fotos e legendas sugeridas por IA.').deferred,[]);
  assert.deepEqual(assessWorkbenchCapabilities('Create a meme app without login or authentication.').deferred,[]);
  assert.ok(assessWorkbenchCapabilities('Generate an image with GPT Image.').available.includes('ai.image.generate'));
  assert.deepEqual(reconcileWorkbenchGaps(assessWorkbenchCapabilities('Upload a photo and create a meme.'),[
    {id:'supabase.auth',label:'Invented login',reason:'The model imagined login.',fallback:'No login.'},
    {id:'ai-image-generation',label:'Old image gap',reason:'Old worker profile.',fallback:'Fake image.'},
  ]),[]);
  assert.deepEqual(assessWorkbenchCapabilities('Add a live AI chatbot for customer support.').deferred.map(item=>item.id),['ai.server']);
  assert.ok(!assessWorkbenchCapabilities('Record the payment method after a purchase.').deferred.some(item=>item.id==='payments.provider'));
});

test('tester image AI can be disabled without removing the useful local image workflow',()=>{
  const plan=assessWorkbenchCapabilities('Create a meme editor that uploads photos, suggests AI captions, and generates images.',{managedImageAi:false});
  assert.ok(plan.available.includes('media.local-upload'));
  assert.ok(!plan.available.includes('ai.image.generate'));
  assert.deepEqual(plan.deferred.map(item=>item.id),['ai.image']);
});

test('account image access does not add unused AI capabilities to ordinary visual apps',()=>{
  const ordinary=createWorkbenchContract('owner-a',{requestId:crypto.randomUUID(),title:'Moodprint',prompt:'Create an animated visual fingerprint with gradients and export it as a PNG. No external images.',briefingMode:'simple',localScopeAccepted:true},{managedImageAi:true});
  assert.deepEqual(ordinary.capabilities,['react']);
  assert.ok(!assessWorkbenchCapabilities('Create an animated visual fingerprint with gradients and export it as a PNG.',{managedImageAi:true}).available.includes('ai.image.generate'));
  const generated=createWorkbenchContract('owner-a',{requestId:crypto.randomUUID(),title:'Image studio',prompt:'Generate an image from a text prompt and analyze an uploaded photo.',briefingMode:'simple',localScopeAccepted:true},{managedImageAi:true});
  assert.ok(generated.capabilities.includes('ai.image.generate'));
  assert.ok(generated.capabilities.includes('ai.vision'));
  const foodImages=createWorkbenchContract('owner-a',{requestId:crypto.randomUUID(),title:'Menu',prompt:'Crie um cardápio digital completo com imagens reais dos pratos e carrinho.',briefingMode:'simple',localScopeAccepted:true},{managedImageAi:true});
  assert.ok(foodImages.capabilities.includes('ai.image.generate'));
  const productPhotography=createWorkbenchContract('owner-a',{requestId:crypto.randomUUID(),title:'Mesa Viva',prompt:'Cada produto deve apresentar nome, fotografia, descrição e preço. Inclua demonstrações ilustradas sem buscar imagens externas.',briefingMode:'simple',localScopeAccepted:true},{managedImageAi:true});
  assert.ok(productPhotography.capabilities.includes('ai.image.generate'));
});

test('quality planning changes with the subject and forbids fake photographic media',()=>{
  const restaurant=createWorkbenchQualityPlan('Crie um cardápio digital com fotos dos pratos e pedidos.','simple');
  const finance=createWorkbenchQualityPlan('Create a personal finance dashboard with budgets and transactions.','detailed');
  const engineering=createWorkbenchQualityPlan('Crie um site para uma empresa de engenharia e edifícios comerciais sustentáveis, com portfólio de obras e menu responsivo.','simple');
  const corporateMenu=createWorkbenchQualityPlan('Create a corporate website for a legal practice with a responsive navigation menu.','simple');
  assert.equal(restaurant.domain,'food-hospitality');
  assert.equal(restaurant.media.photographic,true);
  assert.match(restaurant.media.direction,/Never imitate a photograph with CSS circles/i);
  assert.equal(finance.domain,'finance-data');
  assert.equal(engineering.domain,'built-environment');
  assert.match(engineering.artDirection,/architecture, materials, drawings/i);
  assert.notEqual(engineering.visualRecipe.id,restaurant.visualRecipe.id);
  assert.equal(corporateMenu.domain,'corporate-services');
  assert.notEqual(restaurant.artDirection,finance.artDirection);
  assert.ok(finance.depthStandard.length>restaurant.depthStandard.length);
  assert.match(WORKBENCH_INSTRUCTIONS,/ART DIRECTION AND CRAFT/);
});

test('workbench has a larger bounded source envelope than the fixed pilot',()=>{
  const make=(size:number)=>({status:'supported',summary:'A deeper bounded app.',capabilityGaps:[],files:[
    {path:'src/App.tsx',content:'x'.repeat(size)},{path:'src/styles.css',content:'x'},
  ],journeys:[{name:'Observe result',steps:[{action:'click',testId:'save',value:''},{action:'text',testId:'result',value:'Saved'}]}]});
  assert.doesNotThrow(()=>parseWorkbenchBuild(make(48*1024)));
  assert.throws(()=>parseWorkbenchBuild(make(96*1024)));
});

test('explicit app language is recorded in project metadata contracts',()=>{
  assert.equal(requestedOutputLocale('Crie o aplicativo com toda a interface em português brasileiro (pt-BR).'),'pt-BR');
  assert.equal(requestedOutputLocale('Create a polished restaurant menu.'),'en');
  assert.equal(requestedOutputLocale('Crie um aplicativo para organizar pedidos, permitir filtros e salvar os dados no navegador.'),'pt-BR');
  assert.equal(requestedOutputLocale('Crie um aplicativo de pedidos, mas mantenha toda a interface em inglês.'),'en');
});

test('journey parsing preserves original assertions and navigation instead of weakening the plan',()=>{
  const files=[{path:'src/App.tsx',content:'export default function App(){return <input data-testid="coupon-input" placeholder="Cupom"/>}'},{path:'src/styles.css',content:'input{color:black}'}];
  const steps=[{action:'click',testId:'open-cart',value:''},{action:'text',testId:'coupon-input',value:'Cupom'}];
  const result=parseWorkbenchBuild({status:'supported',summary:'Restaurant menu.',capabilityGaps:[],files,journeys:[{name:'Declared assertion',requirementIds:['feature.cart-management'],steps}]});
  assert.notEqual(result.status,'needs_input');if(result.status==='needs_input')return;
  assert.deepEqual(result.journeys[0].steps,steps);
  assert.deepEqual(result.journeys[0].requirementIds,['feature.cart-management']);
});

test('journey parsing rejects a malformed journey even when another journey is valid',()=>{
  const files=[{path:'src/App.tsx',content:'export default function App(){return <button data-testid="save">Save</button>}'},{path:'src/styles.css',content:'button{}'}];
  assert.throws(()=>parseWorkbenchBuild({status:'supported',summary:'Application.',capabilityGaps:[],files,journeys:[
    {name:'Valid path',steps:[{action:'click',testId:'save',value:''},{action:'text',testId:'save',value:'Save'}]},
    {name:'Invalid path',steps:[{action:'click',testId:'save',value:''},{action:'invalid',testId:'save',value:''}]},
  ]}));
});

test('journey identifiers have the same ASCII and length limits as the runner',()=>{
  for(const testId of ['filter-Placa de Vídeo','a'.repeat(81),'button > *']){
    assert.throws(()=>workbenchJourneysSchema.parse([{name:'Rejected target',steps:[{action:'click',testId,value:''},{action:'text',testId:'result',value:'OK'}]}]));
  }
});