type Finding = {file?:string;description:string;requiredFix?:string;severity?:string};
/** Conservative routing: unknown findings remain defects, never automatic passes. */
export function recoveryRouting(issues:Finding[]) {
  const blocking=issues.filter(issue=>issue.severity!=='minor');
  const verification=blocking.filter(issue=>
    /(?:evidence|verification|checks?|tests?).{0,90}(?:missing|absent|not (?:yet )?(?:executed|performed|verified|supplied)|did not run|unavailable)|(?:missing|no).{0,60}(?:browser|execution|evidence)/i.test(issue.description)
    && (!issue.file || /(?:readme|qa|report)/i.test(issue.file)));
  const defects=blocking.filter(issue=>!verification.includes(issue));
  return {route:blocking.length>0&&defects.length===0?'verification':'repair',verification,defects} as const;
}
