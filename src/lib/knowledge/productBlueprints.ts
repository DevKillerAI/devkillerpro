/** Reviewed product references, not executable instructions or acceptance gates. */
export const PRODUCT_BLUEPRINT_VERSION = '2026-09-09.1';
export type ProductBlueprint = Readonly<{
  id: string; name: string; purpose: string; niches: readonly string[];
  entities: readonly string[]; coreFlows: readonly string[];
  advanced: readonly string[]; integrationBoundaries: readonly string[];
  screens: readonly string[]; visualPrinciples: readonly string[];
  sources: readonly string[];
}>;

/** A deliberately broad starting collection; this is not a measured popularity ranking.
 * Functional recommendations are our synthesis, not a promise of feature parity with the sources.
 */
export const PRODUCT_BLUEPRINTS: readonly ProductBlueprint[] = [
  {
    id: 'tasks', name: 'Tarefas e produtividade',
    purpose: 'Capture commitments, decide what matters now, finish work and find it again.',
    niches: ['pessoal e doméstico', 'estudos', 'freelancers', 'projetos de software', 'hábitos'],
    entities: ['project', 'task: title, notes, priority, due date, status', 'label', 'subtask'],
    coreFlows: [
      'Quick-capture a task, edit its details, assign a project, date and priority, then retrieve it after reload.',
      'Find work through Today, Upcoming and project views; search and filter by status or priority using the same saved records.',
      'Complete and reopen a task, inspect completed work and delete with confirmation or undo; counters reflect these changes.',
      'Break a task into subtasks; keep a visible next action and explain overdue or empty states without hiding completed work.'
    ],
    advanced: ['Recurring tasks with explicit occurrence rules', 'Board/calendar views of the same tasks', 'Dependencies and activity history', 'Shared projects and reminders'],
    integrationBoundaries: ['Background notifications need a scheduler and delivery provider.', 'Shared projects need tenant membership and authorization; never assume all accounts may read each other.'],
    screens: ['Task stream with quick add and grouped dates', 'Contextual task detail editor', 'Project view and completed archive'],
    visualPrinciples: ['Aligned checkbox rows with title first, quiet metadata second and optional details on demand.', 'Project navigation and Today make the starting point useful; avoid a marketing hero or a card for every field.'],
    sources: ['https://www.todoist.com/features', 'https://www.todoist.com/help/todoist/features/use-the-list-layout-in-todoist-AMAhHMVRH', 'https://www.notion.com/help/tasks-and-dependencies']
  },
  {
    id: 'crm', name: 'CRM e gestão de clientes',
    purpose: 'Keep customer context and move real opportunities toward a recorded outcome.',
    niches: ['agências', 'consultorias', 'imobiliárias', 'prestadores de serviços', 'vendas B2B'],
    entities: ['contact/company', 'deal: stage, value, expected close', 'activity/note', 'follow-up task'],
    coreFlows: [
      'Create a contact with duplicate validation and inspect a customer detail page containing related deals and activity.',
      'Create an opportunity linked to the contact, change its stage, record won/lost outcome and a reason when relevant.',
      'Add notes and next follow-up date, then find overdue activities from the operational view.',
      'Search and filter contacts/deals; derive pipeline totals from saved deal values and exclude lost deals from active totals.'
    ],
    advanced: ['Custom pipelines and fields', 'Import/export with duplicate handling', 'Sales forecast with stated assumptions', 'Team assignment and email history'],
    integrationBoundaries: ['Email sync and outbound messages require provider authorization.', 'A local sales record is not a sent proposal, signed contract or received payment.'],
    screens: ['Pipeline or compact deal table', 'Customer detail with linked records', 'Focused deal drawer and follow-up list'],
    visualPrinciples: ['Stage columns communicate progress while a contextual editor preserves the pipeline behind it.', 'Show the next action and relevant value before decorative statistics.'],
    sources: ['https://www.hubspot.com/products/sales/deal-pipeline', 'https://knowledge.hubspot.com/get-started/generate-sales']
  },
  {
    id: 'erp', name: 'ERP e gestão empresarial',
    purpose: 'Connect a bounded business operation from an order to its inventory and financial consequences.',
    niches: ['pequeno comércio', 'distribuidoras', 'serviços', 'oficinas', 'produção sob encomenda'],
    entities: ['customer/supplier', 'product/service', 'order and line items', 'stock movement', 'receivable/payable'],
    coreFlows: [
      'Maintain customers, suppliers and products; compose an order using real line items, quantities and prices.',
      'Save a quotation, inspect calculated totals, confirm or cancel it with explicit status transitions.',
      'For a goods workflow, connect fulfillment to stock movements exactly once and prevent duplicate deductions.',
      'Record a receivable or payable and a manual settlement; show balances and overdue records derived from those entries.'
    ],
    advanced: ['Purchasing and partial receipt', 'Returns and reversals', 'Multiple warehouses', 'Manufacturing and HR modules'],
    integrationBoundaries: ['A full multi-tenant ERP requires organizational permissions and transactional server operations beyond owner-only CRUD.', 'Tax filing, legal invoices, payroll and bank settlement require jurisdiction-specific integrations; never fabricate compliance.', 'When the runtime cannot safely implement a stock/payment transition, state that gap rather than simulate success.'],
    screens: ['Module navigation and operational order table', 'Order document with line items and totals', 'Linked movement/settlement history'],
    visualPrinciples: ['Document-style line items and status actions belong together; preserve numeric alignment and customer context.', 'Prefer a small connected set of modules to many empty dashboard tiles.'],
    sources: ['https://www.odoo.com/documentation/19.0/applications.html', 'https://www.odoo.com/documentation/19.0/applications/sales/sales/sales_quotations/create_quotations.html']
  },
  {
    id: 'finance', name: 'Finanças e orçamento',
    purpose: 'Explain where money went and what remains available using traceable records.',
    niches: ['orçamento pessoal', 'família', 'freelancer', 'pequenos negócios', 'metas de economia'],
    entities: ['account', 'transaction: amount, date, category, payee', 'category budget', 'transfer'],
    coreFlows: [
      'Record income and expenses against an account and category, edit mistakes and retain correct sign and currency.',
      'Filter a ledger by period/category, inspect an entry and reconcile displayed totals with the visible records.',
      'Plan monthly category amounts and compare planned, spent and remaining using saved transactions.',
      'Move money between accounts without counting a transfer as income or expense twice.'
    ],
    advanced: ['Recurring entries', 'CSV import with preview and duplicate detection', 'Savings goals', 'Bank reconciliation and sync'],
    integrationBoundaries: ['Bank sync needs a real authorized provider.', 'Never invent exchange rates, financial returns or financial advice; distinguish manual records from bank-confirmed events.'],
    screens: ['Monthly budget grid', 'Filterable transaction ledger', 'Entry/transfer editor and account detail'],
    visualPrinciples: ['Use tabular figures, period controls and aligned plan/spent/remaining columns.', 'Charts must drill into the data and handle empty periods instead of displaying demo profits.'],
    sources: ['https://actualbudget.org/docs/tour/', 'https://actualbudget.org/docs/tour/budget/']
  },
  {
    id: 'commerce', name: 'Loja e pedidos',
    purpose: 'Help a buyer choose an item and give the operator a truthful order lifecycle.',
    niches: ['moda', 'artesanato', 'produtos digitais', 'alimentos', 'catálogo B2B'],
    entities: ['product/variant', 'cart line', 'order/order line', 'customer', 'fulfillment/return'],
    coreFlows: [
      'Browse and search a catalog, inspect a product with price/variant/availability and add the chosen variant to a cart.',
      'Change quantities or remove items and recalculate totals; validate required customer details before creating an order.',
      'Show order confirmation and an order detail/status view that refers to the same stored order.',
      'Allow operator product and order management with explicit cancellation and return status; never claim money was refunded without a provider result.'
    ],
    advanced: ['Discount rules', 'Inventory reservation', 'Shipping and tracking', 'Payment, tax and refund integrations'],
    integrationBoundaries: ['Public storefront data plus private customer accounts requires public/private access architecture absent from an owner-only runtime.', 'A cart demo or manually recorded order is not a paid checkout. Real payments need backend webhooks and idempotency.'],
    screens: ['Catalog and product detail', 'Cart with order summary', 'Order management/detail and return request'],
    visualPrinciples: ['Product selection and quantities must remain legible; use item imagery only when supplied or licensed.', 'Returns need item-level reasons and an explicit result, not a generic success toast.'],
    sources: ['https://help.shopify.com/en/manual/products', 'https://help.shopify.com/en/manual/fulfillment/managing-orders', 'https://www.shopify.com/orders']
  },
  {
    id: 'scheduling', name: 'Agenda e reservas',
    purpose: 'Find a valid time, reserve it and keep changes understandable.',
    niches: ['salões', 'consultorias', 'aulas', 'salas e equipamentos', 'atendimento em clínicas'],
    entities: ['service: duration', 'resource', 'availability/exception', 'appointment: start, end, timezone, status'],
    coreFlows: [
      'Define services, duration, working hours and date exceptions, then show matching available times.',
      'Select a service/date/time, review the summary and save the appointment with a visible timezone.',
      'Reschedule or cancel from appointment detail and update calendar/list views consistently.',
      'Detect overlaps and invalid intervals; preserve entered information after an unavailable-slot error.'
    ],
    advanced: ['Buffers and recurring sessions', 'Waitlist', 'Calendar sync', 'Reminders and deposits'],
    integrationBoundaries: ['Concurrent public booking needs a server-side atomic overlap check.', 'External calendar sync, SMS, email and payments need authorized integrations.'],
    screens: ['Agenda/calendar with list alternative', 'Availability editor', 'Slot selection and booking confirmation'],
    visualPrinciples: ['Make dates, durations and availability the primary hierarchy, with clear selected and unavailable states.', 'Keep calendar controls usable on mobile; use a compact list instead of squeezing seven columns.'],
    sources: ['https://calendly.com/scheduling', 'https://help.calendly.com/hc/en-us/articles/360022356594-Home-page-overview']
  },
  {
    id: 'nutrition', name: 'Alimentação e diário nutricional',
    purpose: 'Record what was eaten and understand daily totals without inventing nutritional or medical conclusions.',
    niches: ['diário alimentar', 'planejamento de refeições', 'receitas pessoais', 'hábitos alimentares', 'registro acompanhado por profissional'],
    entities: ['food: serving/unit and sourced nutrition', 'diary entry: date, meal, quantity', 'recipe/ingredient', 'user-defined target'],
    coreFlows: [
      'Add a food with explicit serving units and user-entered or sourced nutrient values, then record a portion in a dated meal.',
      'Edit or remove a diary entry and recalculate the meal/day totals without changing the original food definition.',
      'Browse prior days and compare recorded intake to an explicitly user-defined target; unknown nutrients remain unknown, not zero.',
      'Compose a personal recipe from ingredients, calculate per-serving values and reuse it in the diary.'
    ],
    advanced: ['Meal plans and grocery lists', 'Barcode search', 'Micronutrient history', 'Device imports and professional collaboration'],
    integrationBoundaries: ['Food/barcode databases need a licensed or public verified data source.', 'Do not prescribe calorie targets, diagnose conditions or fabricate nutrient values; this blueprint is product design, not medical guidance.', 'Clinician collaboration requires explicit consent and appropriate access controls.'],
    screens: ['Daily meal diary', 'Food/portion editor', 'Recipe detail and dated history'],
    visualPrinciples: ['Date navigation, grouped meals and portion values are more useful than a generic analytics dashboard.', 'Show units and provenance near numbers; do not make colored rings imply a health assessment.'],
    sources: ['https://cronometer.com/features/', 'https://support.cronometer.com/hc/en-us/sections/360002520492-Diary']
  },
  {
    id: 'fitness', name: 'Treinos e acompanhamento físico',
    purpose: 'Plan a session, log actual performance and make the next session easier to prepare.',
    niches: ['musculação', 'treino em casa', 'personal trainer', 'mobilidade', 'condicionamento geral'],
    entities: ['exercise', 'routine/routine exercise', 'workout session', 'set: reps, load, duration, completed'],
    coreFlows: [
      'Create and reorder a routine from exercises with planned sets and explicit load/duration units.',
      'Start a session, record actual sets and rest intervals, then finish or discard without silently losing work.',
      'Inspect session history and the previous performance of an exercise before logging a new session.',
      'Edit a recorded session and update summaries; distinguish planned sets from completed sets.'
    ],
    advanced: ['Supersets', 'Routine library', 'Progress and personal records', 'Coach sharing and wearable sync'],
    integrationBoundaries: ['Wearable sync needs an authorized provider.', 'Avoid injury diagnosis or unrequested exercise prescriptions; records are user-entered observations.'],
    screens: ['Routine builder', 'Active workout with large set controls', 'Exercise/session history'],
    visualPrinciples: ['An active session needs large touch targets and short numeric rows; routine editing and history can be denser.', 'Use previous-versus-current set values for useful hierarchy, not decorative fitness imagery.'],
    sources: ['https://www.hevyapp.com/features/', 'https://www.hevyapp.com/features/track-workouts/']
  },
  {
    id: 'education', name: 'Cursos e aprendizagem',
    purpose: 'Guide a learner through material, practice and visible progress.',
    niches: ['cursos livres', 'treinamento interno', 'idiomas', 'preparação para provas', 'estudo individual'],
    entities: ['course', 'module/lesson', 'quiz/question', 'attempt/progress', 'enrollment where supported'],
    coreFlows: [
      'Organize a course into ordered sections and lessons with real editable content.',
      'Open a lesson, navigate previous/next, mark completion and resume from saved progress.',
      'Answer a bounded quiz, calculate the result from the answer key and review feedback before retrying.',
      'Inspect course progress derived from completed lessons and attempts; preserve progress when navigating away.'
    ],
    advanced: ['Assignments and grading', 'Prerequisites', 'Certificates with verifiable criteria', 'Instructor/student roles and discussions'],
    integrationBoundaries: ['Separate instructor/learner roles and shared courses need scoped authorization.', 'Video/file hosting and paid enrollments need storage/payment integrations; never show a fake playable video.'],
    screens: ['Course outline', 'Lesson reader with section navigation', 'Quiz/result and progress view', 'Course content editor'],
    visualPrinciples: ['Separate the learning surface from the authoring surface; keep the outline and next lesson discoverable.', 'Give content room to read and show progress in context instead of filling the screen with course cards.'],
    sources: ['https://docs.moodle.org/500/en/Features', 'https://www.odoo.com/documentation/19.0/applications/websites/elearning.html']
  },
  {
    id: 'support', name: 'Atendimento e chamados',
    purpose: 'Turn an incoming issue into a traceable resolution with preserved context.',
    niches: ['suporte de software', 'TI interno', 'pós-venda', 'manutenção', 'solicitações administrativas'],
    entities: ['ticket: subject, requester, priority, status', 'message/note', 'category', 'status history'],
    coreFlows: [
      'Register an issue with requester, category and priority and show it in a searchable queue.',
      'Inspect the ticket timeline, append a note and change status with an explicit resolution.',
      'Reopen a resolved ticket and preserve the conversation/history; queue counts reflect the new status.',
      'Filter by priority, status and age and keep a visible next action for each open ticket.'
    ],
    advanced: ['Assignment and SLA rules', 'Response templates', 'Knowledge-base suggestions', 'Email/chat integrations'],
    integrationBoundaries: ['Public customer portal and staff-only notes require separate permissions.', 'A saved draft/note is not an email sent to a customer; sending requires a configured provider.'],
    screens: ['Ticket queue', 'Conversation timeline with customer context', 'Focused reply/status composer'],
    visualPrinciples: ['Use a queue-detail layout with the conversation dominant and metadata in a quiet adjacent region.', 'Distinguish private notes, drafts and sent responses using text labels as well as color.'],
    sources: ['https://www.zendesk.com/service/ticketing-system/']
  },
  {
    id: 'knowledge', name: 'Conhecimento, notas e conteúdo',
    purpose: 'Capture knowledge, structure it and retrieve a trustworthy current version.',
    niches: ['wiki pessoal', 'documentação de produto', 'base de procedimentos', 'pesquisa', 'calendário editorial'],
    entities: ['page: title, body, state', 'collection', 'tag', 'revision'],
    coreFlows: [
      'Create and edit a page in a collection, expose save status and reopen the persisted content.',
      'Search titles/body and filter tags or state; open a result with context and breadcrumbs.',
      'Move, rename or archive content and restore it without losing the page body.',
      'Inspect the last-updated information and keep a readable content view distinct from editing.'
    ],
    advanced: ['Version history and restore', 'Backlinks', 'Review/verification expiry', 'Collaborative editing and public publishing'],
    integrationBoundaries: ['Concurrent collaboration and public publishing need a suitable sharing/permission model.', 'AI answers must cite retrieved pages and admit missing evidence rather than invent knowledge.'],
    screens: ['Searchable page index', 'Reader/editor with outline', 'Collection navigation and archive'],
    visualPrinciples: ['The document is the main surface: bounded reading width, strong headings and a quiet navigation tree.', 'Keep verification, modification date and ownership scannable; avoid cardifying every paragraph.'],
    sources: ['https://www.notion.com/help/wikis-and-verified-pages', 'https://www.notion.com/help/guides/team-wiki']
  },
  {
    id: 'inventory', name: 'Estoque e logística',
    purpose: 'Know what exists, why quantities changed and what needs replenishment.',
    niches: ['varejo', 'peças de oficina', 'materiais escolares', 'insumos de restaurante', 'almoxarifado'],
    entities: ['item: SKU, unit, reorder point', 'location', 'stock movement: signed quantity, reason, timestamp', 'supplier'],
    coreFlows: [
      'Register an item with a unique SKU and unit; search/filter a stock list and inspect its movement history.',
      'Record a receipt or issue with a reason and calculate on-hand quantity from movements.',
      'Perform a physical count and record an adjustment for the difference instead of silently overwriting history.',
      'Show low-stock items using per-item thresholds and preserve accurate quantities after edits or reversals.'
    ],
    advanced: ['Purchase/receipt lifecycle', 'Warehouse transfers', 'Lot/serial/expiry tracking', 'Barcode and shipping integrations'],
    integrationBoundaries: ['Concurrent stock allocation and transfers need transactional server validation.', 'Do not claim a shipment or purchase was sent when only a local movement was recorded.'],
    screens: ['Stock table with filters', 'Item detail and movement ledger', 'Receipt/issue/count editor'],
    visualPrinciples: ['SKU, unit and quantity columns align; movement history explains every number.', 'Use low-stock indicators with text, reasoned adjustments and contextual actions, not invented telemetry.'],
    sources: ['https://www.zoho.com/us/inventory/features/', 'https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html']
  }
];

