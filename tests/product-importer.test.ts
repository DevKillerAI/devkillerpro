import test from 'node:test';
import assert from 'node:assert/strict';
import {isPublicAddress,parseProductHtml,parsePublicProductUrl} from '../src/lib/server/productImporter';

test('product importer extracts schema.org product data and keeps the source auditable',()=>{
  const html=`<html><head><script type="application/ld+json">${JSON.stringify({
    '@context':'https://schema.org','@type':'Product',name:'Arc GPU',brand:{'@type':'Brand',name:'Nova'},
    image:'/gpu.png',description:'Fast & quiet',offers:{'@type':'Offer',price:'2499.90',priceCurrency:'BRL',availability:'https://schema.org/InStock',seller:{name:'Example Store'}},
  })}</script></head></html>`;
  assert.deepEqual(parseProductHtml(html,'https://shop.example/product/arc'),{
    sourceUrl:'https://shop.example/product/arc',name:'Arc GPU',price:'2499.90',currency:'BRL',store:'Example Store',
    imageUrl:'https://shop.example/gpu.png',imageDataUrl:null,description:'Fast & quiet',brand:'Nova',availability:'InStock',extractedFrom:'json-ld',warnings:[],
  });
});

test('product importer uses metadata fallback without inventing a price',()=>{
  const result=parseProductHtml('<meta property="og:title" content="Quiet Case"><meta property="og:image" content="https://cdn.example/case.jpg">','https://store.example/item');
  assert.equal(result.name,'Quiet Case');assert.equal(result.price,null);assert.equal(result.extractedFrom,'metadata');assert.ok(result.warnings.length);
});

test('product importer blocks local, reserved and credential-bearing destinations',()=>{
  for(const value of ['http://127.0.0.1/a','http://10.0.0.1/a','http://[::1]/a','file:///etc/passwd','https://user:pass@example.com/a','https://example.com:8443/a'])assert.throws(()=>parsePublicProductUrl(value));
  assert.equal(parsePublicProductUrl('https://example.com/a#fragment').href,'https://example.com/a');
  assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('192.168.1.1'),false);assert.equal(isPublicAddress('2001:4860:4860::8888'),true);
});
