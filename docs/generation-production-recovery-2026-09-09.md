# Production generation recovery — 9 September 2026

## Verified root causes

1. The Linux worker started at 07:28 UTC; the container UID correction was written at 07:40 UTC. The long-running process retained old code, while the standalone qualification loaded new code. The compiled API was also older than the correction. This explains why standalone qualification passed and user generation still failed with EACCES. Reloading source alone is not deployment.
2. The production RAG schema had no documents. Runtime initialization is intentionally read-only, and the original ingestion command intentionally allows local targets only. Provisioning schema did not populate the corpus. The explicit, project-scoped seed bootstrap installed 56 reviewed documents and 68 chunks, retaining any existing server documents.
3. The client-panel journeys guessed a UUID, selected an empty relation placeholder and tried to prove persistence through a browser requirement binding. The DB validator correctly required actual browser-created records and independently checked server persistence and owner isolation.

## Changes

- Containers run with the dedicated non-root service UID/GID; a real bind-mount read/write probe now runs before provider calls.
- Infrastructure permission/daemon/disk faults are classified as infrastructure unavailability, not application defects to send to a model repair loop.
- Reviewed journey recovery is bound to exact source. Browser requirements cannot be removed. Non-browser requirements remain in the authoritative acceptance contract and are checked independently.
- Selection by visible label is supported for dynamic database UUID values. Generation instructions require real relation selection, stable row targets and meaningful positive/negative filter assertions.
- RAG readiness checks reject an empty corpus before generation. Default production retrieval uses BM25 over reviewed chunks with exact provenance and no paid query-embedding calls. Semantic embeddings remain an explicit optional configuration, not a claim about the active backend.
- Client-management briefs get a purpose-built operational layout specification. Existing functional apps can receive a bounded CSS refinement while preserving approved source and SQL.
- Preview publication emits exact individual hostname blocks from registered, inspected containers. It uses no wildcard hostnames or on-demand TLS. Access remains signed and short-lived, on separate origins.

## Evidence

- ClientPanel recovered to ready, source hash 3100f1486f47c3c83757ebda0ce997cd62fe76673b63871f42245bd80a72f9ea. All required checks passed. Recovery retained the original 2 provider calls and USD 0.169040 settled cost.
- RAG evaluation: 9/9 existing development cases, recall@3 1.0. This is a known development dataset, not an independent aesthetic or production-success score.
- Targeted tests cover infrastructure fault classification, immutable reviewed-journey binding, requirement retention, dynamic relation selection, client-domain art direction and retrieval governance.
- HTTPS ClientPanel signup was exercised through a separate QA account. The approved candidate remains available during subsequent refinements.

## Deployment invariants

After updating worker source, restart the worker. After updating Next API code or public environment variables, build and restart/redeploy the corresponding application. Confirm service start/build timestamps are later than the installed patch. Do not infer deployment from a Git push alone.

Never turn failed authorization, persistence, concurrency or functional checks into passes to produce a preview. Aesthetic judgment requires rendered review; no automatic score of 9/10 or 100% reliability is certified by these checks.

## Final refinement and delivery policy

- CSS refinement consumed six audited RAG chunks. Final accepted ClientPanel source is `e983ccfeecdcb6e167ee2a89d6bb6f04f1b1588faa3bd10c770e56d16e7d587d`, revision `session-read-recovery-1`. All executed checks passed. Total settled cost is USD 0.267671 across three provider calls; deterministic recovery added no provider call.
- The CSS-only candidate first encountered one HTTP 401 on the initial client-list read; subsequent reads and database tests succeeded. Eight independent signup/read probes did not reproduce it. The exact upstream cause is not established. Recovery refreshes the session once and retries reads once, never writes; unresolved HTTP failures still fail verification.
- Exact-host HTTPS availability is checked before returning a new preview address. Retired preview containers no longer prevent unrelated approved hosts from publishing.
- Retrieval excludes canvas/creative-studio references for operational applications. Three actual operational queries each retrieved six eligible chunks without paid embeddings. Active retrieval remains lexical BM25, not semantic/hybrid search.
- User priority is working delivery over cosmetic perfection. Runner layout checks now distinguish minor overflow (more than 2px and at most 16px, no clipped visible controls) as a refinement notice. Severe overflow and clipped visible controls block. Layout results are independent from functional journey results. Failed functional evidence is never rewritten into success by the old broad agile-promotion branch.
- The 18 focused regression tests passed, including actual reload evidence for claimed local persistence, RAG provenance, network recovery, layout severity and full-stack failure retention. Publication-clone TypeScript check passed.
- The refined approved HTTPS app was opened in the browser with an independent QA account; client creation and a linked task were exercised. These records belong only to the QA account. Full platform UI testing in the user's account still requires their active session; no password reset or impersonated session was used.
