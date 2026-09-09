/** Public-source image provenance. Screenshots were inspected; only our visual descriptions are sent to the model. */
export type ProductVisualReference = Readonly<{ id:string; family:string; sourcePage:string; imageUrl:string; reviewedAt:string; reviewMode:string; deliveryToModel:'text-description-not-image'; localEvidenceSha256:string; observations:readonly string[] }>;
export const PRODUCT_VISUAL_REFERENCES: readonly ProductVisualReference[] = [
  {
    "id": "tasks-reference-1",
    "family": "tasks",
    "sourcePage": "https://www.todoist.com/features",
    "imageUrl": "https://res.cloudinary.com/imagist/image/upload/f_auto,q_auto/v1772543350/product-ui/scenes/en/Projects-green",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "936b62ecd3eceb3e6186fb35a2603b51f1554550f4ca43948382da45c440f863",
    "observations": [
      "Project navigation stays visible beside grouped checkbox rows; task labels dominate metadata.",
      "Use the compact list interaction, not the promotional green backdrop or sample task wording."
    ]
  },
  {
    "id": "crm-reference-1",
    "family": "crm",
    "sourcePage": "https://www.hubspot.com/products/sales/deal-pipeline",
    "imageUrl": "https://www.hubspot.com/hs-fs/hubfs/Screenshot%202024-07-29%20at%204.18.56%20PM.png?width=540&name=Screenshot%202024-07-29%20at%204.18.56%20PM.png",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "d0f43634d0aedc09a850c3642e7feda6c0c0ac9b8f8b842278ac05c6032f5082",
    "observations": [
      "The deal board remains visible behind a bounded create-deal drawer.",
      "Separate stage/value context from editable fields; preserve filters when closing details."
    ]
  },
  {
    "id": "erp-reference-1",
    "family": "erp",
    "sourcePage": "https://www.odoo.com/documentation/19.0/applications/sales/sales/sales_quotations/create_quotations.html",
    "imageUrl": "https://www.odoo.com/documentation/19.0/_images/quotation-form.png",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "dc0c833977a2d2cd196c9f0c01be9748902a11d8776e25350d59eded22de4578",
    "observations": [
      "A quotation is a document: customer and terms above tabbed line items, calculated totals below.",
      "Keep status actions in a stable toolbar and line-item numbers aligned."
    ]
  },
  {
    "id": "finance-reference-1",
    "family": "finance",
    "sourcePage": "https://actualbudget.org/docs/tour/budget/",
    "imageUrl": "https://actualbudget.org/assets/images/tour-budget-overview-9c1657e48bfa2e74cfa68a61d2fb898e.webp",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "c099b40b637091029fdd91a5c2b08130d6ac8bb4e88ae7b66d4b9bdb15fc4016",
    "observations": [
      "Monthly controls and category rows align planned, spent and remaining amounts in comparable columns.",
      "Use linked ledger drill-down and quiet table hierarchy instead of unrelated KPI cards."
    ]
  },
  {
    "id": "commerce-reference-1",
    "family": "commerce",
    "sourcePage": "https://www.shopify.com/orders",
    "imageUrl": "https://cdn.shopify.com/b/shopify-brochure2-assets/901f40395c218dc7f339284d9e9a3e5b.png",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "0f5875d4f3f6ba2cee426ac9634abaf405afc90a723ad261f412704a961dfed4",
    "observations": [
      "A return request identifies selected order items, quantities/reason and a clear approval state.",
      "This is an interaction illustration, not a full application layout reference; do not copy its floating collage."
    ]
  },
  {
    "id": "scheduling-reference-1",
    "family": "scheduling",
    "sourcePage": "https://calendly.com/scheduling",
    "imageUrl": "https://cdn.calendlycms.com/scheduling-customize-your-availability.png",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "70ecc06eeab4d075a838b9c353f6a8e30865a823b2cd585b99ce0b84b05b5e1c",
    "observations": [
      "Availability uses named weekdays, explicit time ranges and local edit/remove controls.",
      "This is an availability component reference, not a recommendation to reproduce a gradient marketing card."
    ]
  },
  {
    "id": "nutrition-reference-1",
    "family": "nutrition",
    "sourcePage": "https://cronometer.com/features/",
    "imageUrl": "https://cdn1.cronometer.com/wf-2026-08-25/images/Updated_New_Diary_analyze.svg",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "6aa105f7f802a0ebe5ccdab765f2ef9eab0559b499866114c145db371c9644bf",
    "observations": [
      "Date navigation sits above a diary grouped by meals with portion and calorie information on each row.",
      "Daily summaries relate to diary records; preserve units and missing-data states instead of relying on decorative rings."
    ]
  },
  {
    "id": "fitness-reference-1",
    "family": "fitness",
    "sourcePage": "https://www.hevyapp.com/features/track-workouts/",
    "imageUrl": "https://www.hevyapp.com/wp-content/uploads/hevy-exercise-options-1-1024x683.png",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "e1baaaec1a6da910181cef7be1f3c87a0adafd639c7b1cdf128b1a3f5ea1c3f9",
    "observations": [
      "Session/routine views align sets, previous values, load and repetitions; the numeric editor is touch-oriented.",
      "Use contextual rest-time editing and a clear finish/save control rather than a generic CRUD modal."
    ]
  },
  {
    "id": "education-reference-1",
    "family": "education",
    "sourcePage": "https://www.odoo.com/documentation/19.0/applications/websites/elearning.html",
    "imageUrl": "https://www.odoo.com/documentation/19.0/_images/elearning-course-creation.png",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "e093878f390890347ee90f583c381e5760ba2231abb8076772717a8e18cd8170",
    "observations": [
      "The course authoring view places an ordered content table under Content, Description and Options tabs.",
      "This partial screenshot informs authoring only; a learner needs a separate readable lesson and progress surface."
    ]
  },
  {
    "id": "support-reference-1",
    "family": "support",
    "sourcePage": "https://www.zendesk.com.br/service/ticketing-system/",
    "imageUrl": "https://web-assets.zendesk.com/cdn-cgi/image/q=65,f=auto,width=1600,fit=scale-down/zendesk/pages/service/ticketing/Accordian_agent_ticketing_prioritize_work_02__pt_br.png",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "aa769a8dc06be2aa2feef1b876a81d57274007b12290b40d7f7a78c888327cef",
    "observations": [
      "The interaction history has a visible timeline with customer context and channel distinctions.",
      "This is a promotional component illustration; use its contextual history pattern without copying the collage or claiming channels are connected."
    ]
  },
  {
    "id": "knowledge-reference-1",
    "family": "knowledge",
    "sourcePage": "https://www.notion.com/help/wikis-and-verified-pages",
    "imageUrl": "https://www.notion.com/_next/image?url=https%3A%2F%2Fimages.ctfassets.net%2Fspoqsaf9291f%2F1EenAHebFOpMqvbvQYqVyu%2Ff09a1677006d6b3a083f7655001e8aff%2Fverified_pages.png&w=3840&q=75",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "75482aacb7df0ac23946559fbb294bd267a001dc2ad72cd0ab13f6e3714442fe",
    "observations": [
      "The wiki index has breadcrumbs, a strong document title and compact rows with verification and modification metadata.",
      "Keep document hierarchy and reading width; do not copy product branding or turn each paragraph into a card."
    ]
  },
  {
    "id": "inventory-reference-1",
    "family": "inventory",
    "sourcePage": "https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html",
    "imageUrl": "https://www.odoo.com/documentation/19.0/_images/history-inventory-adjustments.png",
    "reviewedAt": "2026-09-09",
    "reviewMode": "agent-reviewed-image-description",
    "deliveryToModel": "text-description-not-image",
    "localEvidenceSha256": "9cb677079302846082436d12dd4095d58abd4cbee5248779dc7092140fa35026",
    "observations": [
      "The movement history is a filtered ledger with date, product, origin, destination and quantity columns.",
      "This narrow screenshot informs audit rows only; the inventory work surface also needs item search and meaningful stock actions."
    ]
  }
];
export function selectProductVisualReferences(family?:string): readonly ProductVisualReference[] { return family ? PRODUCT_VISUAL_REFERENCES.filter(ref => ref.family === family).slice(0,2) : []; }
