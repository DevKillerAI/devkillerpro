import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import http from 'node:http';
import https from 'node:https';

const MAX_HTML_BYTES=1_500_000;
const MAX_IMAGE_BYTES=2_500_000;
const MAX_REDIRECTS=3;

export type ImportedProduct={
  sourceUrl:string;name:string;price:string|null;currency:string|null;store:string;
  imageUrl:string|null;imageDataUrl:string|null;description:string|null;brand:string|null;
  availability:string|null;extractedFrom:'json-ld'|'metadata';warnings:string[];
};

function ipv4Number(address:string){return address.split('.').reduce((value,part)=>(value<<8)+Number(part),0)>>>0;}
function inV4(address:string,base:string,bits:number){const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;return (ipv4Number(address)&mask)===(ipv4Number(base)&mask);}
export function isPublicAddress(address:string){
  const family=isIP(address);
  if(family===4)return ![
    ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
    ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],
    ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
  ].some(([base,bits])=>inV4(address,String(base),Number(bits)));
  if(family===6){const value=address.toLowerCase();return !(value==='::'||value==='::1'||value.startsWith('fc')||value.startsWith('fd')||/^fe[89ab]/.test(value)||value.startsWith('ff')||value.startsWith('2001:db8:')||value.startsWith('::ffff:'));}
  return false;
}

export function parsePublicProductUrl(input:string,base?:URL){
  const url=base?new URL(input,base):new URL(input);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port)throw new Error('Only a public HTTP or HTTPS product URL is allowed.');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local')||isIP(hostname)&&!isPublicAddress(hostname))throw new Error('Private or local destinations are not allowed.');
  url.hash='';return url;
}

async function publicTarget(url:URL){
  const answers=await dnsLookup(url.hostname,{all:true,verbatim:true});
  if(!answers.length||answers.some(item=>!isPublicAddress(item.address)))throw new Error('The product URL does not resolve to a public destination.');
  return answers[0];
}

function requestBytes(url:URL,target:{address:string;family:number},limit:number,accept:string,signal?:AbortSignal){
  return new Promise<{status:number;headers:http.IncomingHttpHeaders;body:Buffer}>((resolve,reject)=>{
    const transport=url.protocol==='https:'?https:http;
    const request=transport.request(url,{method:'GET',servername:url.protocol==='https:'?url.hostname:undefined,
      lookup:(_hostname,_options,callback)=>callback(null,target.address,target.family),
      headers:{Accept:accept,'Accept-Encoding':'identity','User-Agent':'DevKiller-Product-Importer/1.0'}},response=>{
      const chunks:Buffer[]=[];let size=0;
      response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit){request.destroy(new Error('The remote response is too large.'));return;}chunks.push(chunk);});
      response.on('end',()=>resolve({status:response.statusCode||0,headers:response.headers,body:Buffer.concat(chunks)}));
      response.on('error',reject);
    });
    const abort=()=>request.destroy(new Error('The product request was cancelled.'));
    signal?.addEventListener('abort',abort,{once:true});
    request.setTimeout(12_000,()=>request.destroy(new Error('The product page timed out.')));
    request.on('close',()=>signal?.removeEventListener('abort',abort));request.on('error',reject);request.end();
  });
}

async function fetchPublic(url:URL,limit:number,accept:string,signal?:AbortSignal,redirects=0):Promise<{url:URL;contentType:string;body:Buffer}>{
  const target=await publicTarget(url),response=await requestBytes(url,target,limit,accept,signal);
  if([301,302,303,307,308].includes(response.status)){
    if(redirects>=MAX_REDIRECTS||!response.headers.location)throw new Error('The product page redirected too many times.');
    return fetchPublic(parsePublicProductUrl(response.headers.location,url),limit,accept,signal,redirects+1);
  }
  if(response.status<200||response.status>=300)throw new Error(`The store returned HTTP ${response.status}.`);
  return {url,contentType:String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase(),body:response.body};
}

