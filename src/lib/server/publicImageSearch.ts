import {z} from 'zod';

const API='https://api.openverse.org/v1/images/';
const MAX_IMAGE_BYTES=1_500_000;
const querySchema=z.string().trim().min(3).max(160).transform(value=>value.replace(/\s+/g,' '));
const resultSchema=z.object({
  id:z.string().uuid(),title:z.string().nullable().optional(),creator:z.string().nullable().optional(),creator_url:z.string().url().nullable().optional(),
  license:z.enum(['cc0','pdm','by']),license_version:z.string().nullable().optional(),license_url:z.string().url().nullable().optional(),
  foreign_landing_url:z.string().url(),thumbnail:z.string().url(),provider:z.string().min(1),source:z.string().min(1),
  category:z.string().nullable().optional(),mature:z.boolean().optional(),width:z.number().int().positive().nullable().optional(),height:z.number().int().positive().nullable().optional(),
  tags:z.array(z.object({name:z.string()}).passthrough()).optional(),
}).passthrough();

export type PublicImageAsset={query:string;imageDataUrl:string;title:string;creator:string|null;creatorUrl:string|null;license:'CC0'|'PDM'|'CC BY';licenseUrl:string|null;sourceUrl:string;provider:string;source:string;width:number|null;height:number|null;attribution:string};
type Fetcher=typeof fetch;
const cache=new Map<string,{expires:number,value:PublicImageAsset}>();

function safeThumbnail(id:string,value:string){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='api.openverse.org'||url.pathname!==`/v1/images/${id}/thumb/`||url.search||url.hash)throw new Error('Untrusted Openverse thumbnail URL.');
  return url;
}
function queryVariants(query:string){
  const words=query.match(/[\p{L}\p{N}-]+/gu)||[];
  // Generated prompts often contain art-direction words that make a stock search
  // less accurate. Search the concrete subject first, then progressively broaden.
  // This is deterministic and never asks an LLM to rewrite queries.
  const noise=new Set(['a','an','and','at','authentic','beautiful','brazilian','burnt','contemporary','creamy','dessert','dish','double','editorial','food','for','grilled','high','in','modern','of','on','photo','photograph','plate','plated','professional','real','restaurant','roasted','slow','smash','style','the','vegetable','with']);
  const subject=words.filter(word=>!noise.has(word.toLowerCase()));
  const phrase=subject.join(' '),pair=subject.slice(-2).join(' '),single=[...subject].reverse().find(word=>word.length>=5)||subject.at(-1)||'';
  const foodIntent=words.some(word=>['dish','food','meal','menu','plate','plated'].includes(word.toLowerCase()));
  return [...new Set([foodIntent?`${phrase} dish`:'',phrase,query,pair,single].map(value=>value.trim()).filter(value=>value.length>=3))].slice(0,5);
}
const SEARCH_NOISE=new Set(['and','authentic','beautiful','brazil','brazilian','contemporary','editorial','high','modern','photo','photograph','professional','real','style','sustainable','the','with']);
const INTENTS={
  architecture:new Set(['architecture','architectural','building','campus','commercial','construction','facade','heritage','infrastructure','interior','office','renovation','retrofit','skyscraper','tower','urban']),
  food:new Set(['barbecue','bbq','breakfast','burger','cooking','dessert','dinner','dish','food','grill','lunch','meal','menu','mushroom','plate','restaurant','risotto','salad']),
  animal:new Set(['animal','bird','cat','dog','fauna','mammal','marmoset','monkey','pet','primate','wildlife','zoo']),
  people:new Set(['businessperson','employee','family','people','person','portrait','team','worker']),
  technology:new Set(['computer','device','electronics','laptop','phone','robot','server','technology']),
} as const;
type Intent=keyof typeof INTENTS;
function token(value:string){
  const normalized=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9-]/g,'');
  if(normalized.length>5&&normalized.endsWith('ies'))return `${normalized.slice(0,-3)}y`;
  if(normalized.length>4&&normalized.endsWith('s'))return normalized.slice(0,-1);
  return normalized;
}
function tokens(value:string){return (value.match(/[\p{L}\p{N}-]+/gu)||[]).map(token).filter(word=>word.length>2);}
function intents(words:readonly string[]):Set<Intent>{
  const found=new Set<Intent>();
  for(const [intent,vocabulary] of Object.entries(INTENTS) as [Intent,Set<string>][])if(words.some(word=>vocabulary.has(word)))found.add(intent);
  return found;
}
/** A result without positive subject evidence is rejected, not merely ranked last. */
function relevance(data:z.infer<typeof resultSchema>,candidateQuery:string):number|null{
  const queryWords=[...new Set(tokens(candidateQuery))],querySubject=queryWords.filter(word=>!SEARCH_NOISE.has(word));
  const title=(data.title||'').trim().toLowerCase(),candidateWords=tokens(`${title} ${(data.tags||[]).map(tag=>tag.name).join(' ')}`);
  const candidateSet=new Set(candidateWords),shared=querySubject.filter(word=>candidateSet.has(word));
  const queryIntents=intents(querySubject),candidateIntents=intents(candidateWords);
  const matchingIntents=[...queryIntents].filter(intent=>candidateIntents.has(intent));
  // Known cross-domain mismatches are never acceptable fallbacks. In
  // particular, a location word such as "Brazil" cannot turn wildlife into an
  // architecture result.
  if(candidateIntents.has('animal')&&!queryIntents.has('animal'))return null;
  if(queryIntents.size>0&&!matchingIntents.length)return null;
  if(!shared.length&&!matchingIntents.length)return null;
  let score=data.license==='by'?0:2;
  const normalizedQuery=candidateQuery.trim().toLowerCase();
  if(title===normalizedQuery)score+=35;else if(title.includes(normalizedQuery))score+=8;
  score+=shared.length*6+matchingIntents.length*10;
  if(title.length>0&&title.length<=80)score+=2;
  if(data.width&&data.height&&data.width>=data.height)score+=1;
  return score>=10?score:null;
}
async function boundedImage(url:URL,fetcher:Fetcher,signal?:AbortSignal){
  // Openverse's thumbnail proxy performs content negotiation and returns 406
  // when every advertised media type has equal priority. A normal browser-like
  // fallback keeps the response deterministic while the allowlist below still
  // rejects any unexpected content type.
  const response=await fetcher(url,{signal,redirect:'error',headers:{Accept:'image/jpeg,image/png,image/webp,image/avif,*/*;q=0.8','User-Agent':'DevKiller/0.1 public-media-search'}});
  if(!response.ok)throw new Error('Openverse thumbnail was unavailable.');
  const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!['image/jpeg','image/png','image/webp','image/avif'].includes(type))throw new Error('Openverse returned an unsupported image format.');
  const declared=Number(response.headers.get('content-length')||0);if(declared>MAX_IMAGE_BYTES)throw new Error('Openverse thumbnail is too large.');
  const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw new Error('Openverse thumbnail is empty or too large.');
  return `data:${type};base64,${bytes.toString('base64')}`;
}

