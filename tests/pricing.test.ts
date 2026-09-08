import test from 'node:test';
import assert from 'node:assert/strict';
import {proTiers,planPrice,packPrice} from '../src/lib/tools/pricing';
test('annual billing is exactly 10% below twelve monthly charges',()=>{for(const cents of [1000,2000,...proTiers.map(t=>t.cents)]){const price=planPrice(cents,'annual');assert.equal(price.totalCents,Math.round(cents*12*.9));assert.equal(price.monthlyCents*12,price.totalCents);assert.equal(planPrice(cents,'monthly').totalCents,cents);}});
test('Pro volume increases total price while lowering the unit cost',()=>{for(let i=1;i<proTiers.length;i++){assert.ok(proTiers[i].cents>proTiers[i-1].cents);assert.ok(proTiers[i].cents/proTiers[i].credits<proTiers[i-1].cents/proTiers[i-1].credits);}for(const tier of proTiers)assert.equal(tier.cents,Math.round(proTiers[0].cents*(tier.credits/100)*(1-tier.discount/100)));});
test('top-ups cost more per credit than monthly allowances',()=>{assert.ok(packPrice('tools',50)>1000);for(const tier of proTiers)assert.ok(packPrice('create',tier.credits)>tier.cents);assert.ok(packPrice('create',100)>2000);});
