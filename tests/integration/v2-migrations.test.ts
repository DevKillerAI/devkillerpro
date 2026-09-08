import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {database,closeDatabase} from '../../src/lib/server/database';

test('versioned V2 migration installs cleanly and replays in an isolated local schema',{skip:!process.env.DATABASE_URL},async()=>{
  const host=new URL(process.env.DATABASE_URL!).hostname;assert.ok(['localhost','127.0.0.1','[::1]'].includes(host));
  const schema='qa_v2_migration_'+randomUUID().replaceAll('-',''),sql=database();
  const source=await readFile('supabase/migrations/20260905200000_generator_v2_core.sql','utf8');
  const isolated=source.replaceAll('dk_generator_v2',schema);
  try{
    await sql.unsafe(isolated);await sql.unsafe(isolated);
    const tables=await sql`select table_name from information_schema.tables where table_schema=${schema}`;
    assert.deepEqual(tables.map(row=>row.table_name).sort(),['asset_usage','calls','campaigns','events','runs','snapshots','workers']);
    await sql`insert into ${sql(schema+'.campaigns')}(owner_id,campaign_id,max_cost_micros) values('qa-owner','qa-budget',5000000)`;
    const [row]=await sql`select max_cost_micros from ${sql(schema+'.campaigns')} where owner_id='qa-owner'`;
    assert.equal(Number(row.max_cost_micros),5_000_000);
    for(const role of ['anon','authenticated']){
      const [permissions]=await sql`select has_schema_privilege(${role},${schema},'USAGE') as can_use`;
      assert.equal(permissions.can_use,false);
    }
  }finally{
    assert.match(schema,/^qa_v2_migration_[a-f0-9]{32}$/);
    await sql.unsafe('drop schema if exists '+schema+' cascade');await closeDatabase();
  }
});
