import assert from "node:assert/strict";
import test from "node:test";
import { missionNoticeKey, parseDismissedNotices, noticeForProject, noticeEventAt } from "../src/lib/workspace/missionNotice";

test("dismissed mission notices survive refresh while new outcomes remain visible", () => {
  const key = missionNoticeKey("one", "ready", 1, "event-1");
  const persisted = JSON.stringify([key]);
  assert.ok(parseDismissedNotices(persisted).includes(missionNoticeKey("one", "ready", 1, "event-1")));
  for (const next of [missionNoticeKey("two", "ready", 1, "event-1"), missionNoticeKey("one", "failed", 1, "event-1"), missionNoticeKey("one", "ready", 2, "event-2")]) {
    assert.ok(!parseDismissedNotices(persisted).includes(next));
  }
  assert.deepEqual(parseDismissedNotices("broken"), []);
  assert.deepEqual(parseDismissedNotices('{"unexpected":true}'), []);
});
import {
  createEmptyWorkspace,
  mergeProjectCollections,
  type ProjectWorkspace,
} from "../src/lib/workspace/projectWorkspace";

const project = (overrides: Partial<ProjectWorkspace>): ProjectWorkspace => ({
  ...createEmptyWorkspace(),
  projectId: "project-local",
  missionId: "mission-one",
  createdAt: "2026-09-01T00:00:00.000Z",
  status: "GENERATING",
  appTitle: "Local title",
  ...overrides,
});

test("cancelled and inactive missions clear a previous progress notice", () => {
  assert.equal(noticeForProject(project({ executionStatus: "cancelled" })), null);
  assert.equal(noticeForProject(project({ status: "FAILED", executionStatus: "cancelled" })), null);
  assert.equal(noticeForProject(undefined), null);
  assert.equal(noticeForProject(project({ status: "MEETING_DONE" }))?.stage, "build");
  assert.equal(noticeForProject(project({ status: "READY" }))?.stage, "ready");
});

test("progress updates do not revive a dismissed notice", () => {
  const active = project({ evidence: [{ stage: "build", status: "running", at: "later", summary: "Working" }] });
  assert.equal(noticeEventAt(active, "build"), "");
  const ready = project({ evidence: [
    { stage: "build", status: "verified", at: "delivered", summary: "Passed" },
    { stage: "recovery", status: "running", at: "later", summary: "Working" },
  ] });
  assert.equal(noticeEventAt(ready, "ready"), "delivered");
});

test("server status and evidence override stale browser state", () => {
  const local = project({ status: "GENERATING", sourceFiles: [{ name: "local.ts", path: "local.ts", language: "ts", description: "local", content: "local" }] });
  const server = project({ projectId: "mission-one", status: "READY", executionStatus: "verified", evidence: [{ stage: "qa", status: "verified", at: "2026-09-01T01:00:00.000Z", summary: "passed" }], sourceFiles: [{ name: "server.ts", path: "server.ts", language: "ts", description: "server", content: "server" }] });
  const [merged] = mergeProjectCollections([local], [server]);
  assert.equal(merged.projectId, "project-local");
  assert.equal(merged.status, "READY");
  assert.equal(merged.sourceFiles[0].path, "server.ts");
  assert.equal(merged.evidence?.[0].summary, "passed");
});

test("server-only missions are added and sorted newest first", () => {
  const older = project({ missionId: "old", projectId: "old", createdAt: "2026-08-01T00:00:00.000Z" });
  const newer = project({ missionId: "new", projectId: "new", createdAt: "2026-09-01T00:00:00.000Z" });
  assert.deepEqual(mergeProjectCollections([], [older, newer]).map((item) => item.missionId), ["new", "old"]);
});
