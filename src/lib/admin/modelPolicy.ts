import { z } from 'zod';
export const MODEL_OPTIONS=['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol'] as const;
export const POLICY_ROLES=['product','specialists','decision','build','qa','repair'] as const;
const model=z.enum(MODEL_OPTIONS);
export const policySchema=z.object({product:model,specialists:model,decision:model,build:model,qa:model,repair:model}).strict();
export type ModelPolicy=z.infer<typeof policySchema>;
export function policyRole(schema:string):keyof ModelPolicy {
 if(schema==='consultant_product')return 'product';
 if(schema==='consultant_contribution')return 'specialists';
 if(schema==='mission_build')return 'build';
 if(schema==='functional_qa_review')return 'qa';
 if(['mission_patch_repair','delivery_recovery_plan'].includes(schema))return 'repair';
 return 'decision';
}
