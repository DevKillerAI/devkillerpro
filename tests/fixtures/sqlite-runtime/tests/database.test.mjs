import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
test('CRUD through HTTP and durable SQLite reopen',async()=>{
  let app=createApp(process.env.DATABASE_URL);
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${app.server.address().port}`;
  await fetch(url,{method:'POST',body:JSON.stringify({title:'before'})});
  const [note]=await (await fetch(url)).json();
  await fetch(`${url}/${note.id}`,{method:'PUT',body:JSON.stringify({title:'after'})});
  await new Promise(resolve=>app.server.close(resolve)); app.db.close();
  app=createApp(process.env.DATABASE_URL);
  assert.equal(app.db.prepare('select title from notes').get().title,'after');
  app.db.prepare('delete from notes').run(); app.db.close();
});
