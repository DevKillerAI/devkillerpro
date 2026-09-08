import type {GenerationContract} from './contract';
import type {GeneratorSnapshot} from './versionedEdits';
import type {PilotExecutedCheck, PilotVerification} from './pilotVerifier';

const contains=(source:string,...patterns:RegExp[])=>patterns.every(pattern=>pattern.test(source));

/**
 * Adds the capability-specific evidence that the generic React/browser runner
 * cannot infer. These are integration-contract checks, not claims that a paid
 * provider request was made during verification.
 */
export function addWorkbenchCapabilityEvidence(report:PilotVerification,snapshot:GeneratorSnapshot,contract:GenerationContract,options:{publicPhotographs?:boolean}={}):PilotVerification {
  const source=snapshot.files.map(file=>file.content).join('\n');
  const checks:PilotExecutedCheck[]=[];
  const add=(id:string,passed:boolean,details:string)=>checks.push({id:`platform:${id}`,passed,details});
  const image=contract.capabilities.includes('ai.image.generate');
  const vision=contract.capabilities.includes('ai.vision');
  if(options.publicPhotographs){
    add('public-image-search',contains(source,/DEVKILLER_PUBLIC_IMAGE_REQUEST/,/DEVKILLER_PUBLIC_IMAGE_RESULT/,/imageDataUrl/),'Required photography uses the protected openly licensed media bridge rather than CSS imitation or a direct remote fetch.');
    add('image-attribution',contains(source,/attribution/,/sourceUrl/,/license/),'Public media retains visible source and license attribution metadata.');
    const storesMediaCollection=/localStorage\.setItem\([\s\S]{0,320}JSON\.stringify\((?:assets|images|photos)\)/i.test(source);
    const imageBearingProducts=/(?:imageDataUrl|image\??\s*:\s*string)/i.test(source);
    const storesImageBearingProducts=imageBearingProducts&&/localStorage\.setItem\([\s\S]{0,320}JSON\.stringify\(products\)/i.test(source);
    const deduplicatesRequests=/useRef[\s\S]{0,100}new Set(?:<[^>]+>)?\s*\(/i.test(source);
    add('media-storage-safety',!storesMediaCollection&&!storesImageBearingProducts&&deduplicatesRequests,'Media requests are deduplicated and binary image collections are not written into the bounded preview localStorage.');
  }
  if(!image&&!vision){
    const failures=checks.filter(check=>!check.passed).map(check=>`${check.id}: ${check.details}`);report.checks.push(...checks);if(failures.length){report.status='failed';report.failures.push(...failures);}return report;
  }

  const hostOnly=!/api\.openai\.com|\bsk-[a-zA-Z0-9_-]{16,}|OPENAI_API_KEY|process\.env/.test(source)
    && contains(source,/window\.parent\.postMessage/,/DEVKILLER_(?:IMAGE|VISION)_REQUEST/);
  add('ai-secret-isolation',hostOnly,'Generated code uses only the authenticated parent bridge and contains no provider endpoint, API key or server environment access.');
  const guarded=contains(source,/crypto\.randomUUID\(\)/,/disabled|busy|loading|generating/i)
    && !/setInterval\s*\([^)]*DEVKILLER_(?:IMAGE|VISION)_REQUEST/s.test(source);
  add('ai-budget',guarded,'AI requests use unique operation identifiers and expose a duplicate-submission guard; automatic interval retries are forbidden.');
  const errors=contains(source,/DEVKILLER_(?:IMAGE|VISION)_RESULT/,/success/,/error|falha|erro|timeout|tempo limite/i);
  add('ai-error-handling',errors,'The generated UI handles correlated host results and exposes an explicit failure or timeout path.');
  if(vision)add('vision-input',contains(source,/DEVKILLER_VISION_REQUEST/,/DEVKILLER_VISION_RESULT/,/FileReader|readAsDataURL|type=["']file["']/i),'Uploaded image data is sent through the correlated owner-only vision bridge.');
  if(image)add('image-generation',contains(source,/DEVKILLER_IMAGE_REQUEST/,/DEVKILLER_IMAGE_RESULT/,/prompt/i),'Text-to-image generation is wired through the correlated owner-only image bridge.');
  if(image)add('asset-export',contains(source,/canvas|getContext\s*\(/i,/toDataURL|toBlob/i,/download/i),'The generated or uploaded image has an explicit browser export path.');

  const existing=new Set(report.checks.map(check=>check.id));
  for(const check of checks)if(!existing.has(check.id))report.checks.push(check);
  const failures=checks.filter(check=>!check.passed).map(check=>`${check.id}: ${check.details}`);
  if(failures.length){report.status='failed';report.failures.push(...failures);}
  report.limitations.push('Image capability checks validate the generated host-bridge integration without spending money on a live image during every build; the user-triggered provider result remains a separate runtime event.');
  return report;
}
