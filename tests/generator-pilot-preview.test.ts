import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsPilotStorageMessage, PILOT_PREVIEW_SANDBOX, pilotPreviewDocument, validPilotStorage } from '../src/lib/workspace/pilotPreview';

test('preview storage messages bind to exact run and capability and remain bounded', () => {
  const message = { type: 'dk-v2-storage', runId: 'run-12345678', nonce: 'nonce-123456789012', values: { tasks: '[]' } };
  assert.equal(acceptsPilotStorageMessage(message, message.runId, message.nonce), true);
  assert.equal(acceptsPilotStorageMessage(message, 'other-run', message.nonce), false);
  assert.equal(acceptsPilotStorageMessage(message, message.runId, 'wrong'), false);
  assert.equal(validPilotStorage({ value: 123 }), false);
  assert.equal(validPilotStorage({ value: 'x'.repeat(65536) }), false);
  assert.equal(validPilotStorage(Array(2).fill('x')), false);
});
test('preview contains no external script and escapes embedded closing tags and stored markup', () => {
  const document = pilotPreviewDocument([{ path: 'assets/app.js', content: 'window.value="</script><script>bad()</script>"' }], 'run-12345678', 'nonce-123456789012', { value: '</script>' });
  assert.equal((document.match(/<script /g) || []).length, 2);
  assert.equal((document.match(/<\/script>/g) || []).length, 2);
  assert.ok(document.includes("connect-src 'none'"));
  assert.ok(document.includes('\\u003c/script>'));
  assert.throws(() => pilotPreviewDocument([], 'run-12345678', 'nonce-123456789012', {}), /missing/);
});

test('preview permits local form handlers without same-origin or external form permissions', () => {
  assert.deepEqual(PILOT_PREVIEW_SANDBOX.split(' '), ['allow-scripts', 'allow-forms']);
  const document = pilotPreviewDocument([{ path: 'assets/app.js', content: '/* trusted frame-policy fixture */' }], 'run-12345678', 'nonce-123456789012', {});
  assert.ok(document.includes("form-action 'none'"));
  assert.ok(document.includes("connect-src 'none'"));
  assert.ok(document.includes("frame-src 'none'"));
  assert.ok(!PILOT_PREVIEW_SANDBOX.includes('allow-same-origin'));
  assert.ok(!PILOT_PREVIEW_SANDBOX.includes('allow-top-navigation'));
});