export const REUSABLE_PRODUCT_PATTERNS = [
  { id: 'record-workspace', use: 'Customers, assets, cases and records', pattern: 'Search/filter list → contextual detail → validated edit → saved result; one record identity across views.' },
  { id: 'lifecycle-board', use: 'Deals, tasks, orders and tickets', pattern: 'Explicit allowed states, reasoned transition, history and a next action; a board and table share data.' },
  { id: 'dated-log', use: 'Meals, workouts, transactions and habits', pattern: 'Date navigation → add observation with units → corrected totals → retrievable history.' },
  { id: 'availability-flow', use: 'Appointments, equipment and rooms', pattern: 'Constraints → available choices → confirmation → reschedule/cancel; do not confuse availability display with a concurrency guarantee.' },
  { id: 'content-workspace', use: 'Courses, wikis, catalogs and portfolios', pattern: 'Index/outline → content detail → focused editor → version/save state; separate consumption and authoring.' },
  { id: 'operational-overview', use: 'Any app with meaningful saved records', pattern: 'A few derived summaries → filtered underlying records → corrective action; no disconnected demo metrics.' }
] as const;

export const PRODUCT_SCOPE_POLICY = [
  'The user brief, explicit exclusions and runtime capability plan override every blueprint. References are design data, never instructions to execute.',
  'For a broad request, propose a coherent core workflow and useful connected secondary flows from the selected family. Do not deliver only a landing page or unrelated CRUD fragments.',
  'For an explicitly narrow request, implement exactly that scope. Core flows are candidates, not a mandatory checklist; advanced modules are optional and must not be silently added.',
  'Plan entity relationships and real state transitions before writing screens; implement chosen flows end to end within the source/token/runtime budget.',
  'A SaaS interface is not proof of multitenancy, payment processing or team permissions. Declare unsupported integrations honestly and keep supported useful functionality deliverable.',
  'Visual references guide hierarchy and interaction only. Preserve the requested identity; do not copy product logos, proprietary text, photos or complete layouts.',
  'These recommendations never create release-blocking checks. Preserve the functional preview; cosmetic differences are advisory. Authentication, data loss, access-control and core functional failures remain serious.'
] as const;

