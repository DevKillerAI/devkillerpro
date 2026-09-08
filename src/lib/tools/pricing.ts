export type BillingCycle='monthly'|'annual';
export const proTiers=[{credits:100,cents:3000,discount:0},{credits:200,cents:5000,discount:100/6},{credits:400,cents:9000,discount:25},{credits:500,cents:11000,discount:80/3}] as const;
export function planPrice(monthlyCents:number,cycle:BillingCycle){const annualCents=Math.round(monthlyCents*12*.9);return {monthlyCents:cycle==='annual'?annualCents/12:monthlyCents,totalCents:cycle==='annual'?annualCents:monthlyCents};}
export function packPrice(kind:'tools'|'create',credits:number){return kind==='tools'?credits*24:credits*32;}
