import type { KnowledgeDocument } from "./types";
import { z } from "zod";

export const reviewedLessonSchema = z.object({
  title:z.string().min(8).max(180),
  applicability:z.string().min(20).max(3000),
  confirmedCause:z.string().min(20).max(3000),
  prevention:z.string().min(20).max(5000),
  limitations:z.string().min(10).max(2000),
  sourceIncidentIds:z.array(z.string().min(1)).min(1),
  reviewedBy:z.string().min(3),
  reviewedAt:z.string().datetime(),
  regressionEvidence:z.array(z.object({test:z.string().min(3),reportSha256:z.string().regex(/^[a-f0-9]{64}$/),passed:z.literal(true)})).min(1),
});
export function approvedLessonContent(input:unknown) {
  // This validates a review record, not the truth of an AI's assertion. Only a
  // trusted reviewer may publish it after checking the referenced test report.
  return redactKnowledge(JSON.stringify(reviewedLessonSchema.parse(input),null,2));
}

export type KnowledgeFilter = { tenantId: string; domains?: string[]; includeTags?: string[]; excludeTags?: string[] };
export function eligibleKnowledge(doc: KnowledgeDocument, filter: KnowledgeFilter, now=Date.now()) {
  return doc.status === "active" && ["certified","verified"].includes(doc.trust)
    && (!doc.tags.includes('platform-only') || filter.includeTags?.includes('platform-only') === true)
    && (doc.tenantId === "public" || doc.tenantId === filter.tenantId)
    && (!doc.expiresAt || Date.parse(doc.expiresAt)>now)
    && (!filter.domains?.length || doc.domains.some(domain=>filter.domains!.includes(domain)))
    && (!filter.includeTags?.length || filter.includeTags.some(tag=>doc.tags.includes(tag)))
    && !filter.excludeTags?.some(tag=>doc.tags.includes(tag));
}

export function redactKnowledge(text: string) {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]+/g,"[REDACTED_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi,"Bearer [REDACTED_TOKEN]")
    .replace(/\b(password|api[_-]?key|secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?[^\s,"'}]+/gi,"$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,"[REDACTED_EMAIL]")
    .replace(/(https?:\/\/|postgres(?:ql)?:\/\/)[^\s/@]+:[^\s/@]+@/gi,"$1[REDACTED_CREDENTIALS]@");
}

export function incidentCategory(text: string) {
  if(/fetch failed|ECONN|ETIMEDOUT|PROVIDER_|OPENAI_|connection|polling/i.test(text)) return "provider-transport";
  if(/runtime|docker|dependency|module not found|test-file|invalid_string/i.test(text)) return "execution-environment";
  if(/sqlite|supabase|firebase|transaction|database|migration/i.test(text)) return "database";
  if(/authorization|authentication|permission|rls/i.test(text)) return "access-control";
  return "application-validation";
}

export function incidentContent(content: string, success: boolean) {
  return JSON.stringify({
    category:incidentCategory(content),
    observation:redactKnowledge(content).slice(0,12000),
    outcome:success?"delivery-reported-success":"failure-observed",
    causeStatus:"unconfirmed", remedyStatus:"not-validated",
    promotionRule:"Confirm the cause, link a reproducible test and verify the remedy before publishing as guidance. A successful mission does not prove a general prevention rule.",
  },null,2);
}