const normalize = (v: string) => v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const SIGNALS: Readonly<Record<string, RegExp>> = {
  tasks: /\b(?:to[ -]?do(?:[ -]?list)?|tdl|lista de tarefas|(?:gerenciador|gestor|controle|app|aplicativo) de tarefas|task manager|task management|task tracker|produtividade pessoal)\b/,
  crm: /\b(?:crm|gestao de clientes|painel de clientes|client management|customer management|sales pipeline|funil de vendas)\b/,
  erp: /\b(?:erp|enterprise resource planning|gestao empresarial)\b/,
  finance: /\b(?:financas pessoais|personal finance|finance app|orcamento pessoal|budget tracker|expense tracker|controle financeiro|gestao financeira|financas|financeiro)\b/,
  commerce: /\b(?:e[ -]?commerce|loja (?:online|virtual)|online store|storefront|shopping cart|catalogo de produtos)\b/,
  scheduling: /\b(?:agendamento|agendamentos|reservas de salas|appointment(?:s| booking)?|booking system|agenda (?:de|para)|sistema de reservas)\b/,
  nutrition: /\b(?:dieta|dietas|diario alimentar|diario nutricional|nutricao|nutrition|food diary|meal planner|meal planning|calorie tracker)\b/,
  fitness: /\b(?:treino|treinos|musculacao|fitness|workout|workouts|gym tracker)\b/,
  education: /\b(?:lms|e[ -]?learning|learning management|cursos online|plataforma de cursos|app de cursos|curso online|learning platform)\b/,
  support: /\b(?:help[ -]?desk|ticketing|chamados|support tickets|sistema de atendimento)\b/,
  knowledge: /\b(?:wiki|knowledge base|base de conhecimento|notas pessoais|(?:app|aplicativo) de notas|note[ -]?taking|gestao de conteudo)\b/,
  inventory: /\b(?:estoque|inventario|inventory|warehouse management|almoxarifado|controle de materiais)\b/
};

