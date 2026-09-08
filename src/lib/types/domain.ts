import { z } from "zod";

// --- AGENT DOMAIN ---
export const AgentRoleSchema = z.enum([
  "CTO_CHAIR",
  "PRODUCT_STRATEGIST",
  "SOFTWARE_ARCHITECT",
  "SENIOR_FULLSTACK",
  "UX_DESIGNER",
  "SECURITY_ENGINEER",
  "QA_RELIABILITY",
  "DEVOPS_SRE",
  "AI_SYSTEMS",
  "RED_TEAM_CRITIC",
]);

export type AgentRole = z.infer<typeof AgentRoleSchema>;

export interface AgentCard {
  id: string;
  role: AgentRole | string;
  code?: string;
  name: string;
  title: string;
  focus?: string[];
  vetoScope?: string;
  description: string;
  defaultModel?: string;
  avatar?: string;
  archetype?: string;
  systemPrompt?: string;
  coreCompetencies?: string[];
  heuristics?: string[];
  vetoRights?: string[];
}

// --- MISSION & MEETING PHASES ---
export const MeetingPhaseSchema = z.enum([
  "DRAFT",
  "COUNCIL_READY",
  "INDEPENDENT_ANALYSIS",
  "CONFLICT_MAPPING",
  "DELIBERATION",
  "VALIDATION",
  "SYNTHESIS",
  "APPROVAL",
  "ARTIFACTS",
  "REVIEW",
  "COMPLETE",
]);

export type MeetingPhase = z.infer<typeof MeetingPhaseSchema>;

export interface Mission {
  id: string;
  number: string;
  title: string;
  category: string;
  brief: string;
  priority: "P0" | "P1" | "P2" | "P3";
  status: "COUNCIL_ASSEMBLED" | "IN_PROGRESS" | "RESOLVED" | "BLOCKED";
  phase: MeetingPhase;
  autonomyLevel: "L0" | "L1" | "L2" | "L3";
  budget: {
    allocatedUSD: number;
    spentUSD: number;
    tokenCount: number;
  };
  governance: {
    constitutionStatus: "ENFORCED" | "AUDITING" | "BYPASSED";
    providerIndependence: boolean;
    memoryIntegrity: number; // percentage
  };
  activeCouncil: string[]; // Agent IDs
}

// --- CONTRIBUTIONS & CLAIMS ---
export interface Contribution {
  id: string;
  agentId: string;
  missionId: string;
  phase: MeetingPhase;
  timestamp: string;
  interpretation: string;
  assumptions: string[];
  recommendation: string;
  topRisks: string[];
  evidenceNeeded: string[];
  confidence: number; // 0 to 100
  status: "STANDBY" | "ANALYZING" | "SUBMITTED";
}

// --- CONFLICT MAP & DIVERGENCE ---
export interface ConflictOption {
  id: string;
  title: string;
  summary: string;
  pros: string[];
  cons: string[];
  advocates: string[]; // Agent IDs
}

export interface ConflictDivergence {
  id: string;
  title: string;
  question: string;
  status: "MATERIAL" | "COMPATIBLE" | "RESOLVED";
  optionA: ConflictOption;
  optionB: ConflictOption;
  parties: string; // e.g. "Architect ↔ Security Engineer"
  resolutionProposal?: string;
  resolvedOptionId?: string;
}

// --- DECISION RECORD (ADR) ---
export interface DecisionRecord {
  id: string;
  missionId: string;
  code: string;
  title: string;
  question: string;
  status: "DRAFT" | "OPEN" | "ACCEPTED" | "REJECTED";
  impact: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  priority: "P0" | "P1" | "P2" | "P3";
  owner: string;
  createdAt: string;
  synthesis: string;
  tradeOffs: string[];
  chosenOption: string;
  evidenceSummary: string[];
  dissentRecorded?: string;
}

// --- EVIDENCE VAULT ---
export const EvidenceTypeSchema = z.enum(["CLAIM", "DATA", "RISK", "ASSUMPTION"]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  title: string;
  statement: string;
  authorId: string;
  authorName: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  timestamp: string;
  metrics?: Record<string, string | number | boolean>;
  source?: { title: string; url: string };
}

// --- COUNCIL RADAR METRICS ---
export interface CouncilMetrics {
  independence: number; // 0 - 100
  conflicts: number;
  resolutionRate: number; // 0 - 100
  evidenceQuality: number; // 0 - 100
  alignment: number; // 0 - 100
}
