import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database,closeDatabase } from '../../src/lib/server/database';
import { missionModel } from '../../src/lib/server/modelPolicy';
test('mission snapshot controls product separately and is independent of current defaults',async()=>{
 const sql=database(),id=`policy-test-${randomUUID()}`;
 const policy={product:'gpt-5.6-luna',specialists:'gpt-5.6-terra',decision:'gpt-5.6-terra',build:'gpt-5.6-terra',qa:'gpt-5.6-terra',repair:'gpt-5.6-terra'};
 try{
  await sql`insert into missions(id,prompt,status,metadata) values(${id},'Policy isolation test','failed',${sql.json({modelPolicy:policy})})`;
  assert.equal(await missionModel(id,'consultant_product'),'gpt-5.6-luna');
  assert.equal(await missionModel(id,'consultant_contribution'),'gpt-5.6-terra');
  assert.equal(await missionModel(id,'council_decision'),'gpt-5.6-terra');
  assert.equal(await missionModel(id,'mission_build'),'gpt-5.6-terra');
 }finally{await sql`delete from missions where id=${id}`;await closeDatabase();}
});