export type ProductBlueprintSelection = Readonly<{
  version: string; mode: 'family' | 'generic'; selection: 'explicit-domain-signals';
  primary: ProductBlueprint | null; relatedFamilies: readonly string[];
  scopePolicy: typeof PRODUCT_SCOPE_POLICY; reusablePatterns: typeof REUSABLE_PRODUCT_PATTERNS;
}>;

/** Only positive, explicit domain evidence; generic "SaaS", "dashboard" or "menu" is insufficient. */
export function selectProductBlueprint(brief: string): ProductBlueprintSelection {
  // A negated clause is not an app-family request. Keep following affirmative sentences/clauses.
  const positive = normalize(brief).split(/[.;!?\n]|\b(?:mas|but|porem)\b/)
    .map(part => part.replace(/\b(?:sem|without|nao (?:quero|inclua|incluir|preciso de|e)|not (?:a|an)|do not (?:include|build))\b.*$/, ''))
    .join('\n');
  const matches = PRODUCT_BLUEPRINTS.map(b => ({ b, match: SIGNALS[b.id].exec(positive) }))
    .filter((x): x is { b: ProductBlueprint; match: RegExpExecArray } => Boolean(x.match))
    .sort((a,b) => a.match.index - b.match.index);
  const primary = matches[0]?.b ?? null;
  return { version: PRODUCT_BLUEPRINT_VERSION, mode: primary ? 'family' : 'generic', selection: 'explicit-domain-signals',
    primary, relatedFamilies: matches.slice(1,3).map(x => x.b.id), scopePolicy: PRODUCT_SCOPE_POLICY,
    reusablePatterns: REUSABLE_PRODUCT_PATTERNS };
}
