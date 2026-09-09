import type { KnowledgeDocument } from './types';
import { PRODUCT_BLUEPRINTS, PRODUCT_BLUEPRINT_VERSION, PRODUCT_SCOPE_POLICY, REUSABLE_PRODUCT_PATTERNS } from '../../knowledge/productBlueprints';

type Seed = Omit<KnowledgeDocument, 'contentHash' | 'ingestedAt' | 'embedding' | 'embeddingModel'>;
const base = {
  tenantId: 'devkiller', sourceType: 'internal' as const, trust: 'verified' as const,
  status: 'active' as const, domains: ['design', 'product', 'builder'],
  version: PRODUCT_BLUEPRINT_VERSION, reviewedAt: '2026-09-09T00:00:00.000Z',
};
export const PRODUCT_BLUEPRINT_KNOWLEDGE: Seed[] = [
  ...PRODUCT_BLUEPRINTS.map(b => ({ ...base, id: `product-blueprint-${b.id}`,
    title: `Product blueprint: ${b.name}`, sourceUri: `internal://devkiller/product-blueprints/${b.id}`,
    tags: ['product-blueprint', b.id],
    content: [
      `${b.name}: ${b.purpose}`, `Applicable niches: ${b.niches.join('; ')}`,
      `Candidate entities: ${b.entities.join('; ')}`, `Coherent core workflows:\n${b.coreFlows.join('\n')}`,
      `Optional evolution, NOT required for delivery:\n${b.advanced.join('\n')}`,
      `Runtime/integration boundaries:\n${b.integrationBoundaries.join('\n')}`,
      `Purpose-built screens: ${b.screens.join('; ')}`, `Visual rationale: ${b.visualPrinciples.join(' ')}`,
      `Research provenance (recommendations are our synthesis):\n${b.sources.join('\n')}`,
      'User scope and capabilities override this blueprint. No new acceptance gates. Preserve functional previews; cosmetic recommendations are advisory.'
    ].join('\n\n')
  })),
  { ...base, id: 'product-blueprint-reusable', title: 'Reusable product patterns and scope policy',
    sourceUri: 'internal://devkiller/product-blueprints/reusable', tags: ['product-blueprint', 'reusable'],
    content: [...PRODUCT_SCOPE_POLICY, ...REUSABLE_PRODUCT_PATTERNS.map(p => `${p.id}: ${p.use}. ${p.pattern}`)].join('\n\n') }
];
