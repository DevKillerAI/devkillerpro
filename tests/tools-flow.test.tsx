import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ToolWorkspace from '../src/components/tools/ToolWorkspace';
import PlatformHeader from '../src/components/tools/PlatformHeader';
import {tools,retiredTools,findTool} from '../src/lib/tools/registry';

test('File tools start with upload only, without settings, preview or result',()=>{
 for(const tool of tools.filter(t=>t.input==='files')){
  const html=renderToStaticMarkup(<ToolWorkspace tool={tool} locale="en"/>);
  assert.ok(html.includes('dk-flow-drop'),tool.id);
  assert.ok(!html.includes('dk-flow-fields'),tool.id);
  assert.ok(!html.includes('dk-flow-result-item'),tool.id);
  assert.ok(!html.includes('<audio'),tool.id);
 }
});
test('Every curated tool renders in both locales; retired tools are absent from lookup',()=>{
 for(const locale of ['en','pt'] as const)for(const tool of tools)assert.ok(renderToStaticMarkup(<ToolWorkspace tool={tool} locale={locale}/>).length>100);
 assert.equal(retiredTools.length,15);for(const tool of retiredTools)assert.equal(findTool(tool.id),undefined);
});
test('SVG studio initially exposes editing, with code and export results closed',()=>{
 const html=renderToStaticMarkup(<ToolWorkspace tool={findTool('svg/editor')!} locale="en"/>);
 assert.ok(html.includes('Drawing canvas'));assert.ok(!html.includes('<textarea'));assert.ok(!html.includes('Export preview'));
});
test('Language selector displays one active flag and support remains visible',()=>{
 const html=renderToStaticMarkup(<PlatformHeader locale="pt" onLocale={()=>{}}/>);
 assert.ok(html.includes('/br.svg'));assert.ok(!html.includes('/us.svg'));assert.ok(html.includes('Apoie o DK'));assert.ok(html.includes('aria-expanded="false"'));
});
