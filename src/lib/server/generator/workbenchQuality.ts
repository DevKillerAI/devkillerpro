export type WorkbenchQualityPlan = Readonly<{
  version: 'workbench-quality-v1';
  domain: string;
  experienceShape: string;
  artDirection: string;
  visualRecipe: Readonly<{ id:string; composition:string; typography:string; palette:string; signature:string }>;
  depthStandard: readonly string[];
  media: Readonly<{ requested: boolean; photographic: boolean; direction: string }>;
  avoid: readonly string[];
}>;

const normalize=(value:unknown)=>typeof value==='string'?value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase():'';

type WorkbenchProfile=Readonly<{
  domain:string;
  minimumScore:number;
  signals:ReadonlyArray<readonly [RegExp,number]>;
  experienceShape:string;
  artDirection:string;
  avoid:readonly string[];
}>;

/**
 * Domain selection is evidence-weighted rather than first-keyword-wins. Generic
 * interface words such as "menu", "dashboard", "image" and "budget" are not
 * sufficient evidence by themselves. This keeps navigation menus out of the
 * restaurant profile and quotation forms out of the finance profile.
 */
const PROFILES:ReadonlyArray<WorkbenchProfile>=[
  {domain:'client-operations',minimumScore:8,signals:[[/\b(?:crm|freelancers?|painel de clientes|client management|gestao de clientes|clientes e tarefas)\b/,10]],experienceShape:'An operational client workspace: compact navigation, aligned client rows, actionable task lists, contextual editing and a concise real-data overview. Keep forms in focused drawers or clearly separated edit surfaces.',artDirection:'Quiet professional operations interface. Match the requested brand; use a neutral reading surface, readable 14–16px body text, compact 24–32px section headings, aligned metadata and restrained coral only when requested. Make the empty workspace intentionally composed and immediately actionable.',avoid:['a giant centered form as the entire product','marketing heroes inside the working workspace','decorative metrics or charts without data','every row boxed into a floating card']},
  {domain:'education-school-climate',minimumScore:6,signals:[
    [/\b(?:escola|escolar|escolas|clima escolar|alunos?|estudantes?|professores?|pedagog(?:ia|ico|ica|os?)|turmas?|ensino|colegio|educacional)\b/,8],
    [/\b(?:escuta ativa|comunicacao nao violenta|cnv|mediacao|ocorrencias?|indisciplina|bullying|acolhimento|comunidade escolar|responsaveis)\b/,6],
    [/\b(?:gestor escolar|orientador|direcao escolar|convivencia escolar|pome|school climate)\b/,5],
  ],
    experienceShape:'An educational and school climate platform must communicate welcoming, safety, professional organization, and data-informed restorative practice, prioritizing active listening and nonviolent communication over punitive or disciplinary enforcement.',
    artDirection:'Derive the visual identity from respectful educational institutions: calm forest/sage greens, warm amber alerts, soft neutral slate paper surfaces, and crisp dark graphite typography with accessible WCAG contrast. Use clean editorial hierarchy, structured step-by-step listening guidance, and humane data representations.',
    avoid:['punitive, prison-like or police-style disciplinary visual metaphors','criminalizing or stigmatizing terminology for students','generic dark-neon startup SaaS gradients','unactionable vanity cards displacing pedagogical context']},
  {domain:'built-environment',minimumScore:6,signals:[
    [/\b(?:engenharia(?: civil)?|arquitetura e urbanismo|construcao civil|edificios?|buildings?|retrofit predial|obras? civ(?:il|is)|modelagem bim|canteiro de obras)\b/,8],
    [/\b(?:fachadas?|facades?|torres? predia(?:l|is)|urbanismo|urbanism|imobiliari[oa]|real estate|eficiencia energetica em edificios)\b/,4],
    [/\b(?:construcao sustentavel|edificios? sustentave(?:l|is)|certificacoes? leed|projetos? arquitetonicos? de edificacoes?)\b/,4],
  ],
    experienceShape:'A built-environment site should lead with credible completed work, technical capability and a short path to inspect projects or request a proposal. Project evidence must outrank decorative claims.',
    artDirection:'Derive the visual system from architecture, materials, drawings, construction scale and the firm’s actual positioning. Use project-led editorial composition, disciplined geometry and technical detail without imitating a restaurant, startup dashboard or generic luxury template.',
    avoid:['hospitality or restaurant art direction triggered by navigation terminology','unverified project photography or unrelated stock imagery','a generic startup feature-card grid replacing project evidence']},
  {domain:'corporate-services',minimumScore:6,signals:[
    [/\b(?:site corporativo|corporate (?:site|website)|servicos profissionais|professional services|consultoria|consulting|escritorio|firm|agency|agencia)\b/,7],
    [/\b(?:empresa|company|equipe|team|clientes|clients|portfolio|projetos|projects|depoimentos|testimonials)\b/,2],
  ],
    experienceShape:'A professional-services site should establish positioning, evidence and trust quickly, then make services, proof and contact paths easy to inspect without turning the page into an app dashboard.',
    artDirection:'Build a recognisable editorial identity from the firm’s field, audience and evidence. Vary composition, typography and media treatment by profession instead of reusing one premium-looking hero shell.',
    avoid:['generic startup gradients and interchangeable feature cards','unsupported superlatives or invented client evidence','copying the same split hero across unrelated professions']},
  {domain:'food-hospitality',minimumScore:6,signals:[
    [/\b(?:restaurante|restaurant|cardapio|pratos?|comida|cozinha|culinari[oa]|food|dishes?|meals?|cafeteria|bistro|chef)\b/,8],
    [/(?:\bmenu\b.{0,80}\b(?:food|dish|restaurant|meal|prato|comida|pedido|bebida)\b|\b(?:food|dish|restaurant|meal|prato|comida|pedido|bebida)\b.{0,80}\bmenu\b)/s,3],
    [/(?:\bbar\b.{0,50}\b(?:drink|cocktail|beer|wine|bebida|cerveja|vinho)\b|\b(?:drink|cocktail|beer|wine|bebida|cerveja|vinho)\b.{0,50}\bbar\b)/s,3],
  ],
    experienceShape:'A menu or hospitality experience should lead with appetizing browsing, categories, clear item detail and an always-understandable order path; management belongs in a quieter secondary surface.',
    artDirection:'Derive the visual identity from the cuisine, venue, service style and audience in the brief. Use editorial food hierarchy, intentional whitespace and a palette that belongs to that venue rather than a generic SaaS dashboard.',
    avoid:['abstract circles or gradients presented as food photography','a generic equal-card dashboard grid','a giant marketing hero that pushes the menu below the first useful viewport']},
  {domain:'creative-studio',minimumScore:6,signals:[
    [/\b(?:meme|poster|canvas|editor de imagem|image editor|design tool|estudio criativo|creative studio|criador de imagem|image creator|figma|vetor|vetorial|vector|wireframe|artboard|prototipagem|prototipo|diagrama|draw(?:ing)? tool|design editor)\b/,8],
    [/\b(?:editor|studio|creator|imagem|image|video|camadas|layers|ferramenta de design)\b/,2],
  ],
    experienceShape:'A creator product or vector design studio must give the interactive canvas the dominant viewport area, equipped with direct-manipulation bounding boxes (8-point resize handles + rotation), zoom/pan matrix, layer tree hierarchy with z-ordering, and an authoritative design/code inspector with live CSS export.',
    artDirection:'Professional Studio / Figma Pro aesthetic: dark carbon workspace (#0c0d10, #14161b), crisp 1px borders, compact icon rails, luminous accent indicators (#0d99ff, #7c5cff), tabular measurement readouts (X, Y, W, H), and rich multi-screen initial artboard seeds.',
    avoid:['a marketing landing page instead of a working canvas','monolithic single-file architecture without modular components','taking the lazy shortcut of placing only numeric side-panel inputs without on-canvas interactive transform handles','empty canvas seeds with only one blank rectangle','unresponsive toolbars that clip on mobile']},
  {domain:'commerce',minimumScore:6,signals:[
    [/\b(?:loja|store|shop|e-?commerce|catalogo|catalog|carrinho|cart|checkout|vitrine|storefront)\b/,8],
    [/\b(?:produtos?|products?|comprar|buy|preco|price)\b/,3],
  ],
    experienceShape:'A commerce experience should make discovery, comparison, item detail and cart state legible without losing the primary purchase or reservation path.',
    artDirection:'Derive hierarchy and image treatment from the product category and buyer. Product evidence and decision details matter more than decorative dashboard metrics.',
    avoid:['identical cards that hide product differences','invented product imagery','checkout actions that claim real payment when only simulation is available']},
  {domain:'booking-scheduling',minimumScore:6,signals:[
    [/\b(?:reservas?|booking|agenda|calendar|schedule|appointment|agendamento|horarios?)\b/,8],
    [/\b(?:room|sala|recurso|resource|disponibilidade|availability)\b/,2],
  ],
    experienceShape:'A scheduling product should center availability, time conflicts, current selection and a short create/edit/cancel flow rather than a decorative overview.',
    artDirection:'Use temporal hierarchy, calm high-legibility surfaces and domain-specific status cues. Density should follow the schedule, not a generic card template.',
    avoid:['availability hidden behind a marketing hero','status communicated by color alone','decorative cards replacing a usable schedule']},
  {domain:'finance-data',minimumScore:6,signals:[
    [/\b(?:financas?|finance|financeiro|financial|dinheiro|money|investimentos?|investments?|credito|credit|transacoes?|transactions?|contabilidade|accounting)\b/,8],
    [/\b(?:orcamento|budget|analytics|metricas|metrics|despesas?|expenses?|receitas?|revenue)\b/,3],
  ],
    experienceShape:'A finance or data product should lead with trustworthy totals, provenance, comparison and drill-down while keeping data entry and correction close to the result.',
    artDirection:'Favor crisp numeric hierarchy, restrained semantic color and compact evidence-rich layouts appropriate to the audience and risk.',
    avoid:['ornamental gradients that reduce numeric trust','metrics disconnected from saved data','low-contrast or excessively small financial details']},
  {domain:'health-wellbeing',minimumScore:6,signals:[
    [/\b(?:saude|health|medical|medico|clinica|clinic|wellness|fitness|treino|workout|paciente|patient)\b/,8],
  ],
    experienceShape:'A health or wellbeing product should prioritize the next safe action, understandable history and explicit state changes without making unverified medical claims.',
    artDirection:'Use calm, human, accessible visual language derived from the care context; avoid sterile sameness unless the brief actually calls for it.',
    avoid:['unverified health conclusions','alarmist decoration','critical information hidden in novelty interactions']},
  {domain:'enterprise-industrial',minimumScore:6,signals:[
    [/\b(?:erp|industrial|suprimentos|estoque|fornecedores?|ordens? de (?:compra|venda)|tributari[oa]|impostos?|icms|ipi|sku|reposicao|manufatura|logistica|supply chain|almoxarifado)\b/,8],
    [/\b(?:auditoria|audit log|relatorios?|exportar json|tributos?|fiscal)\b/,3],
  ],
    experienceShape:'An industrial operations product should lead with dense inventory status, critical reorder alerts, supplier validation and audit logs with tabular precision.',
    artDirection:'Use an Enterprise Industrial archetype: technical charcoal/slate surfaces, amber/emerald machine telemetry badges, compact data-grid layout, monospace alignment and zero decorative fluff.',
    avoid:['generic startup SaaS gradients','playful cartoon illustrations in an enterprise tool','large marketing heroes displacing operational data']},
  {domain:'developer-productivity',minimumScore:6,signals:[
    [/\b(?:habitos?|tarefas?|tasks?|kanban|todo|todos|backlog|issues?|tracker|workflow|produtividade|productivity|linear|board|prioridade)\b/,8],
    [/\b(?:concluid[oa]|checkbox|progresso|metas|streak)\b/,3],
  ],
    experienceShape:'A productivity application should lead with keyboard-accessible item manipulation, smooth state transitions and immediate visual completion feedback.',
    artDirection:'Use an Obsidian/Linear Dark Tech archetype: pitch black foundation, hairline borders, collapsible sidebar dock, subtle glow indicators and clean typography.',
    avoid:['cluttered dashboard widgets hiding the task list','decorative charts with no relationship to user actions','unresponsive sidebars that break on mobile']},
  {domain:'event-experience',minimumScore:6,signals:[
    [/\b(?:evento|event|festival|ativacao|activation|ticket|ingresso|premio|prize|participante|attendee)\b/,8],
  ],
    experienceShape:'An event experience should make brand recognition and the participant’s next action immediate, with operational details available but visually secondary.',
    artDirection:'Use the event energy, venue and brand cues to create a distinctive responsive rhythm while preserving fast thumb-friendly actions.',
    avoid:['generic corporate dashboard styling','global condensed or distorted text','motion that blocks registration or redemption']},
];

