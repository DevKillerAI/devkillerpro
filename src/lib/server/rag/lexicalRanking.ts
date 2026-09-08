import type {KnowledgeDocument} from './types';
const stop=new Set('the and for with that this from how should what must before after into application generated app uma para com que dos das por como'.split(' '));
export function searchTokens(text:string){return (text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]+/g)||[]).filter(t=>t.length>2&&!stop.has(t)).map(t=>t.length>5?t.replace(/(ing|ed|s)$/,''):t);}
// Only used when semantic retrieval is unavailable. Exact tokens avoid substring false positives.
export function rankLexically(query:string,documents:KnowledgeDocument[]){
 const tokens=documents.map(d=>searchTokens(`${d.title} ${d.title} ${d.tags.join(' ')} ${d.content}`));
 const average=tokens.reduce((s,t)=>s+t.length,0)/Math.max(1,tokens.length);
 const terms=[...new Set(searchTokens(query))];
 const frequencies=new Map(terms.map(t=>[t,tokens.filter(row=>row.includes(t)).length]));
 return tokens.map(row=>{let score=0;for(const term of terms){const tf=row.filter(t=>t===term).length;if(!tf)continue;const df=frequencies.get(term)||0;const idf=Math.log(1+(tokens.length-df+.5)/(df+.5));score+=idf*tf*2.2/(tf+1.2*(.25+.75*row.length/(average||1)));}return 1-Math.exp(-score);});
}
