import { z } from 'zod';

const selector = z.string().min(1).max(300);
const value = z.string().max(2000);
export const browserContractSchema = z.object({
  version: z.literal(1),
  notes: z.string().max(4000).optional(),
  tests: z.array(z.object({
    name: z.string().min(1).max(120),
    viewport: z.object({width:z.number().int().min(320).max(1920),height:z.number().int().min(400).max(1080)}).strict().optional(),
    steps: z.array(z.discriminatedUnion('action',[
      z.object({action:z.literal('click'),selector}).strict(),
      z.object({action:z.literal('fill'),selector,value}).strict(),
      z.object({action:z.literal('select'),selector,value}).strict(),
      z.object({action:z.literal('reload')}).strict(),
      z.object({action:z.literal('expectText'),selector,value:z.string().min(1).max(2000)}).strict(),
      z.object({action:z.literal('expectCount'),selector,count:z.number().int().min(0).max(1000)}).strict(),
      z.object({action:z.literal('expectValue'),selector,value}).strict(),
      z.object({action:z.literal('upload'),selector}).strict(),
      z.object({action:z.literal('download'),selector,png:z.boolean().optional(),width:z.number().int().positive().max(8192).optional(),height:z.number().int().positive().max(8192).optional()}).strict(),
    ])).min(1).max(20).refine(steps=>steps.some(s=>s.action.startsWith('expect')||s.action==='download'),'Each journey must assert an outcome'),
  }).strict()).max(8),
}).strict();

export const BROWSER_TEST_CONTRACT = `BROWSER TEST CONTRACT: For dependency-free static apps with root index.html and no devkiller.runtime.json, include devkiller.browser.json with {"version":1,"tests":[{"name":"Primary journey","steps":[{"action":"click","selector":"#button"},{"action":"expectText","selector":"#result","value":"Expected outcome"}]}]}. Use real selectors and expected outcomes matching this app; never copy the example blindly. Up to 8 independent journeys, 20 steps each. Allowed steps: click(selector), fill/select(selector,value), reload(), expectText/expectValue(selector,value), expectCount(selector,count), upload(selector: file input, uses a synthetic PNG), download(selector: triggers download, optional png:true,width,height). Each journey needs an assertion or download. Optional viewport {width,height}. The trusted runner executes Chromium in an isolated offline container and records mobile/desktop smoke checks, exceptions and declared journeys. Tests cannot execute arbitrary JS, access host files, or call external services. Do not declare live AI/backend checks as passed; those require separate evidence. Preserve real failures and never weaken assertions just to pass. For backend apps this runner is not yet applicable.`;