function selectProfile(text:string):WorkbenchProfile|undefined{
  const ranked=PROFILES.map((profile,index)=>({profile,index,score:profile.signals.reduce((sum,[pattern,weight])=>sum+(pattern.test(text)?weight:0),0)}))
    .filter(item=>item.score>=item.profile.minimumScore)
    .sort((a,b)=>b.score-a.score||a.index-b.index);
  return ranked[0]?.profile;
}

const RECIPES:Record<string,ReadonlyArray<WorkbenchQualityPlan['visualRecipe']>>={
  'education-school-climate':[
    {id:'restorative-school-hub',composition:'Welcoming multi-surface educational hub: clear left sidebar or top tab navigation leading to Dashboard, Incidents with contextual guidance, Active Listening step-by-step module, and Nonviolent Communication guidance panels.',typography:'Legible humanist sans-serif headings paired with clean, accessible interface typography and high-contrast badges.',palette:'Institutional calming palette: deep forest/sage green (#1b4332, #2d6a4f), warm amber (#d97706) for non-punitive attention, clean off-white parchment/slate canvas (#f8fafc, #f1f5f9), and deep graphite (#0f172a) text.',signature:'Contextual guidance callouts with respectful non-violent phrasing prompts, chronological timeline cards, and restorative status badges.'},
    {id:'educational-analytics',composition:'Data-informed educational overview with tabular incident breakdown, category distribution, shift concentration, and actionable climate indicators that support human mediation without labeling students.',typography:'Clear tabular numerics with empathetic narrative summaries and accessible status pills.',palette:'Sage, muted navy, warm ochre and calm teal with explicit WCAG 2.1 AA contrast.',signature:'Pedagogical progress rails, supportive listening notes, and restorative agreement checklists.'},
  ],
  'built-environment':[
    {id:'architectural-monograph',composition:'Project-led editorial sequence with asymmetric plans, restrained navigation and one credible built-work image carrying the opening view.',typography:'Architectural display typography is paired with compact technical labels, aligned project facts and highly legible proposal controls.',palette:'Material-derived neutrals, ink-like text and one safety, landscape or brand accent tied to the firm rather than generic luxury beige.',signature:'Use drawing-like rules, coordinates, project numbering or material annotations as a restrained recurring detail.'},
    {id:'technical-portfolio',composition:'Evidence-first portfolio with a measured project index, large documentary media and service capabilities woven between completed-work case studies.',typography:'Confident grotesk or slab display roles with precise tabular metadata for area, location, performance and delivery facts.',palette:'Concrete, steel, glass or landscape tones chosen from the stated specialty, with explicit contrast and minimal ornamental effects.',signature:'Use section grids inspired by elevations or construction modules without turning the interface into a fake blueprint.'},
    {id:'civic-infrastructure',composition:'Broad, grounded visual rhythm that moves from public impact to project evidence, technical approach and a direct proposal path.',typography:'Human but authoritative headings with utilitarian labels and readable long-form case-study text.',palette:'Site- and infrastructure-derived earth, mineral or industrial neutrals with one controlled wayfinding accent.',signature:'Use milestones, section markers or verified impact measures as navigation anchors rather than floating cards.'},
  ],
  'corporate-services':[
    {id:'evidence-led-firm',composition:'A concise positioning statement opens directly into proof, selected work and service detail with deliberately varied section proportions.',typography:'Distinct editorial headline and neutral functional text, with restrained sizing that leaves room for evidence.',palette:'Professional neutrals derived from the field plus one recognisable brand accent; avoid universal navy-and-gradient defaults.',signature:'Use one field-specific evidence device—case notation, annotated process or outcome index—throughout the page.'},
    {id:'point-of-view-practice',composition:'Asymmetric editorial narrative with a strong point of view, alternating concise expertise statements and substantial project or client evidence.',typography:'Expressive but bounded display moments paired with exceptionally readable body and contact typography.',palette:'A subject-derived pair of neutrals and one controlled accent, with whitespace and rules doing more work than cards.',signature:'Use a recurring quotation, margin-note or numbered-principle treatment tied to the practice.'},
    {id:'restrained-institutional',composition:'Clear institutional hierarchy with compact navigation, authoritative overview, verifiable credentials and direct service/contact paths.',typography:'Measured serif or humanist headings with plain, high-legibility interface typography and disciplined line lengths.',palette:'Low-chroma foundation plus a sector-appropriate accent and explicit semantic colors only where state requires them.',signature:'Use a formal grid break, seal-like credential treatment or timeline derived from real content, never decorative badges.'},
  ],
  'food-hospitality':[
    {id:'culinary-editorial',composition:'Asymmetric menu editorial with one featured dish, compact category navigation and a persistent order summary.',typography:'Characterful serif or humanist display face for dish names paired with a crisp system sans for prices, filters and controls.',palette:'Build warm neutrals and one appetite-oriented accent from the cuisine or venue named in the brief; keep food media visually dominant.',signature:'Use restrained menu annotations, ingredient dividers or a chef-note treatment rather than repeated floating cards.'},
    {id:'market-counter',composition:'A lively counter-board rhythm with clear sections, strong price alignment and a short mobile ordering path.',typography:'Confident functional grotesk with a smaller editorial accent; never distort the entire interface.',palette:'Paper, ink and ingredient-derived color roles with high contrast and minimal shadows.',signature:'Use ticket, stamp or handwritten-note details sparingly for offers and preparation notes.'},
    {id:'evening-table',composition:'Immersive but task-first dark dining canvas with cinematic media blocks and compact translucent navigation.',typography:'Elegant high-contrast display type only for titles, with highly readable sans-serif controls and descriptions.',palette:'Deep neutral canvas, warm ivory text and one jewel or ember accent derived from the venue.',signature:'Use subtle reveal and image-crop changes to create atmosphere without delaying ordering.'},
  ],
  'creative-studio':[
    {id:'figma-vector-studio',composition:'Three-column professional studio layout: collapsible layer tree and page navigator on the left, infinite vector canvas with 8-point interactive bounding boxes and zoom/pan matrix in the center, and dual-mode (Design / CSS Code) inspector on the right.',typography:'Crisp system UI typography (-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI") with tabular monospace coordinates and dimension chips.',palette:'Figma Dark Mode: obsidian base (#0d0e12), card elevate (#16181f), border micro-lines (rgba(255,255,255,0.08)), vibrant Figma cyan (#0d99ff) and electric violet (#7c5cff).',signature:'Interactive 8-point resize bounding box with rotation handle, alignment guides, zoom controls, and exportable CSS code panel.'},
    {id:'editorial-workbench',composition:'Large live artifact stage with a narrow contextual inspector and compact command bar.',typography:'Editorial display labels for the artifact paired with neutral high-legibility tool typography.',palette:'Quiet canvas neutrals with one saturated editing accent and semantic state colors.',signature:'Make the current artifact or selection cross the panel grid so the tool feels authored rather than boxed.'},
    {id:'darkroom-console',composition:'Dark focused canvas surrounded by low-chrome tools, timeline or layers only when requested.',typography:'Compact technical sans for controls with one expressive preview type role.',palette:'Near-black work surface, neutral chrome and a single luminous accent chosen from the requested medium.',signature:'Use purposeful handles, guides and selection outlines; avoid decorative dashboard statistics.'},
    {id:'modular-poster-desk',composition:'Strong modular grid where preview, presets and inspector have intentionally unequal visual weight.',typography:'Bold display scale inside the artifact; restrained system typography everywhere else.',palette:'Two neutrals plus two controlled creative swatches tied to the brief.',signature:'Use a visible baseline/grid motif or crop marks that support creation rather than generic decoration.'},
  ],
  commerce:[
    {id:'catalog-atelier',composition:'Image-led catalog with editorial breathing room, quick comparison and a persistent but quiet cart path.',typography:'Product names get a distinct display role while specifications, prices and actions remain compact and crisp.',palette:'Material-inspired neutrals and one brand/product accent rather than a generic SaaS blue.',signature:'Use deliberate image crops and product-detail callouts instead of identical dashboard cards.'},
    {id:'technical-comparison',composition:'Dense but readable comparison workspace with aligned specifications, provenance and totals.',typography:'Tabular numeric emphasis with neutral UI text and restrained display headings.',palette:'Low-saturation foundation with semantic compatibility, warning and selection colors.',signature:'Use alignment rails or comparison bands that make differences visible at a glance.'},
    {id:'boutique-narrative',composition:'Curated collection rhythm with a few large product moments and compact supporting rows.',typography:'Expressive collection title paired with direct commerce typography.',palette:'Palette follows the product materials and audience; borders and whitespace do more work than shadows.',signature:'Use collection notes or material swatches as the distinctive detail.'},
  ],
  'booking-scheduling':[
    {id:'calendar-ledger',composition:'Schedule-first split view with availability and the selected reservation sharing the primary viewport.',typography:'Compact date/time hierarchy with a restrained display role for location or room identity.',palette:'Calm neutral surfaces with explicit semantic states that are never color-only.',signature:'Use a clear time rail and adjacency treatment instead of a generic list of cards.'},
    {id:'spatial-agenda',composition:'Room or resource navigation paired with a focused day agenda and contextual booking drawer.',typography:'Readable system typography with distinct numeric time rhythm.',palette:'Architectural neutrals and one domain accent derived from the space or service.',signature:'Use room markers, floor-like divisions or resource bands without faking a map.'},
  ],
  'finance-data':[
    {id:'personal-ledger',composition:'Transaction and budget ledger with a concise summary strip and correction actions close to each figure.',typography:'Tabular figures, strong labels and modest editorial section titles.',palette:'Paper or graphite foundation with restrained positive, warning and negative roles.',signature:'Use ruled-ledger alignment or category bars derived from actual data.'},
    {id:'analyst-desk',composition:'Evidence-rich dashboard with one dominant analytical view, compact filters and drill-down details.',typography:'Neutral UI typography with a clear numeric scale and no oversized vanity metrics.',palette:'Low-chroma canvas with a single analytical accent and accessible semantic colors.',signature:'Use aligned comparison baselines and provenance notes rather than decorative charts.'},
  ],
  'health-wellbeing':[
    {id:'calm-care-path',composition:'Next-action and history flow with supportive guidance, clear progress and accessible touch targets.',typography:'Warm humanist headings with exceptionally legible body and form text.',palette:'Soft natural neutrals with one reassuring accent and unambiguous semantic states.',signature:'Use a gentle path or rhythm marker tied to real progress, never decorative medical claims.'},
    {id:'active-coach',composition:'Mobile-first session view with immediate action, compact history and optional coaching details.',typography:'Energetic display moments balanced by calm readable controls.',palette:'High-contrast foundation with a controlled energetic accent appropriate to the activity.',signature:'Use real session progress and motion feedback rather than generic rings or fake metrics.'},
  ],
  'event-experience':[
    {id:'live-activation',composition:'Brand-first mobile action surface with one immediate participant step and operational context behind it.',typography:'Expressive event display type limited to headlines; clean, large and stable action typography.',palette:'Derive strong contrast and accent roles from the event identity or supplied brand.',signature:'Use a stage, ticket, badge or checkpoint motif tied to the actual interaction.'},
    {id:'festival-guide',composition:'Layered program and discovery rhythm with time, location and save state always scannable.',typography:'Bold program headings with compact schedule metadata.',palette:'A controlled festive palette with neutral reading surfaces; do not saturate every section.',signature:'Use schedule bands or venue markers rather than a corporate card grid.'},
  ],
  'enterprise-industrial':[
    {id:'industrial-cockpit',composition:'Telemetry metric strip, module-segmented workspace and high-contrast data grid with inline filters and modal actions.',typography:'Monospace tabular data paired with crisp operational UI labels.',palette:'Deep charcoal slate (#12151a), warning amber (#f59e0b) and signal emerald (#10b981).',signature:'Use telemetry chips, SKU code blocks, status pill badges and audit log rails.'},
    {id:'supply-matrix',composition:'Master-detail split surface: supplier/inventory hierarchy on the left with dedicated order processing workspace on the right.',typography:'Tabular financial figures with clear tax/margin breakdowns.',palette:'Graphite foundation with industrial safety accents and subtle grid borders.',signature:'Use ruled data lines and high-contrast status pills.'},
  ],
  'developer-productivity':[
    {id:'linear-workspace',composition:'Collapsible navigation sidebar on desktop, focused item board or list, and contextual detail inspector.',typography:'Snappy UI typography with keyboard shortcut badges.',palette:'Pitch-black canvas (#08090a), micro-borders (rgba(255,255,255,0.06)), and electric indigo/violet active states.',signature:'Use hairline dividers, glowing status dots and subtle hover highlights.'},
    {id:'focus-flow',composition:'Clean central task stream with category chips, progress ring/bar, and floating quick-capture bar.',typography:'Humanist sans with high-legibility checkbox rows and tabular counters.',palette:'Dark obsidian foundation with vibrant emerald completion feedback.',signature:'Use animated strike-throughs and tactile state pill indicators.'},
  ],
  'client-operations':[{id:'client-operations-desk',composition:'A 220px navigation rail, compact page toolbar, short metric strip and main master/detail work surface. Mobile navigation collapses into accessible tabs. Client and task rows align title, metadata, status and actions.',typography:'System sans with 14–16px body, 12px metadata, 28px page headings and tabular figures; retain clear weight and contrast differences.',palette:'Two neutral surfaces, dark text, a single user-requested accent and semantic status colors with text labels.',signature:'Purposeful empty states with concise guidance and a real create action, subtle dividers and contextual detail drawers.'}],
  'general-product':[

    {id:'focused-tool',composition:'One primary workspace with secondary information progressively disclosed, not a landing page plus cards.',typography:'Clear functional hierarchy with one subject-specific display role.',palette:'Neutral foundation and an accent inferred from the audience and subject rather than DevKiller.',signature:'Turn one meaningful domain object or action into the recurring visual motif.'},
    {id:'editorial-utility',composition:'Asymmetric editorial shell wrapped around a compact, immediately usable task surface.',typography:'Distinct display and functional roles with bounded measure and strong small-screen behavior.',palette:'Two quiet neutrals plus a deliberate subject-derived accent.',signature:'Use one non-card composition break—rule, inset, rail or anchored control—to create identity.'},
  ],
};

