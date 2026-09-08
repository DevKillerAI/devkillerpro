import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyPreviewNonce } from '../src/lib/workspace/previewPolicy';
import { terminalPipelineOutcome } from '../src/lib/server/jobs/pipelineOutcome';
import { imageBridgeResult, visionBridgeNeedsConfirmation } from '../src/lib/workspace/imageBridgeProtocol';
import {productBridgeResult} from '../src/lib/workspace/productBridgeProtocol';

test('image bridge supports flat and nested results without allowing identity overrides',()=>{
  const payload={success:true,imageDataUrl:'data:image/png;base64,test',type:'wrong',id:'wrong'};
  const result=imageBridgeResult('DEVKILLER_IMAGE_RESULT','expected',payload);
  assert.equal(result.type,'DEVKILLER_IMAGE_RESULT');
  assert.equal(result.id,'expected');
  assert.equal((result as {imageDataUrl?:string}).imageDataUrl,payload.imageDataUrl);
  assert.equal(result.data,payload);
});

test('owner test-phase image generation uses the explicit Generate click as authorization',()=>{
  assert.equal(visionBridgeNeedsConfirmation('DEVKILLER_IMAGE_REQUEST'),false);
  assert.equal(visionBridgeNeedsConfirmation('DEVKILLER_VISION_REQUEST'),true);
  assert.equal(visionBridgeNeedsConfirmation('DEVKILLER_PRODUCT_IMPORT_REQUEST'),true);
});

test('product bridge fixes the operation identity supplied by the host',()=>{
  const payload={success:true,product:{name:'GPU'},type:'wrong',id:'wrong'};
  const result=productBridgeResult('expected',payload);
  assert.equal(result.type,'DEVKILLER_PRODUCT_IMPORT_RESULT');
  assert.equal(result.id,'expected');
  assert.equal((result as {product?:{name:string}}).product?.name,'GPU');
});

test('reconnect preserves terminal outcomes but can resume interrupted polling',()=>{
  assert.equal(terminalPipelineOutcome(502,{success:false,error:'Recovery attempts exhausted: invalid artifact'}),true);
  assert.equal(terminalPipelineOutcome(502,{success:false,error:'VERIFICATION_REQUIRED: no build runtime'}),true);
  assert.equal(terminalPipelineOutcome(200,{success:true}),true);
  assert.equal(terminalPipelineOutcome(502,{success:false,error:'PROVIDER_POLL_INTERRUPTED: saved response'}),false);
  assert.equal(terminalPipelineOutcome(409,{success:false,code:'PIPELINE_BUSY'}),false);
});

const migration = readFileSync(
  "supabase/migrations/20260901160000_devkiller_core.sql",
  "utf8",
);
const queue = readFileSync("src/lib/server/jobs/queue.ts", "utf8");
const familyAccessMigration=readFileSync('supabase/migrations/20260903190000_family_remote_access.sql','utf8');
const middleware=readFileSync('src/middleware.ts','utf8');
const loginPage=readFileSync('src/app/login/page.tsx','utf8');
const familyAccessApi=readFileSync('src/app/api/admin/members/route.ts','utf8');

test("durable queue migration enforces ownership and private artifacts", () => {
  assert.match(migration, /alter table public\.missions enable row level security/i);
  assert.match(migration, /revoke all on public\.mission_jobs from anon, authenticated/i);
  assert.match(migration, /'mission-artifacts', 'mission-artifacts', false/i);
  assert.doesNotMatch(migration, /create policy[^;]+mission_jobs[^;]+to anon/is);
});

test("workers claim one job atomically and recover expired leases", () => {
  assert.match(queue, /for update skip locked/i);
  assert.match(queue, /lease_expires_at < now\(\)/i);
  assert.match(queue, /status = \$\{retry \? "retrying" : "failed"\}/i);
});

test("active mission jobs cannot be duplicated", () => {
  assert.match(migration, /unique index mission_jobs_active_mission_idx/i);
  assert.match(migration, /where status in \('queued', 'running', 'retrying'\)/i);
});

test('preview bundles work with a nonce without enabling network or changing exported source', () => {
  const source = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'"><style>body{color:red}</style><script>console.log(1)</script>`;
  const nonce = 'a'.repeat(32);
  const preview = applyPreviewNonce(source, nonce);
  assert.ok(preview.includes(`script-src 'self' 'nonce-${nonce}'`));
  assert.ok(preview.includes("connect-src 'none'"));
  assert.ok(preview.includes(`<script nonce="${nonce}">`));
  assert.ok(!source.includes('nonce-'));
  assert.equal(applyPreviewNonce(source, 'invalid'), source);
});

test('remote tester access is centrally revocable and login stays same-origin',()=>{
  assert.match(familyAccessMigration,/access_enabled boolean not null default true/i);
  assert.match(familyAccessMigration,/generation_budget_micros bigint/i);
  assert.match(middleware,/profile\?\.access_enabled===false/);
  assert.match(loginPage,/fetch\("\/api\/auth\/login"/);
  assert.doesNotMatch(loginPage,/createBrowserClient/);
  assert.match(familyAccessApi,/Cut connection|access_disabled/i);
  assert.match(familyAccessApi,/cancelPilotRun/);
});
