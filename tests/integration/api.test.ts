import assert from "node:assert/strict";
import test from "node:test";

const base = process.env.DEVKILLER_TEST_URL || "http://localhost:3000";

test("mission registry exposes persisted missions without caching", async () => {
  const response = await fetch(`${base}/api/missions`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  const payload = await response.json() as { success: boolean; projects: Array<{ missionId: string }> };
  assert.equal(payload.success, true);
  assert.ok(Array.isArray(payload.projects));
  assert.equal(new Set(payload.projects.map(project => project.missionId)).size, payload.projects.length);
  assert.ok(payload.projects.every(project => typeof project.missionId === 'string' && project.missionId.length > 0));
  const visibleCopy = payload.projects.flatMap((project: any) => [
    project.tagline,
    project.summary,
    project.errorMessage,
    ...(project.deliveryLimitations || []),
    ...(project.evidence || []).map((event: any) => event.summary),
  ]).join(" ");
  assert.doesNotMatch(visibleCopy, /\bsimulat(?:e|ed|ion)\b/i);
});

for (const route of ["/api/deliberate/codegen", "/api/deliberate/meeting"])
  test(`${route} treats malformed JSON as a client error`, async () => {
    const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{broken" });
    assert.equal(response.status, 400);
  });

test("security headers protect the application shell", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.ok(response.headers.get("permissions-policy"));
});
