import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import { createPilotSourceExport, pilotArtifactDirectory, validateBriefboardSource, verifyBriefboardPilot } from '../src/lib/server/generator/pilotVerifier';
import { inspectWorkbenchRuntime } from '../src/lib/server/generator/workbenchRuntime';

const scope = { ownerId: 'test-owner', projectId: 'test-project', missionId: 'test-mission', environmentId: 'test-preview' };
// A deliberately incomplete rendering fixture, NOT a manually implemented pilot application.
function fixture(app = 'export default function App(){return <main><h1>Compiler fixture</h1></main>}') {
  return createGeneratorSnapshot({ scope, revision: 'r1', files: [
    { path: 'src/App.tsx', content: app }, { path: 'src/styles.css', content: 'body { margin: 0; font-family: system-ui; }' },
  ] });
}

test('pilot rejects extra files and tampered snapshots before running tools', async () => {
  const base = fixture();
  const extra = createGeneratorSnapshot({ scope, revision: 'r1', files: [...base.files, { path: 'package.json', content: '{}' }] });
  assert.throws(() => validateBriefboardSource(extra));
  assert.throws(() => validateBriefboardSource({ ...base, hash: '0'.repeat(64) }));
  await assert.rejects(() => verifyBriefboardPilot({ snapshot: base, outputDirectory: 'C:/Windows' }), /outside this candidate/);
});

test('source export round-trips exact files and records scope and source hash', () => {
  const base = fixture();
  const exported = createPilotSourceExport(base);
  const decoded = JSON.parse(exported.content);
  assert.equal(decoded.sourceHash, base.hash);
  assert.deepEqual(decoded.scope, scope);
  assert.deepEqual(decoded.files, base.files.map(({ path, content }) => ({ path, content })));
  assert.match(exported.hash, /^[a-f0-9]{64}$/);
  const destination = pilotArtifactDirectory(base).replaceAll('\\', '/');
  assert.ok(destination.endsWith(`/test-owner/test-project/test-mission/${base.hash}`));
});

const integration = process.env.DEVKILLER_V2_RUNTIME_INTEGRATION === '1';
test('offline Docker compiles React but the independent browser harness rejects a nonfunctional fixture', { skip: !integration }, async () => {
  const result = await verifyBriefboardPilot({ snapshot: fixture() });
  assert.equal(result.status, 'failed', JSON.stringify(result));
  assert.ok(result.checks.some(check => check.id === 'platform:build' && check.passed));
  assert.ok(result.checks.some(check => check.id === 'platform:startup' && check.passed));
  assert.ok(result.checks.some(check => check.id === 'platform:browser-core' && !check.passed));
  assert.ok(result.compiledFiles.some(file => file.path === 'assets/app.js' && file.content.length > 10000));
  assert.ok(result.browser?.screenshots.includes('layout-390.png'));
  assert.ok(result.limitations.some(message => message.includes('semantic')));
});

test('offline compiler rejects unsupported Node imports and invalid TSX as source failures', { skip: !integration }, async () => {
  for (const source of [
    "import fs from 'node:fs'; export default function App(){return <p>{fs.readFileSync('/etc/passwd','utf8')}</p>}",
    'export default function App(){return <main>broken }',
  ]) {
    const result = await verifyBriefboardPilot({ snapshot: fixture(source) });
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.ok(result.checks.some(check => check.id === 'platform:build' && !check.passed));
    assert.equal(result.compiledFiles.length, 0);
  }
});

test('workbench executes model-declared bounded behavior on desktop and mobile', { skip: !integration }, async () => {
  const runtime = await inspectWorkbenchRuntime();
  assert.equal(runtime.available, true);
  if (!runtime.available) return;
  const snapshot = fixture(`import React,{useState} from 'react';\nexport default function App(){const [count,setCount]=useState(0);return <main><h1>Counter proof</h1><button data-testid="increment" onClick={()=>setCount(value=>value+1)}>Add</button><output data-testid="total">Total: {count}</output></main>}`);
  const result = await verifyBriefboardPilot({
    snapshot, expectedRuntimeImageId: runtime.imageId,
    workbenchJourneys: [{ name: 'Increment counter', steps: [
      { action: 'click', testId: 'increment', value: '' },
      { action: 'text', testId: 'total', value: 'Total: 1' },
    ] }],
  });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.ok(result.checks.some(check => check.id.includes('journey') && check.passed));
  assert.ok(result.checks.some(check => check.id === 'platform:responsive-layout' && check.passed));
});

test('workbench bundles named Lucide SVG icons without network access', { skip: !integration }, async () => {
  const runtime = await inspectWorkbenchRuntime();
  assert.equal(runtime.available, true);
  if (!runtime.available) return;
  const snapshot = fixture(`import React,{useState} from 'react';\nimport {ShoppingBag} from 'lucide-react';\nexport default function App(){const [open,setOpen]=useState(false);return <main><h1>Local icon proof</h1><button data-testid="cart" onClick={()=>setOpen(true)}><ShoppingBag aria-hidden="true"/>Cart</button><output data-testid="state">{open?'Cart open':'Cart closed'}</output></main>}`);
  const result = await verifyBriefboardPilot({
    snapshot, expectedRuntimeImageId: runtime.imageId,
    workbenchJourneys: [{ name: 'Use bundled cart icon', steps: [
      { action: 'click', testId: 'cart', value: '' },
      { action: 'text', testId: 'state', value: 'Cart open' },
    ] }],
  });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.ok(result.checks.some(check => check.id.includes('journey') && check.passed));
});

test('workbench text assertions observe textarea values instead of empty text nodes', { skip: !integration }, async () => {
  const runtime = await inspectWorkbenchRuntime();
  assert.equal(runtime.available, true);
  if (!runtime.available) return;
  const snapshot = fixture(`import React,{useState} from 'react';\nexport default function App(){const [caption,setCaption]=useState('');return <main><label>Caption<textarea data-testid="caption" value={caption} onChange={event=>setCaption(event.target.value)}/></label></main>}`);
  const result = await verifyBriefboardPilot({
    snapshot, expectedRuntimeImageId: runtime.imageId,
    workbenchJourneys: [{ name: 'Edit caption', steps: [
      { action: 'fill', testId: 'caption', value: 'A deliberate caption' },
      { action: 'text', testId: 'caption', value: 'A deliberate caption' },
    ] }],
  });
  assert.equal(result.status, 'passed', JSON.stringify(result));
});
