import assert from "node:assert/strict";
import test from "node:test";
import { unfinishedImplementationFailures } from "../src/lib/server/implementationMarkers";

test("Meme Studio browser-only prompt does not acquire authentication or persistence", () => {
  const prompt="Create Meme Studio for users. No login, paid services, or AI integration in this version. Do not claim saved drafts or cloud storage. Clearly indicate that refreshing the page clears the current session. Delivery depth explicitly selected by the user: local_mvp. Data provider explicitly selected: auto. Authentication requirement: auto.";
  assert.equal(selectFoundation(prompt, determineDeliveryProfile(prompt)).provider,"none");
});
test("prose todo is not an executable stub, while explicit stubs report their location", () => {
  assert.deepEqual(unfinishedImplementationFailures([{path:"app.js",content:"const help = 'preserva todo o enquadramento';\n// TODO: improve spacing"}]),[]);
  assert.equal(unfinishedImplementationFailures([{path:"app.js",content:'throw new Error("not implemented");'}]).length,1);
  assert.equal(unfinishedImplementationFailures([{path:"app.js",content:'function run(){throw new Error("not implemented");}'}]).length,1);
  assert.deepEqual(unfinishedImplementationFailures([{path:"app.js",content:'const text = "TODO"; // throw new Error("not implemented")'}]),[]);
  assert.deepEqual(unfinishedImplementationFailures([{path:"index.html",content:'<p>TODO: lista de tarefas</p><script>const label="todo o texto";</script>'}]),[]);
});
import { determineDeliveryProfile } from "../src/lib/server/deliveryProfile";
import {
  foundationKnowledgeExclusions,
  resolveFoundationPlan,
  selectFoundation,
  validateFoundationFiles,
} from "../src/lib/server/foundations/registry";
import { getFoundationTemplates } from "../src/lib/server/foundations/templates";

const select = (mission: string) =>
  selectFoundation(mission, determineDeliveryProfile(mission));

test("inline automatic authentication metadata does not require Supabase",()=>{
  const result=select("Build an image app for users. Delivery depth explicitly selected by the user: local_mvp. Data sensitivity: standard. Data provider explicitly selected: auto. Authentication requirement: auto. Offline expectation: not_required.");
  assert.equal(result.authentication,false);
  assert.equal(result.provider,"sqlite");
});

test('explicit local MVP is not escalated by excluded production terms', () => {
  assert.equal(determineDeliveryProfile('Delivery depth explicitly selected by the user: local_mvp. No production deployment.').tier, 'local_mvp');
});
test('excluded deployment does not escalate an implicit local request', () => {
  assert.equal(determineDeliveryProfile('Create a local notes app. Do not include production deployment.').tier, 'local_mvp');
  assert.equal(determineDeliveryProfile('Create a local notes app. Sem produção ou deployment.').tier, 'local_mvp');
});
test('real benchmark local-MVP wording cannot be escalated by a negative production claim', () => {
  const suffix = 'Build a functional responsive local MVP, not a production claim. English UI.';
  assert.equal(determineDeliveryProfile(`Create VOLT with SQLite. No AI, auth or public deployment required. ${suffix}`).tier, 'local_mvp');
  assert.equal(determineDeliveryProfile(`Create Room Ledger with Supabase. ${suffix}`).tier, 'local_mvp');
  assert.equal(select(`Create VOLT with SQLite persistence. No auth or public deployment required. ${suffix}`).provider, 'sqlite');
  assert.equal(select(`Create Room Ledger with Supabase. ${suffix}`).provider, 'supabase');
});
test('a real production request after a local prototype is not silently downgraded',()=>{
  assert.equal(determineDeliveryProfile('Build a functional local MVP first, then deploy to production.').tier,'production');
  assert.equal(determineDeliveryProfile('Create a notes app, not a production claim.').tier,'local_mvp');
});
test('SQLite persistence survives an unrelated negative database constraint', () => {
  assert.equal(select('Salvar setups em banco local SQLite. Não incluir banco de dados remoto. Delivery depth explicitly selected by the user: local_mvp. Authentication requirement: not_required.').provider, 'sqlite');
});

test("negative Firebase and Supabase constraints select session state", () => {
  const plan = select("Delivery depth explicitly selected by the user: local_mvp. Data provider explicitly selected: auto. Authentication requirement: auto. Não use Firebase, Firestore, Supabase, banco externo ou autenticação. Dados apenas durante a sessão do navegador.");
  assert.equal(plan.provider, "none");
});

test("automatic local persistence selects SQLite", () => {
  assert.equal(select("Delivery depth explicitly selected by the user: local_mvp. Data provider explicitly selected: auto. Authentication requirement: not_required. Persist customer records.").provider, "sqlite");
});

test("commercial persistence and required auth select Supabase", () => {
  const plan = select("Delivery depth explicitly selected by the user: commercial_pilot. Data provider explicitly selected: auto. Authentication requirement: required. Store tenant orders.");
  assert.equal(plan.provider, "supabase");
  assert.equal(plan.authentication, true);
});

test("affirmative Firebase request selects Firebase", () => {
  assert.equal(select("Delivery depth explicitly selected by the user: commercial_pilot. Data provider explicitly selected: firebase. Authentication requirement: required.").provider, "firebase");
});

test("a legacy contradictory council foundation is reconciled", () => {
  const mission = "Delivery depth explicitly selected by the user: prototype. Data provider explicitly selected: none. Authentication requirement: not_required. Do not use Firebase.";
  const recorded = select("Delivery depth explicitly selected by the user: commercial_pilot. Data provider explicitly selected: firebase. Authentication requirement: required.");
  assert.equal(resolveFoundationPlan(mission, determineDeliveryProfile(mission), recorded).provider, "none");
});

for (const provider of ["sqlite", "supabase", "firebase"] as const)
  test(`${provider} certified template satisfies its validator`, () => {
    const mission = `Delivery depth explicitly selected by the user: ${provider === "sqlite" ? "local_mvp" : "commercial_pilot"}. Data provider explicitly selected: ${provider}. Authentication requirement: ${provider === "sqlite" ? "not_required" : "required"}. Persist records.`;
    const failures = validateFoundationFiles(
      select(mission),
      getFoundationTemplates(provider).map(({ path, content }) => ({ path, content })),
    );
    assert.deepEqual(failures, []);
  });

test("provider knowledge exclusions reject every unselected provider", () => {
  const plan = select("Delivery depth explicitly selected by the user: commercial_pilot. Data provider explicitly selected: supabase. Authentication requirement: required.");
  assert.deepEqual(foundationKnowledgeExclusions(plan), ["sqlite", "firebase"]);
});
