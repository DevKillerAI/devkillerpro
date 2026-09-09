# Healing — Supabase client type-contract recovery

Run: `v2-app-0dd07bd2e070-5e22c39d-6a63-43b2-be82-ba4c084f8e39`.

This is a separate app from the previously recovered Energy healing. The initial Healing source had a syntax error in its profile assignment. Its one AI repair fixed that expression, then semantic verification exposed two platform integration mismatches in `src/lib/supabase.ts`: TS2717 from a duplicate Window property whose schema was `string`, and TS2322 from annotating the app-schema client with the SDK's default public-schema client type. These were not responsive-layout failures. The existing deterministic repair set did not cover them.

## Change

- A single platform settings-type constant supplies the verifier, the generated client example and the local repair.
- The build prompt supplies a complete, validated client initialization with the literal `app` schema and inferred SDK return type.
- Compiler diagnostics trigger bounded AST edits to the conflicting Window property type and unparameterized imported SupabaseClient annotation. Runtime expressions, credentials, auth options, database schemas and application logic remain unchanged.
- Rechecking the actual nine-file Healing candidate reduced its diagnostics from TS2717/TS2322 to zero. The generated JavaScript before and after the type-only repair is identical.
- Other compiler errors remain failures; no casts, `any`, null assertions or disabled checks are introduced.

Local validation: repository typecheck and 15 targeted regression checks passed. Six server regression checks passed before the worker restarted. The previous placeholder-ID protection is retained. Backups and reviewed file hashes are under `/opt/devkiller-releases/client-contract-20260909`.

Recovery reuses the exact failed candidate and provider history, with no new AI requests. Reviewed source-bound journeys exercise independent service creation/readback, profile persistence and appointment creation/readback. Public cross-account booking and provider administration remain declared capability gaps of the private runtime; this recovery does not claim those features are implemented.
