import { z } from 'zod';

export const engineRequestSchema = z.enum(['v1', 'v2']);
export function generatorAdmission(engine: z.infer<typeof engineRequestSchema>) {
  const parsed = engineRequestSchema.parse(engine);
  return parsed === 'v2'
    ? { allowed: true as const, engine: parsed }
    : { allowed: false as const, engine: parsed, code: 'GENERATOR_V1_DEPRECATED', error: 'The V1 generator is deprecated and disabled. All generations run exclusively on DevKiller V2.' };
}

