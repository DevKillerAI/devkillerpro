# Energy healing — recovery of test defects

Run: `v2-app-0dd07bd2e070-24da172d-6049-4076-841a-d7ce24726645`.

The failed `repair-1` candidate had passed compilation, startup, responsive layout (320–1920px), real authentication, persistence and cross-owner isolation. Its browser journeys used invented `session-title-placeholder` and `session-row-placeholder` IDs for elements whose IDs contained server UUIDs. A second journey also assumed a record from another journey, despite the harness giving each journey a fresh account.

Recovery changed only three test attributes in SessionList and reviewed the journeys against the exact source. Each journey now creates its own record. Browser checks exercise create, reload, exact persisted fields, edit and filter. Original failure evidence and usage history are retained.

The recovered revision `stable-session-journeys-1`, source hash `34a0beb129f9dc5de663afb10f0942a0e4b245a754563b1927001fe4be2d9687`, is ready in the owner's project list. All 33 delivery checks passed. Usage remained 154796 micro-USD and two original provider calls: recovery made no additional AI calls. This verifies the declared workflows, not exhaustive product coverage.

## Prevention

Before verification, a bounded AST transform converts an unambiguous object-ID test attribute referenced by a `-placeholder` selector into a stable collection hook. It preserves actions, counts, expected text, application logic and database IDs. Mixed explicit IDs, ambiguous declarations and conflicting hooks are not rewritten. Strict browser locator checks remain active. Source changes receive a new immutable snapshot/hash and an event recording the mapping.

Remaining unresolved dynamic placeholders are classified as test defects. Build instructions explicitly require independent setup inside every journey. This setup instruction reduces recurrence but is not a general automatic reconstruction of arbitrary test fixtures.

Local validation: typecheck and 14 regression checks passed, including preservation of real content failures and the existing nonblocking treatment of minor visual differences. Production deployment uses reviewed before/after hashes and a backup under `/opt/devkiller-releases/session-targets-20260909`.