const entities:Record<string,string>={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
function decode(value:string){return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi,(_all,key:string)=>{if(key[0]==='#'){const hex=key[1]?.toLowerCase()==='x';return String.fromCodePoint(parseInt(key.slice(hex?2:1),hex?16:10));}return entities[key.toLowerCase()]??_all;}).replace(/\s+/g,' ').trim();}
function attributes(tag:string){const result:Record<string,string>={};for(const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))result[match[1].toLowerCase()]=decode(match[2]??match[3]??match[4]??'');return result;}
function meta(html:string,...names:string[]){const wanted=new Set(names.map(name=>name.toLowerCase()));for(const match of html.matchAll(/<meta\b[^>]*>/gi)){const value=attributes(match[0]),key=(value.property||value.name||value.itemprop||'').toLowerCase();if(wanted.has(key)&&value.content)return value.content;}return null;}
function firstString(value:unknown):string|null{if(typeof value==='string'&&value.trim())return value.trim();if(Array.isArray(value))for(const item of value){const found=firstString(item);if(found)return found;}if(value&&typeof value==='object')return firstString((value as Record<string,unknown>).url)||(typeof (value as Record<string,unknown>).name==='string'?String((value as Record<string,unknown>).name):null);return null;}
function productNode(value:unknown):Record<string,unknown>|null{
  if(Array.isArray(value)){for(const item of value){const found=productNode(item);if(found)return found;}return null;}
  if(!value||typeof value!=='object')return null;const item=value as Record<string,unknown>,types=Array.isArray(item['@type'])?item['@type']:[item['@type']];
  if(types.some(type=>String(type).toLowerCase()==='product'))return item;
  for(const nested of Object.values(item)){const found=productNode(nested);if(found)return found;}return null;
}
function absolute(value:string|null,base:URL){if(!value)return null;try{const url=parsePublicProductUrl(value,base);return url.href;}catch{return null;}}
function compactText(value:string|null,max=800){if(!value)return null;return decode(value.replace(/<[^>]*>/g,' ')).slice(0,max)||null;}

export function parseProductHtml(html:string,sourceUrl:string):ImportedProduct{
  const base=parsePublicProductUrl(sourceUrl);let product:Record<string,unknown>|null=null;
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{product=productNode(JSON.parse(match[1].trim()));if(product)break;}catch{/* Invalid merchant metadata is ignored. */}}
  const offers=product?.offers&&typeof product.offers==='object'?(Array.isArray(product.offers)?product.offers[0]:product.offers) as Record<string,unknown>:null;
  const name=compactText(firstString(product?.name)||meta(html,'og:title','twitter:title')||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||null,240);
  if(!name)throw new Error('No product name was found on this page.');
  const rawPrice=firstString(offers?.price)||firstString((offers?.priceSpecification as Record<string,unknown>|undefined)?.price)||firstString(offers?.lowPrice)||meta(html,'product:price:amount','og:price:amount');
  const rawImage=firstString(product?.image)||meta(html,'og:image','twitter:image');
  const brand=firstString(product?.brand),seller=firstString(offers?.seller);
  return {sourceUrl:base.href,name,price:rawPrice?.replace(/[^0-9.,-]/g,'')||null,currency:firstString(offers?.priceCurrency)||meta(html,'product:price:currency','og:price:currency'),
    store:seller||base.hostname.replace(/^www\./,''),imageUrl:absolute(rawImage,base),imageDataUrl:null,
    description:compactText(firstString(product?.description)||meta(html,'og:description','description')),brand:brand?compactText(brand,120):null,
    availability:firstString(offers?.availability)?.split('/').pop()||null,extractedFrom:product?'json-ld':'metadata',warnings:rawPrice?[]:['Price was not published in readable product metadata.']};
}

export async function importProductFromUrl(input:string,signal?:AbortSignal){
  const requested=parsePublicProductUrl(input),page=await fetchPublic(requested,MAX_HTML_BYTES,'text/html,application/xhtml+xml',signal);
  if(!['text/html','application/xhtml+xml'].includes(page.contentType))throw new Error('The URL did not return an HTML product page.');
  const result=parseProductHtml(page.body.toString('utf8'),page.url.href);
  if(result.imageUrl)try{const image=await fetchPublic(parsePublicProductUrl(result.imageUrl),MAX_IMAGE_BYTES,'image/png,image/jpeg,image/webp',signal);if(['image/png','image/jpeg','image/webp'].includes(image.contentType))result.imageDataUrl=`data:${image.contentType};base64,${image.body.toString('base64')}`;else result.warnings.push('The product image used an unsupported format.');}catch{result.warnings.push('The product image could not be copied safely.');}
  return result;
}