/** Searches openly licensed photography, preferring public-domain media. */
export async function searchPublicImage(rawQuery:string,signal?:AbortSignal,fetcher:Fetcher=fetch):Promise<PublicImageAsset>{
  const query=querySchema.parse(rawQuery),key=query.toLocaleLowerCase('en-US'),remembered=cache.get(key);
  if(remembered&&remembered.expires>Date.now())return remembered.value;
  for(const candidateQuery of queryVariants(query)){
    const candidates:Array<z.infer<typeof resultSchema>>=[];
    for(const licenses of ['cc0,pdm','by'] as const){
      const url=new URL(API);url.searchParams.set('q',candidateQuery);url.searchParams.set('license',licenses);url.searchParams.set('category','photograph');url.searchParams.set('page_size','10');
      const response=await fetcher(url,{signal,redirect:'error',headers:{Accept:'application/json','User-Agent':'DevKiller/0.1 public-media-search'}});
      if(!response.ok){if(response.status===429)throw new Error('The public image library rate limit is temporarily exhausted.');continue;}
      const body=await response.json() as {results?:unknown};for(const raw of Array.isArray(body.results)?body.results:[]){
        const parsed=resultSchema.safeParse(raw);if(parsed.success&&!parsed.data.mature&&(!parsed.data.category||parsed.data.category==='photograph'))candidates.push(parsed.data);
      }
    }
    const relevant=candidates.map(data=>({data,score:relevance(data,candidateQuery)}))
      .filter((item):item is {data:z.infer<typeof resultSchema>;score:number}=>item.score!==null)
      .sort((a,b)=>b.score-a.score);
    const exact=relevant.findIndex(item=>(item.data.title||'').trim().toLowerCase()===candidateQuery.toLowerCase());
    if(exact>0)relevant.unshift(...relevant.splice(exact,1));
    for(const {data} of relevant){
      try{
        const imageDataUrl=await boundedImage(safeThumbnail(data.id,data.thumbnail),fetcher,signal);
        const license=data.license==='cc0'?'CC0':data.license==='pdm'?'PDM':'CC BY';
        const title=(data.title||query).trim().slice(0,180),creator=data.creator?.trim().slice(0,140)||null;
        const attribution=license==='CC BY'?`${title}${creator?` — ${creator}`:''} · ${license}`:`${title} · ${license}`;
        const value:PublicImageAsset={query,imageDataUrl,title,creator,creatorUrl:data.creator_url||null,license,licenseUrl:data.license_url||null,sourceUrl:data.foreign_landing_url,provider:data.provider,source:data.source,width:data.width||null,height:data.height||null,attribution};
        cache.set(key,{expires:Date.now()+24*60*60*1000,value});if(cache.size>100)cache.delete(cache.keys().next().value!);return value;
      }catch{continue;}
    }
  }
  throw new Error('No suitable openly licensed photograph was found.');
}

export function clearPublicImageSearchCache(){cache.clear();}
