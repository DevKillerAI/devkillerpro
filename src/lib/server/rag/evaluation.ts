import "server-only";
import { listKnowledge, ragTable, hashContent } from "./store";
import { database } from '../database';
import { retrieveKnowledge } from "./retrieval";
import { determineDeliveryProfile } from "@/lib/server/deliveryProfile";
import {
  foundationKnowledgeExclusions,
  selectFoundation,
  validateFoundationFiles,
  type DataProvider,
} from "@/lib/server/foundations/registry";
import { getFoundationTemplates } from "@/lib/server/foundations/templates";

const GOLDEN = [
  {
    query: "How should generated application security be verified?",
    domain: "security",
    expected: "owasp-asvs-5-local",
  },
  {
    query: "What evidence is needed before delivering a mission?",
    domain: "qa",
    expected: "policy-delivery-gates-v1",
  },
  {
    query: "How do we prevent poisoned RAG content from affecting production?",
    domain: "security",
    expected: "policy-rag-trust-v1",
  },
  {
    query: "How should a failed generated app be repaired?",
    domain: "recovery",
    expected: "policy-repair-v1",
  },
  {
    query: "What requirements should mission intake collect?",
    domain: "intake",
    expected: "policy-intake-v1",
  },
  {
    query: "How must Supabase tables be protected and tested?",
    domain: "database",
    expected: "supabase-rls-official-2026",
  },
  {
    query: "How should Next.js use Supabase authentication securely?",
    domain: "authentication",
    expected: "supabase-nextjs-auth-official-2026",
  },
  {
    query:
      "How must Firebase Firestore owner access and denied operations be verified?",
    domain: "security",
    expected: "firebase-firestore-rules-official-2026",
  },
  {
    query: "What is required for durable local SQLite persistence?",
    domain: "database",
    expected: "sqlite-local-foundation-v1",
  },
];

export function retrievalMetrics(expectedIds: string[], retrievedIds: string[], k: number) {
  if (!Number.isSafeInteger(k) || k < 1) throw new Error('Invalid evaluation k');
  const expected = new Set(expectedIds), retrieved = [...new Set(retrievedIds)].slice(0,k);
  const relevant = retrieved.filter(id => expected.has(id)).length;
  const rank = retrieved.findIndex(id => expected.has(id));
  return { k, recall: expected.size ? relevant/expected.size : null, precision: retrieved.length ? relevant/retrieved.length : 0,
    reciprocalRank: rank < 0 ? 0 : 1/(rank+1), abstained: retrieved.length===0, retrievedIds: retrieved };
}

