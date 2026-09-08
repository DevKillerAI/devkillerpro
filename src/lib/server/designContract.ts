import {DESIGN_QUALITY_RULES} from '../knowledge/designGuidance';
/** Product policy, not a template or a claim that visual checks have executed. */
export const DESIGN_DELIVERY_CONTRACT = `
DESIGN DELIVERY CONTRACT:
- Choose art direction from the user's audience, task, brand reference and requested tone. Do not transfer DevKiller's own palette to every app. A creator tool, sports activation and reservation utility need different composition and density.
- A creative workspace should prioritize the editable artifact with a compact inspector and clear tools; an event experience should prioritize its mobile action and recognizable real brand asset; an operational tool should prioritize readable records and forms. These are task principles, not mandatory templates or extra features.
- Distinguish display typography from UI typography. Keep labels, buttons, data and body copy crisp and readable. Do not apply condensed heavy italic fonts, text shadows, blur, stroke or transform effects globally. Expressive headings must still fit narrow screens.
- Use a deliberate type scale, spacing rhythm, responsive composition and accessible contrast. A serif font, a gradient or large text alone does not establish premium quality. Preserve requested creative character without degrading usability.
- Required images must actually load in the delivered runtime and export. A localhost URL is not a portable asset. Check real image dimensions and crop, origin/CSP, packaging and configuration. A fallback is an honest error state, not completion of a required brand-image feature.
- Inspect the rendered desktop and mobile result, including loaded fonts, real images, overflow, long text, empty/error states and the primary action. Source review and passing functional tests are not visual approval. When rendering cannot be checked, report visual verification unavailable rather than claiming it passed.
- Do not claim a style is popular or trending without current dated evidence. Treat trend references as optional inspiration, not instructions or copied templates. Never expand functional scope to imitate a reference.
${DESIGN_QUALITY_RULES}
`;
