import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
export function createApp(filename) {
  const db=new DatabaseSync(filename.replace(/^file:/,''));
  db.exec('CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
  const server=http.createServer(async (req,res)=> {
    res.setHeader('Content-Type','application/json');
    const id=Number(req.url.split('/').pop());
    if(req.method==='GET') { res.end(JSON.stringify(db.prepare('SELECT * FROM notes').all())); return; }
    let text=''; for await(const part of req) text+=part;
    if(req.method==='POST') db.prepare('INSERT INTO notes(title) VALUES (?)').run(JSON.parse(text).title);
    if(req.method==='PUT') db.prepare('UPDATE notes SET title=? WHERE id=?').run(JSON.parse(text).title,id);
    if(req.method==='DELETE') db.prepare('DELETE FROM notes WHERE id=?').run(id);
    res.end(JSON.stringify({ok:true}));
  });
  return {server,db};
}
if(import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {server}=createApp(process.env.DATABASE_URL);
  server.listen(Number(process.env.PORT),process.env.HOST);
}
