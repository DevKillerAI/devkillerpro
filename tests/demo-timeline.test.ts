import test from 'node:test';
import assert from 'node:assert/strict';
import {getDemoStage, DEMO_DURATION, DEMO_INVITATION_START} from '../src/components/tools/demo-timeline';

test('Invitation remains active for 15 full seconds after the app, before restarting', () => {
  assert.equal(getDemoStage(DEMO_INVITATION_START - 1), 'app');
  for (let ms = 33000; ms < 48000; ms++) assert.equal(getDemoStage(ms), 'cta');
  assert.equal(DEMO_DURATION - DEMO_INVITATION_START, 15000);
  assert.equal(getDemoStage(DEMO_DURATION), 'intro');
});
