import { applyVersionedEdits, type GeneratorSnapshot } from './versionedEdits';
import type { PilotVerification } from './pilotVerifier';

export type WorkbenchResponsiveRepair = Readonly<{
  snapshot: GeneratorSnapshot;
  kind: 'mobile-hidden-essential-nav-action' | 'percentage-grid-gap-overflow' | 'mobile-unresponsive-grid-collapse';
  path: 'src/styles.css' | 'src/App.tsx';
  line: number;
  column: number;
}>;

const escapeRegExp=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/** Restores a journey-proven essential nav action hidden by an explicit mobile rule, or fixes 390px overflow. */
export function applyKnownWorkbenchResponsiveRepair(base:GeneratorSnapshot,report:PilotVerification,newRevision:string):WorkbenchResponsiveRepair|null{
  const css=base.files.find(file=>file.path==='src/styles.css');
  const app=base.files.find(file=>file.path==='src/App.tsx');

  if(report.failures.some(failure=>failure.includes('Horizontal overflow after interaction.')||failure.includes('platform:responsive-layout'))){
    // 1. Check App.tsx for un-breakpoint-prefixed grid-cols-[2-6]
    if(app && /(?<!sm:|md:|lg:|xl:)grid-cols-[2-6]\b/.test(app.content) && !app.content.includes('grid-cols-1')) {
      const replacement = app.content.replace(/(?<!sm:|md:|lg:|xl:)grid-cols-([2-6])\b/g, 'grid-cols-1 sm:grid-cols-$1');
      if (replacement !== app.content) {
        const snapshot=applyVersionedEdits(base,{scope:base.scope,baseRevision:base.revision,baseHash:base.hash,newRevision,operations:[{
          kind:'replace',path:app.path,expectedHash:app.hash,search:app.content,replacement,
        }]});
        return {snapshot,kind:'mobile-unresponsive-grid-collapse',path:'src/App.tsx',line:1,column:1};
      }
    }

    // 2. Check CSS percentage grid gap overflow
    if(css) {
      const candidates:{start:number;end:number;replacement:string}[]=[];
      for(const rule of css.content.matchAll(/([^@{}]+)\{([^{}]*)\}/g)){
        const body=rule[2];if(!/display\s*:\s*grid/i.test(body))continue;
        const columns=/grid-template-columns\s*:\s*([0-9]+(?:\.[0-9]+)?)%\s+([0-9]+(?:\.[0-9]+)?)%/i.exec(body);
        const gap=/(?:^|;)\s*(?:column-)?gap\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i.exec(body);
        if(!columns||!gap||Number(columns[1])+Number(columns[2])+Number(gap[1])<=100)continue;
        const bodyStart=(rule.index||0)+rule[0].indexOf(body),start=bodyStart+(columns.index||0),end=start+columns[0].length;
        candidates.push({start,end,replacement:`grid-template-columns:${columns[1]}fr ${columns[2]}fr`});
      }
      if(candidates.length===1) {
        const found=candidates[0],replacement=`${css.content.slice(0,found.start)}${found.replacement}${css.content.slice(found.end)}`;
        const snapshot=applyVersionedEdits(base,{scope:base.scope,baseRevision:base.revision,baseHash:base.hash,newRevision,operations:[{
          kind:'replace',path:css.path,expectedHash:css.hash,search:css.content,replacement,
        }]});
        return {snapshot,kind:'percentage-grid-gap-overflow',path:'src/styles.css',line:css.content.slice(0,found.start).split(/\r?\n/).length,column:0};
      }
    }
  }
  const details=report.checks.find(check=>check.id.startsWith('journey:')&&!check.passed&&check.details.includes('element is not visible'))?.details||'';
  const targetId=/getByTestId\('([^']+)'\)/.exec(details)?.[1];
  if(!targetId||!app||!css)return null;
  const target=new RegExp(`data-testid=["']${escapeRegExp(targetId)}["']`).exec(app.content);
  if(!target)return null;

  // 1. Check if the target element's class has a display:none rule in styles.css
  const tagStart=app.content.lastIndexOf('<',target.index),tagEnd=app.content.indexOf('>',target.index);
  if(tagStart>=0&&tagEnd>target.index){
    const tagContent=app.content.slice(tagStart,tagEnd);
    const classMatch=/class(?:Name)?=["']([^"']+)["']/.exec(tagContent);
    const classes=classMatch?classMatch[1].split(/\s+/).filter(Boolean):[];
    for(const cls of classes){
      const classRuleRegex=new RegExp(`(\\b\\.${escapeRegExp(cls)}\\s*\\{[^}]*display\\s*:\\s*)none(\\s*;?[^}]*\\})`,'i');
      const match=classRuleRegex.exec(css.content);
      if(match){
        const start=match.index+match[1].length;
        const end=start+4; // 'none'.length
        const replacement=`${css.content.slice(0,start)}inline-flex${css.content.slice(end)}`;
        const snapshot=applyVersionedEdits(base,{scope:base.scope,baseRevision:base.revision,baseHash:base.hash,newRevision,operations:[{
          kind:'replace',path:css.path,expectedHash:css.hash,search:css.content,replacement,
        }]});
        return {snapshot,kind:'mobile-hidden-essential-nav-action',path:'src/styles.css',line:css.content.slice(0,match.index).split(/\r?\n/).length,column:0};
      }
    }
  }

  // 2. Check if the element is inside a nav hidden by a mobile rule
  const navStart=app.content.lastIndexOf('<nav',target.index),navEnd=app.content.indexOf('</nav>',target.index);
  if(navStart<0||navEnd<target.index)return null;
  const mediaStart=css.content.search(/@media\s*\(\s*max-width\s*:/i);
  if(mediaStart<0)return null;
  const mobile=css.content.slice(mediaStart),hidden=/nav\s*\{\s*display\s*:\s*none\s*;?\s*\}/i.exec(mobile);
  if(!hidden)return null;
  const start=mediaStart+hidden.index,end=start+hidden[0].length;
  const replacement=`${css.content.slice(0,start)}nav{display:flex;margin-left:auto}nav a{display:none}${css.content.slice(end)}`;
  const snapshot=applyVersionedEdits(base,{scope:base.scope,baseRevision:base.revision,baseHash:base.hash,newRevision,operations:[{
    kind:'replace',path:css.path,expectedHash:css.hash,search:css.content,replacement,
  }]});
  return {snapshot,kind:'mobile-hidden-essential-nav-action',path:'src/styles.css',line:css.content.slice(0,start).split(/\r?\n/).length,column:0};
}