function selectRecipe(domain:string,text:string){
  const candidates=RECIPES[domain]??RECIPES['general-product'];
  let score=2166136261;
  for(const character of text)score=Math.imul(score^character.charCodeAt(0),16777619)>>>0;
  return candidates[score%candidates.length];
}

export function createWorkbenchQualityPlan(brief:string,briefingMode:'simple'|'detailed'):WorkbenchQualityPlan{
  const text=normalize(brief);
  const profile=selectProfile(text)??{
    domain:'general-product',
    experienceShape:'Derive the main working surface from the user, core entity and primary verb in the brief. Put the real task before marketing decoration.',
    artDirection:'Choose a specific visual metaphor, composition and typographic contrast from the subject matter. Do not reuse DevKiller styling or a generic dashboard by default.',
    avoid:['an interchangeable card grid','a random gradient used as identity','a large hero with no relationship to the main task'],
  };
  const mediaText=text.replace(/\b(?:sem|without|no)\s+(?:imagens?|fotos?|images?|photos?|galeria|gallery|thumbnails?)(?:\s*(?:,|\/|e\b|ou\b|and\b|or\b)\s*(?:imagens?|fotos?|images?|photos?|galeria|gallery|thumbnails?))*/g,'');
  const mediaRequested=/(imagem|imagens|foto|fotos|image|images|photo|photos|galeria|gallery|thumbnail|produto visual|visual do produto)/.test(mediaText);
  const photographic=mediaRequested&&(/(real|realista|realistic|fotograf|food|dish|prato|comida|produto|product)/.test(text)||profile.domain==='food-hospitality'||profile.domain==='commerce');
  const depthStandard=[
    'Implement the complete primary happy path from first meaningful input to a visible saved or derived result.',
    'Cover every explicit core feature that fits the capability plan; do not silently reduce the brief to one form or one static screen.',
    'For editable domain records, include the applicable create, inspect, update, remove/cancel and persistence behavior without inventing production integrations.',
    'Anticipate realistic empty, invalid, duplicate, error, success and recovery states, and preserve user input when an action fails.',
    'Derive totals, counts and statuses from actual application state and keep the main workflow usable at desktop and mobile widths.',
    ...(profile.domain === 'creative-studio' ? [
      'Implement real on-canvas direct manipulation: interactive 8-point resize handles and rotation on selected elements, not just side-panel inputs.',
      'Seed the canvas with rich, realistic, high-density multi-screen prototypes (e.g. mobile app and desktop cards with realistic content), never blank screens or single generic rectangles.',
    ] : []),
    ...(briefingMode==='detailed'?['Implement coherent secondary workflows and cross-feature state transitions explicitly requested by the detailed brief; do not leave decorative controls or dead navigation.']:[]),
  ];
  const visualRecipe=selectRecipe(profile.domain,text);
  return {version:'workbench-quality-v1',domain:profile.domain,experienceShape:profile.experienceShape,artDirection:profile.artDirection,visualRecipe,depthStandard,
    media:{requested:mediaRequested,photographic,direction:mediaRequested
      ? photographic
        ? 'Images are product content. Use only supplied, uploaded or genuinely generated image data. Never imitate a photograph with CSS circles, gradients, emoji or abstract geometry. If real media is not available yet, show a polished explicit empty-media state and keep the upload/generation path usable.'
        : 'Treat requested media as real content with intentional aspect ratio, crop, loading, empty and error states. Do not substitute an arbitrary badge or initial.'
      : 'Purposeful CSS or inline SVG illustration is allowed when it supports the chosen identity, but it must not pretend to be a real product or documentary image.'},
    avoid:[...profile.avoid,'DevKiller colors or shell styling copied into the generated product','the same radius, border and shadow on every region','large headings that crowd out the working interface']};
}