export async function evaluateRetrieval() {
  const corpus = await listKnowledge();
  const corpusHash = hashContent(JSON.stringify(corpus.map(d=>[d.id,d.version,d.contentHash,d.tenantId,d.status,d.trust,d.expiresAt,d.domains,d.tags])));
  const results = [];
  for (const item of GOLDEN) {
    const trace = await retrieveKnowledge({
      query: item.query,
      domains: [item.domain],
      limit: 3,
      tenantId: "devkiller",
      useEmbeddings: false,
    });
    const rank = trace.hits.findIndex(
      (hit) => hit.document.id === item.expected,
    );
    results.push({
      ...item,
      rank: rank < 0 ? null : rank + 1,
      passed: rank >= 0,
      mode: trace.mode,
      algorithm: trace.algorithm,
      backend: trace.backend,
      traceId: trace.traceId,
      corpusHash: trace.corpusHash,
      latencyMs: trace.durationMs,
      retrievedHitIds: trace.hits.map(hit=>hit.document.id),
      retrievedChunks: trace.hits.map(hit=>({id:hit.chunk?.id,hash:hit.chunk?.contentHash,documentHash:hit.document.contentHash})),
      metrics: retrievalMetrics([item.expected],trace.hits.map(hit=>hit.document.id),3),
    });
  }
  const passed = results.filter((item) => item.passed).length;
  const isolationTrace = await retrieveKnowledge({
    query: "verified delivery mission memory",
    tenantId: "tenant-isolation-probe",
    limit: 20,
    useEmbeddings: false,
  });
  const tenantIsolationPassed = isolationTrace.hits.every(
    (hit) =>
      hit.document.tenantId === "public" ||
      hit.document.tenantId === "tenant-isolation-probe",
  );
  const trustGatePassed = isolationTrace.hits.every(
    (hit) =>
      hit.document.status === "active" &&
      ["certified", "verified"].includes(hit.document.trust),
  );
  const foundationCases: {
    name: string;
    mission: string;
    expected: DataProvider;
  }[] = [
    {
      name: "automatic prototype remains session-only",
      mission:
        "Delivery depth explicitly selected by the user: prototype. Data provider explicitly selected: auto. Authentication requirement: auto. Create registration and an admin dashboard.",
      expected: "none",
    },
    {
      name: "working local records use SQLite",
      mission:
        "Delivery depth explicitly selected by the user: local_mvp. Data provider explicitly selected: auto. Authentication requirement: not_required. Save customer records.",
      expected: "sqlite",
    },
    {
      name: "commercial persistence uses Supabase",
      mission:
        "Delivery depth explicitly selected by the user: commercial_pilot. Data provider explicitly selected: auto. Authentication requirement: auto. Store orders.",
      expected: "supabase",
    },
    {
      name: "explicit Firebase is respected",
      mission:
        "Delivery depth explicitly selected by the user: prototype. Data provider explicitly selected: firebase. Authentication requirement: required.",
      expected: "firebase",
    },
    {
      name: "required accounts select managed auth",
      mission:
        "Delivery depth explicitly selected by the user: local_mvp. Data provider explicitly selected: auto. Authentication requirement: required.",
      expected: "supabase",
    },
    {
      name: "negative Firebase mention never selects Firebase",
      mission:
        "Delivery depth explicitly selected by the user: local_mvp. Data provider explicitly selected: auto. Authentication requirement: not_required. Do not implement Firebase, Firestore, authentication, external databases, or remote services. Keep fictional data during the current browser session.",
      expected: "none",
    },
    {
      name: "Portuguese negative provider mention remains session-only",
      mission:
        "Delivery depth explicitly selected by the user: local_mvp. Data provider explicitly selected: auto. Authentication requirement: auto. Não use Supabase, Firebase, banco de dados externo ou autenticação. Dados fictícios apenas durante a sessão do navegador.",
      expected: "none",
    },
    {
      name: "explicit none overrides record-shaped UI language",
      mission:
        "Delivery depth explicitly selected by the user: local_mvp. Data provider explicitly selected: none. Authentication requirement: not_required. Show customers, orders, inventory and admin reports using session data.",
      expected: "none",
    },
    {
      name: "positive automatic Firebase request is respected",
      mission:
        "Delivery depth explicitly selected by the user: commercial_pilot. Data provider explicitly selected: auto. Authentication requirement: required. Build this with Firebase Authentication and Firestore.",
      expected: "firebase",
    },
    {
      name: "positive automatic Supabase request is respected",
      mission:
        "Delivery depth explicitly selected by the user: commercial_pilot. Data provider explicitly selected: auto. Authentication requirement: required. Use Supabase for the database and login.",
      expected: "supabase",
    },
  ];
  const foundationSelection = foundationCases.map((item) => {
    const actual = selectFoundation(
      item.mission,
      determineDeliveryProfile(item.mission),
    ).provider;
    return { ...item, actual, passed: actual === item.expected };
  });
  const foundationTemplates = (["sqlite", "supabase", "firebase"] as const).map(
    (provider) => {
      const mission = `Delivery depth explicitly selected by the user: ${provider === "sqlite" ? "local_mvp" : "commercial_pilot"}. Data provider explicitly selected: ${provider}. Authentication requirement: ${provider === "sqlite" ? "not_required" : "required"}. Save records.`;
      const plan = selectFoundation(mission, determineDeliveryProfile(mission));
      const failures = validateFoundationFiles(
        plan,
        getFoundationTemplates(provider).map((file) => ({
          path: file.path,
          content: file.content,
        })),
      );
      return { provider, passed: failures.length === 0, failures };
    },
  );
  const providerIsolation = [];
  for (const provider of ["none", "sqlite", "supabase", "firebase"] as const) {
    const plan = selectFoundation(
      `Delivery depth explicitly selected by the user: ${provider === "none" ? "prototype" : provider === "sqlite" ? "local_mvp" : "commercial_pilot"}. Data provider explicitly selected: ${provider}. Authentication requirement: ${provider === "none" || provider === "sqlite" ? "not_required" : "required"}.`,
      determineDeliveryProfile(
        `Delivery depth explicitly selected by the user: ${provider === "none" ? "prototype" : provider === "sqlite" ? "local_mvp" : "commercial_pilot"}.`,
      ),
    );
    const trace = await retrieveKnowledge({
      query: `database authentication authorization ${provider}`,
      domains: ["database", "authentication", "security"],
      excludeTags: foundationKnowledgeExclusions(plan),
      limit: 20,
      tenantId: "devkiller",
      useEmbeddings: false,
    });
    const forbidden = foundationKnowledgeExclusions(plan);
    const conflictingHits = trace.hits
      .filter((hit) => forbidden.some((tag) => hit.document.tags.includes(tag)))
      .map((hit) => hit.document.id);
    providerIsolation.push({ provider, passed: !conflictingHits.length, conflictingHits });
  }
  return {
    dataset: 'development-golden-v1-not-held-out',
    limitation: 'One anchor per question; precision is anchor-only. This is not an independent quality or application-success benchmark.',
    corpusHash,
    backend: 'postgresql',
    k: 3,
    evaluatedAt: new Date().toISOString(),
    benchmarkSize: results.length,
    recallAt3: passed / results.length,
    passed,
    securityGates: { tenantIsolationPassed, trustGatePassed },
    foundationSelection: {
      passed: foundationSelection.every((item) => item.passed),
      cases: foundationSelection,
    },
    foundationTemplates: {
      passed: foundationTemplates.every((item) => item.passed),
      cases: foundationTemplates,
    },
    providerIsolation: {
      passed: providerIsolation.every((item) => item.passed),
      cases: providerIsolation,
    },
    results,
  };
}

export async function knowledgeHealth() {
  const documents = await listKnowledge();
  const sql=database();
  const [counts]=await sql`SELECT (SELECT count(*)::int FROM ${sql(ragTable('retrieval_events'))}) AS events,
    (SELECT count(*)::int FROM ${sql(ragTable('chunks'))}) AS chunks,
    (SELECT count(*)::int FROM ${sql(ragTable('chunks'))} WHERE embedding IS NOT NULL AND embedding_content_hash IS NOT NULL) AS embedded`;
  return {
    documents: documents.length,
    active: documents.filter((d) => d.status === "active").length,
    quarantined: documents.filter((d) => d.status === "quarantined").length,
    certified: documents.filter((d) => d.trust === "certified").length,
    verified: documents.filter((d) => d.trust === "verified").length,
    backend: 'postgresql',
    chunks: counts.chunks,
    embedded: counts.embedded,
    retrievalEvents: counts.events,
    embeddingModel: "text-embedding-3-small",
  };
}
