import type { DeliveryProfile } from "@/lib/server/deliveryProfile";

export type DataProvider = "none" | "sqlite" | "supabase" | "firebase";

export interface FoundationPlan {
  id: string;
  provider: DataProvider;
  label: string;
  reason: string;
  persistent: boolean;
  authentication: boolean;
  requiredArtifacts: string[];
  requiredEnvironment: string[];
  securityGates: string[];
  verificationCommands: string[];
  officialSources: string[];
}

type ExplicitProvider = DataProvider | "auto" | undefined;

function explicitProvider(text: string): ExplicitProvider {
  return text
    .match(
      /Data provider explicitly selected:\s*(auto|none|sqlite|supabase|firebase)/i,
    )?.[1]
    ?.toLowerCase() as ExplicitProvider;
}

function explicitlyProhibits(text: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:\\b(?:no|not|never|without|avoid|forbid(?:den)?|prohibit(?:ed)?)\\b|\\b(?:n[aã]o|sem|evite|proib(?:ir|ido|ida))\\b)[^.!?\\n]{0,90}\\b${escaped}\\b|\\b${escaped}\\b\\s+(?:(?:is|are)\\s+)?(?:not\\s+(?:required|allowed|requested)|forbidden|prohibited|n[aã]o\\s+(?:é\\s+)?(?:necess[aá]rio|permitido)|proibido|proibida)\\b`,
    "i",
  ).test(text);
}

function sessionOnlyRequested(text: string) {
  return /(?:session[- ]only|browser[- ]local|refresh(?:ing)? (?:the page )?clears? (?:the )?(?:current )?session|during the (?:current )?(?:browser )?session|apenas (?:na|durante a) sess[aã]o|durante a sess[aã]o (?:atual )?do navegador|dados? (?:fict[ií]cios?|de demonstra[cç][aã]o))/i.test(
    text,
  );
}

function positiveProviderMention(text: string, provider: "supabase" | "firebase") {
  return new RegExp(`\\b${provider}\\b`, "i").test(text) && !explicitlyProhibits(text, provider);
}

const asksForPersistence = (text: string) =>
  /\b(database|banco|persist[eê]ncia|persistir|save|store|records?|clientes?|appointments?|agendamentos?|orders?|pedidos?|inventory|estoque|crm|users?|usu[aá]rios?)\b/i.test(
    text,
  );
const asksForAuth = (text: string) =>
  /\b(authentication|auth|login|sign[ -]?in|conta|senha|password|permissions?|roles?|rbac|multi[ -]?tenant|organizations?|equipe|team members?)\b/i.test(
    text,
  );

export function selectFoundation(
  mission: string,
  profile: DeliveryProfile,
): FoundationPlan {
  const selected = explicitProvider(mission);
  const missionRequest = mission
    .replace(/Data provider explicitly selected:\s*(auto|none|sqlite|supabase|firebase)\.?/gi, "")
    .replace(/Authentication requirement:\s*(not_required|required|auto)\.?/gi, "");
  const authForbidden = explicitlyProhibits(missionRequest, "authentication") ||
    explicitlyProhibits(missionRequest, "login") ||
    explicitlyProhibits(missionRequest, "auth") ||
    /(?:n[aã]o|sem) (?:implemente? |usar? )?(?:autentica[cç][aã]o|login)/i.test(missionRequest);
  const auth = !authForbidden && (
    /Authentication requirement:\s*required/i.test(mission) ||
    (!/Authentication requirement:\s*(?:not_required|not required)/i.test(
      mission,
    ) &&
      asksForAuth(missionRequest)));
  const databaseForbidden =
    explicitlyProhibits(missionRequest, "database") ||
    explicitlyProhibits(missionRequest, "banco de dados") ||
    /(?:n[aã]o|sem) (?:implemente? |usar? )?(?:banco(?: de dados)?|persist[eê]ncia)/i.test(missionRequest);
  const sessionOnly = sessionOnlyRequested(missionRequest);
  const localSQLiteRequired = /\bsqlite\b/i.test(missionRequest) && !/(?:no|without|avoid|sem|n[aã]o (?:use|usar))\s+sqlite\b/i.test(missionRequest)
    && /(?:salvar|persist|save|store|banco local|sqlite through|em sqlite)/i.test(missionRequest);
  const persistent =
    selected === "none"
      ? false
      : selected && selected !== "auto"
        ? true
        : localSQLiteRequired || !databaseForbidden && !sessionOnly &&
          (asksForPersistence(missionRequest) || auth ||
            positiveProviderMention(missionRequest, "supabase") ||
            positiveProviderMention(missionRequest, "firebase") ||
            (!explicitlyProhibits(missionRequest, "firestore") && /\bfirestore\b/i.test(missionRequest)));
  if ((selected === "auto" || !selected) && profile.tier === "prototype")
    return {
      id: "foundation-none-v1",
      provider: "none",
      label: "Prototype session state",
      reason:
        "Prototype depth uses honest session-only behavior unless the user explicitly selects a data provider.",
      persistent: false,
      authentication: false,
      requiredArtifacts: [],
      requiredEnvironment: [],
      securityGates: [
        "Label session-only behavior and do not claim durable persistence, real authentication, cross-device uniqueness, or production authorization.",
      ],
      verificationCommands: [],
      officialSources: [],
    };
  if (!persistent)
    return {
      id: "foundation-none-v1",
      provider: "none",
      label: "No persistence required",
      reason: "The mission does not require durable user data.",
      persistent: false,
      authentication: false,
      requiredArtifacts: [],
      requiredEnvironment: [],
      securityGates: [
        "Do not represent in-memory or sample data as durable persistence.",
      ],
      verificationCommands: [],
      officialSources: [],
    };

  if (
    selected === "firebase" ||
    ((selected === "auto" || !selected) &&
      (positiveProviderMention(missionRequest, "firebase") ||
        (!explicitlyProhibits(missionRequest, "firestore") && /\bfirestore\b/i.test(missionRequest))))
  )
    return {
      id: "firebase-firestore-auth-v1",
      provider: "firebase",
      label: "Firebase Auth + Cloud Firestore",
      reason: "Firebase or Firestore was explicitly requested.",
      persistent: true,
      authentication: true,
      requiredArtifacts: [
        "firebase.json",
        "firestore.rules",
        "firestore.indexes.json",
        ".env.example",
        "src/lib/firebase/client.ts",
      ],
      requiredEnvironment: [
        "NEXT_PUBLIC_FIREBASE_API_KEY",
        "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
        "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      ],
      securityGates: [
        "Firestore rules deny access by default.",
        "Owner or tenant checks use request.auth.uid and immutable ownership fields.",
        "Queries match rule constraints because Firestore rules are not filters.",
        "Admin SDK usage is server-only and protected by IAM.",
        "Rules are exercised with the Local Emulator Suite before verified delivery.",
      ],
      verificationCommands: [
        'firebase emulators:exec --only auth,firestore "npm test"',
      ],
      officialSources: [
        "https://firebase.google.com/docs/auth/web/start",
        "https://firebase.google.com/docs/firestore/security/get-started",
        "https://firebase.google.com/docs/firestore/security/rules-query",
      ],
    };

  if (
    selected === "supabase" ||
    ((selected === "auto" || !selected) && positiveProviderMention(missionRequest, "supabase")) ||
    auth ||
    ["commercial_pilot", "production"].includes(profile.tier)
  )
    return {
      id: "supabase-postgres-auth-v1",
      provider: "supabase",
      label: "Supabase Postgres + Auth",
      reason: /supabase/i.test(mission)
        ? "Supabase was explicitly requested."
        : "Authenticated or commercial persistence requires a managed relational foundation.",
      persistent: true,
      authentication: true,
      requiredArtifacts: [
        "supabase/config.toml",
        "supabase/migrations/*.sql",
        "supabase/tests/*.sql",
        ".env.example",
        "src/lib/supabase/client.ts",
        "src/lib/supabase/server.ts",
      ],
      requiredEnvironment: [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ],
      securityGates: [
        "Every exposed table enables Row Level Security.",
        "Grants and per-operation RLS policies are declared in migrations.",
        "Tenant or owner identity derives from auth.uid(), never client-submitted identity.",
        "Service-role credentials never enter client code.",
        "Allow and deny behavior is tested for anon and authenticated roles.",
      ],
      verificationCommands: [
        "supabase db reset",
        "supabase test db",
        "npm test",
      ],
      officialSources: [
        "https://supabase.com/docs/guides/database/postgres/row-level-security",
        "https://supabase.com/docs/guides/local-development/overview",
        "https://supabase.com/docs/guides/auth/server-side/nextjs",
      ],
    };

  return {
    id: "sqlite-local-v1",
    provider: "sqlite",
    label: "Local SQLite",
    reason: "The local MVP needs durable data without an external account.",
    persistent: true,
    authentication: false,
    requiredArtifacts: [
      "src/db/schema.ts",
      "src/db/client.ts",
      "drizzle.config.ts",
      "drizzle/*.sql",
      ".env.example",
      "tests/database.test.ts",
    ],
    requiredEnvironment: ["DATABASE_URL"],
    securityGates: [
      "All writes pass schema validation.",
      "Queries are parameterized through the selected driver or ORM.",
      "Foreign keys are enabled.",
      "Migrations are versioned and repeatable.",
      "The primary persistence journey is tested against a temporary database.",
    ],
    verificationCommands: ["npm run db:migrate", "npm test"],
    officialSources: [
      "https://www.sqlite.org/security.html",
      "https://orm.drizzle.team/docs/get-started-sqlite",
    ],
  };
}

/**
 * A council decision owns the mission's data contract. Reuse it for build and
 * repair, but automatically replace legacy contracts that contradict the
 * current structured intake (for example Firebase selected from "do not use
 * Firebase").
 */
export function resolveFoundationPlan(
  mission: string,
  profile: DeliveryProfile,
  recorded?: FoundationPlan,
) {
  const selected = selectFoundation(mission, profile);
  if (!recorded) return selected;
  return recorded.provider === selected.provider ? recorded : selected;
}

export function formatFoundationPlan(plan: FoundationPlan) {
  return `APPROVED DATA FOUNDATION (${plan.id})\nProvider: ${plan.label}\nReason: ${plan.reason}\nAuthentication required: ${plan.authentication ? "yes" : "no"}\nRequired artifacts: ${plan.requiredArtifacts.join(", ") || "none"}\nRequired environment variables: ${plan.requiredEnvironment.join(", ") || "none"}\nMandatory security gates:\n- ${plan.securityGates.join("\n- ")}\nVerification commands: ${plan.verificationCommands.join("; ") || "none"}\nOfficial sources: ${plan.officialSources.join(", ") || "none"}`;
}

export function foundationKnowledgeExclusions(plan: FoundationPlan) {
  return (["sqlite", "supabase", "firebase"] as const).filter(
    (provider) => provider !== plan.provider,
  );
}

export function validateFoundationFiles(
  plan: FoundationPlan,
  files: { path: string; content: string }[],
) {
  const paths = files.map((file) =>
    file.path.replaceAll("\\", "/").toLowerCase(),
  );
  const all = files.map((file) => file.content).join("\n");
  const missing: string[] = [];
  if (plan.provider === "none") {
    const runtimeFiles = files.filter((file) =>
      /(?:package\.json|\.(?:ts|tsx|js|jsx|mjs|cjs))$/i.test(file.path),
    );
    const runtime = runtimeFiles.map((file) => file.content).join("\n");
    if (
      /(?:from|require\s*\()\s*["'](?:firebase(?:\/|["'])|@firebase\/)/i.test(runtime) ||
      /["']firebase["']\s*:/i.test(runtime)
    )
      missing.push(
        "Session-only foundation is incompatible with a Firebase runtime dependency.",
      );
    if (
      /(?:from|require\s*\()\s*["']@supabase\//i.test(runtime) ||
      /["']@supabase\//i.test(runtime)
    )
      missing.push(
        "Session-only foundation is incompatible with a Supabase runtime dependency.",
      );
    return missing;
  }
  const has = (pattern: RegExp) => paths.some((path) => pattern.test(path));
  const artifactPattern = (artifact: string) =>
    new RegExp(
      `(^|/)${artifact
        .toLowerCase()
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*")
        .replaceAll("/", "\\/")}$`,
    );
  for (const artifact of plan.requiredArtifacts)
    if (!(plan.provider === 'sqlite' && paths.includes('devkiller.runtime.json') && ['src/db/schema.ts','src/db/client.ts','drizzle.config.ts','tests/database.test.ts'].includes(artifact)) && !has(artifactPattern(artifact)))
      missing.push(`${plan.label} is missing required artifact: ${artifact}.`);
  if (!has(/(^|\/)\.env\.example$/))
    missing.push(
      "Data foundation requires a committed .env.example without secret values.",
    );
  const environmentExample = files.find((file) =>
    /(^|[\\/])\.env\.example$/i.test(file.path),
  );
  if (
    environmentExample &&
    environmentExample.content
      .split(/\r?\n/)
      .some(
        (line) =>
          /(?:SECRET|SERVICE_ROLE|PRIVATE_KEY|PASSWORD)\s*=\s*[^\s#][^\s]*/i.test(
            line,
          ) && !/(example|replace|changeme|your_)/i.test(line),
      )
  )
    missing.push(
      ".env.example appears to contain a real privileged credential.",
    );
  for (const variable of plan.requiredEnvironment)
    if (
      !environmentExample?.content
        .split(/\r?\n/)
        .some((line) => line.trimStart().startsWith(`${variable}=`))
    )
      missing.push(`.env.example is missing required variable: ${variable}.`);
  if (plan.provider === "sqlite") {
    if (!has(/(^|\/)src\/db\/schema\.(ts|js|mjs|cjs)$/))
      missing.push("SQLite foundation is missing src/db/schema.ts.");
    if (!has(/(^|\/)drizzle\/.*\.sql$/))
      missing.push("SQLite foundation is missing a versioned SQL migration.");
    if (!/foreign_keys|references\s*\(/i.test(all))
      missing.push("SQLite foundation does not show foreign-key enforcement.");
    if (!/\b(?:transaction|rollback|begin)\b/i.test(all))
      missing.push("SQLite foundation does not test an atomic transaction or rollback.");
    if (!/\b(?:unique|idempotency|primary\s+key)\b/i.test(all))
      missing.push("SQLite foundation does not enforce an idempotency or uniqueness rule.");
  }
  if (plan.provider === "supabase") {
    if (!has(/(^|\/)supabase\/migrations\/.*\.sql$/))
      missing.push("Supabase foundation is missing a versioned migration.");
    if (!has(/(^|\/)supabase\/tests\/.*\.sql$/))
      missing.push("Supabase foundation is missing allow/deny RLS tests.");
    if (!/enable row level security/i.test(all))
      missing.push("Supabase foundation does not enable Row Level Security.");
    if (!/create policy/i.test(all))
      missing.push("Supabase foundation has no explicit RLS policies.");
    if (!/auth\.uid\s*\(\s*\)/i.test(all))
      missing.push(
        "Supabase authorization does not derive ownership from auth.uid().",
      );
    const supabaseTests = files
      .filter((file) => /(^|[\\/])supabase[\\/]tests[\\/].*\.sql$/i.test(file.path))
      .map((file) => file.content)
      .join("\n");
    if (!/\b(?:throws_ok|is_empty|results_eq)\s*\(/i.test(supabaseTests))
      missing.push("Supabase tests do not demonstrate a denied data operation.");
    if (!/\b(?:lives_ok|isnt_empty|results_eq)\s*\(/i.test(supabaseTests))
      missing.push("Supabase tests do not demonstrate an allowed data operation.");
    if (!/(?:set\s+(?:local\s+)?role\s+authenticated|authenticate_as\s*\()/i.test(supabaseTests))
      missing.push("Supabase tests do not exercise an authenticated database role.");
    if (
      /service_role|service-role/i.test(all) &&
      files.some(
        (file) =>
          /service_role|service-role/i.test(file.content) &&
          /client\.(ts|tsx|js|jsx)$/i.test(file.path),
      )
    )
      missing.push(
        "Supabase service-role material appears in a client-facing file.",
      );
  }
  if (plan.provider === "firebase") {
    if (!has(/(^|\/)firestore\.rules$/))
      missing.push("Firebase foundation is missing firestore.rules.");
    if (!has(/(^|\/)firestore\.indexes\.json$/))
      missing.push("Firebase foundation is missing firestore.indexes.json.");
    if (!has(/(^|\/)tests\/.*(?:firestore|rules).*\.test\.(ts|js)$/))
      missing.push(
        "Firebase foundation is missing an emulator authorization test suite.",
      );
    if (!/request\.auth\s*!=\s*null/i.test(all))
      missing.push(
        "Firestore rules do not require authenticated identity for protected data.",
      );
    if (/allow\s+(read|write|read,\s*write)\s*:\s*if\s+true/i.test(all))
      missing.push("Firestore rules contain an unconditional allow rule.");
    if (!/assertFails/i.test(all) || !/assertSucceeds/i.test(all))
      missing.push(
        "Firebase rules tests do not demonstrate both denied and allowed operations.",
      );
  }
  return missing;
}
