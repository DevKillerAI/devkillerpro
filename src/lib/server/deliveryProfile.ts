export type DeliveryTier = "prototype" | "local_mvp" | "commercial_pilot" | "production";

export interface DeliveryProfile {
  tier: DeliveryTier;
  reason: string;
  requiredEvidence: string[];
  nonBlockingUnlessExplicit: string[];
}

export function determineDeliveryProfile(prompt: string): DeliveryProfile {
  const text = prompt.toLowerCase();
  if (/delivery depth explicitly selected by the user:\s*local_mvp/.test(text)) return { tier: "local_mvp", reason: "The user explicitly selected a working local MVP.", requiredEvidence: ["syntax checks", "executable core journey and persistence checks", "honest runtime limitations"], nonBlockingUnlessExplicit: ["production deployment", "multi-tenancy", "enterprise operations"] };
  if (/delivery depth explicitly selected by the user:\s*prototype/.test(text)) return { tier: "prototype", reason: "The user explicitly selected a concept prototype.", requiredEvidence: ["safe file and syntax checks", "coherent interactive concept", "honest prototype limitations"], nonBlockingUnlessExplicit: ["complete feature coverage", "persistent production data", "authentication", "deployment", "commercial infrastructure"] };
  if (/delivery depth explicitly selected by the user:\s*commercial_pilot/.test(text)) return { tier: "commercial_pilot", reason: "The user explicitly selected a commercial pilot.", requiredEvidence: ["deterministic static checks", "executable core-journey tests when safely runnable", "tenant and authorization checks when applicable"], nonBlockingUnlessExplicit: ["enterprise-scale infrastructure", "formal certification", "multi-region operation"] };
  if (/delivery depth explicitly selected by the user:\s*production/.test(text)) return { tier: "production", reason: "The user explicitly selected a production system.", requiredEvidence: ["deterministic static checks", "executable build and tests", "security and authorization gates appropriate to the stated risk", "deployment evidence"], nonBlockingUnlessExplicit: [] };
  const affirmativeText = text
    .replace(/\b(?:no|without|avoid|do not (?:include|add|use)|sem|n[aã]o (?:incluir|inclua|usar|use))\b[^.!?\n]*/gi, '')
    .replace(/\bnot\s+(?:a\s+|an\s+|for\s+)?(?:production|enterprise|deployment|public launch|regulated)\b[^.!?\n]*/gi, '')
    .replace(/\b(?:production|deployment|enterprise)\s+(?:is\s+)?not\s+(?:required|requested|included)\b[^.!?\n]*/gi, '');
  const asksProduction = /\b(production|produção|deploy|go[- ]?live|public launch|lançamento público|enterprise|regulated|regulado)\b/.test(affirmativeText);
  const asksCommercial = /\b(saas|multi[- ]?tenant|comercial|commercial|pilot|piloto|paying customers|clientes pagantes)\b/.test(affirmativeText);
  if (asksProduction) return { tier: "production", reason: "The user explicitly requested a production, launch, enterprise, deployment, or regulated outcome.", requiredEvidence: ["deterministic static checks", "executable build and tests", "security and authorization gates appropriate to the stated risk", "deployment evidence"], nonBlockingUnlessExplicit: [] };
  if (asksCommercial) return { tier: "commercial_pilot", reason: "The user explicitly requested a commercial, SaaS, multi-tenant, or pilot outcome.", requiredEvidence: ["deterministic static checks", "executable core-journey tests when safely runnable", "tenant and authorization checks when applicable"], nonBlockingUnlessExplicit: ["enterprise-scale infrastructure", "formal certification", "multi-region operation"] };
  return { tier: "local_mvp", reason: "The user requested a working application but did not explicitly request production deployment, SaaS multi-tenancy, enterprise operation, or certification.", requiredEvidence: ["static integrity and syntax checks", "independent review of the working core journey", "honest runtime limitations"], nonBlockingUnlessExplicit: ["multi-tenancy", "production database", "formal compliance mapping", "deployment", "horizontal concurrency", "enterprise backup and recovery", "exhaustive authorization matrix"] };
}

export function formatDeliveryProfile(profile: DeliveryProfile) {
  return `DELIVERY TIER: ${profile.tier}\nRATIONALE: ${profile.reason}\nREQUIRED EVIDENCE: ${profile.requiredEvidence.join("; ")}\nNON-BLOCKING UNLESS EXPLICITLY REQUESTED BY THE USER: ${profile.nonBlockingUnlessExplicit.join("; ") || "none"}`;
}
