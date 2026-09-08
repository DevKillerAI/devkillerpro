import test from "node:test";
import assert from "node:assert/strict";
import { canSaveIdeWorkspace, createIdeDrafts, dirtyIdePaths, editIdeDraft, reconcileIdeDrafts, resolveIdeDraft } from "../src/lib/workspace/ideDrafts";

const file = (path: string, content: string) => ({ path, content, name: path.split("/").at(-1)! });
const content = (state: ReturnType<typeof createIdeDrafts>, path: string) => state.drafts.find(item => item.path === path)?.content;

test("saving requires explicit matching project and mission identities", () => {
  const displayed = { projectId: "project-a", missionId: "mission-a" };
  assert.equal(canSaveIdeWorkspace(displayed, { ...displayed }), true);
  assert.equal(canSaveIdeWorkspace(undefined, displayed), false);
  assert.equal(canSaveIdeWorkspace(displayed, null), false);
  assert.equal(canSaveIdeWorkspace({}, {}), false);
  assert.equal(canSaveIdeWorkspace({ projectId: " " }, { projectId: " " }), false);
  assert.equal(canSaveIdeWorkspace(displayed, { ...displayed, projectId: "project-b" }), false);
  assert.equal(canSaveIdeWorkspace(displayed, { ...displayed, missionId: "mission-b" }), false);
});

test("legacy projects without mission IDs can save only when both sides agree", () => {
  const legacy = { projectId: "legacy-a" };
  assert.equal(canSaveIdeWorkspace(legacy, { ...legacy }), true);
  assert.equal(canSaveIdeWorkspace(legacy, { projectId: "legacy-b" }), false);
  assert.equal(canSaveIdeWorkspace(legacy, { ...legacy, missionId: "new-mission" }), false);
  assert.equal(canSaveIdeWorkspace({ ...legacy, missionId: "new-mission" }, legacy), false);
  assert.equal(canSaveIdeWorkspace({ ...legacy, missionId: "" }, { ...legacy, missionId: "" }), true);
  assert.equal(canSaveIdeWorkspace(legacy, { ...legacy, missionId: "" }), true);
  assert.equal(canSaveIdeWorkspace({ ...legacy, missionId: " " }, { ...legacy, missionId: " " }), false);
});

test("identical polling preserves each unsaved draft and incorporates new files", () => {
  const original = [file("a/index.ts", "one"), file("b/index.ts", "two")];
  let state = editIdeDraft(createIdeDrafts(original), "a/index.ts", "local");
  state = reconcileIdeDrafts(state, [...original, file("new.ts", "new")]);
  assert.equal(content(state, "a/index.ts"), "local");
  assert.equal(content(state, "b/index.ts"), "two");
  assert.equal(content(state, "new.ts"), "new");
  assert.deepEqual([...dirtyIdePaths(state)], ["a/index.ts"]);
  assert.deepEqual(state.conflicts, []);
  assert.equal(original[0].content, "one", "Never mutate parent snapshots");
});

test("untouched files accept incoming changes and deletions without disturbing other drafts", () => {
  let state = createIdeDrafts([file("a", "one"), file("b", "two"), file("c", "three")]);
  state = editIdeDraft(state, "a", "local");
  state = reconcileIdeDrafts(state, [file("a", "one"), file("b", "updated")]);
  assert.equal(content(state, "a"), "local");
  assert.equal(content(state, "b"), "updated");
  assert.equal(content(state, "c"), undefined);
  assert.deepEqual(state.conflicts, []);
});

test("same-file concurrent changes stay conflicted across repeated polling", () => {
  let state = editIdeDraft(createIdeDrafts([file("a", "base")]), "a", "local");
  state = reconcileIdeDrafts(state, [file("a", "remote")]);
  state = reconcileIdeDrafts(state, [file("a", "remote")]);
  assert.equal(content(state, "a"), "local");
  assert.deepEqual(state.conflicts, [{ path: "a", kind: "changed" }]);
});

test("accepting incoming content is explicit and clears dirty state", () => {
  const initial = editIdeDraft(createIdeDrafts([file("a", "base")]), "a", "local");
  const conflicted = reconcileIdeDrafts(initial, [file("a", "remote")]);
  const resolved = resolveIdeDraft(conflicted, "a", "incoming");
  assert.equal(content(resolved, "a"), "remote");
  assert.equal(dirtyIdePaths(resolved).size, 0);
  assert.deepEqual(resolved.conflicts, []);
  assert.equal(content(conflicted, "a"), "local", "Do not mutate previous state");
});

test("keeping a local edit is explicit; another incoming change requires another decision", () => {
  let state = editIdeDraft(createIdeDrafts([file("a", "base")]), "a", "local");
  state = resolveIdeDraft(reconcileIdeDrafts(state, [file("a", "remote")]), "a", "local");
  state = reconcileIdeDrafts(state, [file("a", "remote")]);
  assert.equal(content(state, "a"), "local");
  assert.deepEqual([...dirtyIdePaths(state)], ["a"]);
  assert.deepEqual(state.conflicts, []);
  state = reconcileIdeDrafts(state, [file("a", "new remote")]);
  assert.deepEqual(state.conflicts, [{ path: "a", kind: "changed" }]);
});

test("incoming deletion never loses an unsaved file and persists as a conflict", () => {
  let state = editIdeDraft(createIdeDrafts([file("a", "base")]), "a", "local");
  state = reconcileIdeDrafts(reconcileIdeDrafts(state, []), []);
  assert.equal(content(state, "a"), "local");
  assert.deepEqual(state.conflicts, [{ path: "a", kind: "removed" }]);
  const accepted = resolveIdeDraft(state, "a", "incoming");
  assert.deepEqual(accepted.drafts, []);
  assert.deepEqual(accepted.conflicts, []);
  const kept = reconcileIdeDrafts(resolveIdeDraft(state, "a", "local"), []);
  assert.equal(content(kept, "a"), "local");
  assert.deepEqual(kept.conflicts, []);
});

test("incoming content matching the local edit acknowledges it without a false conflict", () => {
  let state = editIdeDraft(createIdeDrafts([file("a", "base")]), "a", "local");
  state = reconcileIdeDrafts(state, [file("a", "local")]);
  assert.equal(dirtyIdePaths(state).size, 0);
  assert.deepEqual(state.conflicts, []);
});

test("reverting a draft to current incoming content clears that file's conflict only", () => {
  let state = createIdeDrafts([file("a", "base"), file("b", "base")]);
  state = editIdeDraft(editIdeDraft(state, "a", "mine"), "b", "mine");
  state = reconcileIdeDrafts(state, [file("a", "theirs"), file("b", "theirs")]);
  state = editIdeDraft(state, "a", "theirs");
  assert.deepEqual(state.conflicts, [{ path: "b", kind: "changed" }]);
  assert.deepEqual([...dirtyIdePaths(state)], ["b"]);
});

test("a clean renamed file follows the incoming snapshot; an edited old path is retained", () => {
  const clean = createIdeDrafts([file("old", "base")]);
  assert.deepEqual(reconcileIdeDrafts(clean, [file("renamed", "base")]).drafts.map(item => item.path), ["renamed"]);
  const dirty = editIdeDraft(clean, "old", "local");
  const reconciled = reconcileIdeDrafts(dirty, [file("renamed", "base")]);
  assert.deepEqual(reconciled.drafts.map(item => item.path), ["renamed", "old"]);
  assert.deepEqual(reconciled.conflicts, [{ path: "old", kind: "removed" }]);
});
