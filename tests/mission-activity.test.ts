import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorkspace } from "../src/lib/workspace/projectWorkspace";
import { activityText,missionActivityState } from "../src/lib/workspace/missionActivity";
test("activity reflects cancellation even when old events are running",()=>{
  assert.equal(missionActivityState({...createEmptyWorkspace(),status:"FAILED",executionStatus:"cancelled"}),"Cancelled");
});
test("activity reflects repair and final readiness without invented progress",()=>{
  const project={...createEmptyWorkspace(),status:"MEETING_DONE" as const,evidence:[{stage:"recovery",status:"running" as const,at:"2026-09-02",summary:"Recorded issue"}]};
  assert.equal(missionActivityState(project),"Repairing");
  assert.equal(missionActivityState({...project,status:"READY"}),"Ready");
  assert.match(activityText("council","verified").title,/recorded/);
});
