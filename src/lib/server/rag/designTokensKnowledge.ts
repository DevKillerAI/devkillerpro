import type { KnowledgeDocument } from './types';

type Seed = Omit<KnowledgeDocument, 'contentHash' | 'ingestedAt' | 'embedding' | 'embeddingModel'>;
const reviewedAt = '2026-09-04T00:00:00.000Z';
const expiresAt = '2026-12-31T00:00:00.000Z';

export const DESIGN_TOKENS_KNOWLEDGE: Seed[] = [
  {
    id: 'design-tokens-theme-v1',
    tenantId: 'public',
    title: 'CSS Custom Properties, Design Tokens and Color Harmony Baseline',
    sourceUri: 'internal://devkiller/design-system/tokens-v1',
    sourceType: 'official',
    trust: 'certified',
    status: 'active',
    domains: ['design', 'builder', 'product', 'qa'],
    tags: ['design-tokens', 'css-variables', 'colors', 'dark-mode', 'glassmorphism', 'craft'],
    version: '1.0.0',
    reviewedAt,
    expiresAt,
    content: `Apply this CSS variable token system inside :root in src/styles.css for modern, polished interfaces:

:root {
  /* Surface & Canvas System */
  --bg-canvas: #0b0f17;
  --bg-surface: #111827;
  --bg-surface-elevated: #1e293b;
  --bg-surface-subtle: rgba(255, 255, 255, 0.03);
  --glass-bg: rgba(17, 24, 39, 0.75);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-blur: blur(12px);

  /* Borders & Dividers */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-muted: rgba(255, 255, 255, 0.14);
  --border-focus: #3b82f6;

  /* Typography Colors */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-inverted: #0f172a;

  /* Brand & Accent Hierarchy */
  --accent-primary: #3b82f6;
  --accent-hover: #2563eb;
  --accent-light: rgba(59, 130, 246, 0.12);
  --accent-gradient: linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%);
  --success: #10b981;
  --success-bg: rgba(16, 185, 129, 0.12);
  --warning: #f59e0b;
  --warning-bg: rgba(245, 158, 11, 0.12);
  --danger: #ef4444;
  --danger-bg: rgba(239, 68, 68, 0.12);

  /* Elevation & Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-card: 0 4px 20px -2px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--border-subtle);
  --shadow-glow: 0 0 24px -4px rgba(59, 130, 246, 0.25);

  /* Geometry & Spacing */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-full: 9999px;
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

Use these variables consistently for all elements. Avoid hardcoded hex colors in child classes when tokens exist.`
  },
  {
    id: 'design-component-patterns-v1',
    tenantId: 'public',
    title: 'Reusable UI Component Craft and Modern CSS Structures',
    sourceUri: 'internal://devkiller/design-system/components-v1',
    sourceType: 'official',
    trust: 'certified',
    status: 'active',
    domains: ['design', 'builder', 'product', 'qa'],
    tags: ['components', 'buttons', 'cards', 'forms', 'modals', 'tables'],
    version: '1.0.0',
    reviewedAt,
    expiresAt,
    content: `Adopt these component CSS patterns in src/styles.css:

/* 1. Action Buttons */
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 18px; border-radius: var(--radius-md); font-weight: 600; font-size: 14px;
  background: var(--accent-gradient); color: #ffffff; border: none; cursor: pointer;
  box-shadow: var(--shadow-sm); transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
}
.btn-primary:hover { filter: brightness(1.08); box-shadow: var(--shadow-glow); }
.btn-primary:active { transform: scale(0.98); }

.btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 18px; border-radius: var(--radius-md); font-weight: 500; font-size: 14px;
  background: var(--bg-surface-elevated); color: var(--text-primary);
  border: 1px solid var(--border-subtle); cursor: pointer; transition: all 160ms ease;
}
.btn-secondary:hover { background: var(--border-muted); border-color: var(--border-muted); }

/* 2. Glassmorphism Surface & Stat Cards */
.card-glass {
  background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 20px;
  box-shadow: var(--shadow-card); transition: border-color 180ms ease, transform 180ms ease;
}
.card-glass:hover { border-color: rgba(255, 255, 255, 0.18); }

.stat-value { font-size: 28px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: var(--radius-full); font-size: 12px; font-weight: 600; }
.badge-success { background: var(--success-bg); color: var(--success); }
.badge-warning { background: var(--warning-bg); color: var(--warning); }
.badge-danger { background: var(--danger-bg); color: var(--danger); }

/* 3. Inputs & Form Controls */
.input-field {
  width: 100%; padding: 10px 14px; background: var(--bg-canvas); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
.input-field:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-light); }
.input-field::placeholder { color: var(--text-muted); }

/* 4. Data Tables with Scrollable Containers */
.table-container { width: 100%; overflow-x: auto; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); }
.table-modern { width: 100%; border-collapse: collapse; font-size: 14px; text-align: left; }
.table-modern th { background: var(--bg-surface-elevated); color: var(--text-secondary); padding: 12px 16px; font-weight: 600; border-bottom: 1px solid var(--border-subtle); }
.table-modern td { padding: 14px 16px; border-bottom: 1px solid var(--border-subtle); color: var(--text-primary); }
.table-modern tr:hover td { background: var(--bg-surface-subtle); }

/* 5. Modals & Dialog Surfaces */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); backdrop-filter: var(--glass-blur); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; animation: fadeIn 180ms ease; }
.modal-box { background: var(--bg-surface); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 24px; max-width: 540px; width: 100%; box-shadow: var(--shadow-card); animation: slideUp 200ms ease; }

/* 6. Navigation Tabs & Segmented Controls */
.tabs-nav { display: inline-flex; gap: 4px; padding: 4px; background: var(--bg-canvas); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); }
.tab-btn { padding: 8px 16px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 500; color: var(--text-secondary); background: transparent; border: none; cursor: pointer; transition: all 150ms ease; }
.tab-btn.active { background: var(--bg-surface-elevated); color: var(--text-primary); font-weight: 600; box-shadow: var(--shadow-sm); }

/* 7. Empty States & Skeletons */
.empty-state { padding: 48px 24px; text-align: center; border: 1px dashed var(--border-muted); border-radius: var(--radius-lg); color: var(--text-muted); }
.empty-icon { margin: 0 auto 12px; color: var(--text-secondary); opacity: 0.7; }
.skeleton { background: linear-gradient(90deg, var(--bg-surface-elevated) 25%, var(--bg-surface-subtle) 50%, var(--bg-surface-elevated) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: var(--radius-sm); }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`
  },
  {
    id: 'design-microinteractions-motion-v1',
    tenantId: 'public',
    title: 'Micro-Interactions, Restrained Motion and Responsive Hierarchy',
    sourceUri: 'internal://devkiller/design-system/motion-v1',
    sourceType: 'official',
    trust: 'certified',
    status: 'active',
    domains: ['design', 'builder', 'product', 'qa'],
    tags: ['motion', 'micro-interactions', 'responsive', 'animation', 'a11y'],
    version: '1.0.0',
    reviewedAt,
    expiresAt,
    content: `Guidelines for responsive craft and motion in DevKiller React apps:

1. Timing and Easing: Use snappy 140ms–220ms transitions with cubic-bezier(0.16, 1, 0.3, 1) or ease-out. Never use slow animations that delay user actions.
2. Interactive Feedback: Provide clear hover, active, focus-visible and loading feedback for all clickable elements. Focus rings must be high-contrast and not clipped by overflow.
3. Responsive Grid & Stacking: Split layouts (sidebar + content, 2-column forms) must gracefully stack or collapse into tabs/drawers below 768px. Never introduce accidental horizontal viewport scroll.
4. Tabular Numbers: Format currency, percentages, counts, timestamps and metrics using font-variant-numeric: tabular-nums to prevent visual jitter during live updates.
5. Empty & Loading States: Provide purposeful empty states with clear iconography and a direct call-to-action button rather than blank grey containers.
6. Reduced Motion: Always support @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`
  },
  {
    id: 'design-domain-recipes-v1',
    tenantId: 'public',
    title: 'Domain-Tailored Visual Recipes and Art Direction Rules',
    sourceUri: 'internal://devkiller/design-system/domain-recipes-v1',
    sourceType: 'official',
    trust: 'certified',
    status: 'active',
    domains: ['design', 'builder', 'product', 'qa'],
    tags: ['domain-recipes', 'fintech', 'ecommerce', 'dashboard', 'creative-studio'],
    version: '1.0.0',
    reviewedAt,
    expiresAt,
    content: `Domain-specific palette & visual signature recommendations:

- FINTECH / WALLET / TRADING: Dark slate foundation (#090d16), emerald accent (#10b981) for gains, cyan/indigo for charts, tabular numbers, balance cards with gradient overlays, quick transfer rails.
- E-COMMERCE / HOSPITALITY / FOOD: Rich warm tones (amber #f59e0b, deep coffee/terracotta #1c1410), crisp food cards with aspect-ratio: 4/3, sticky bottom-bar cart summary, filter chips with active indicators.
- CREATIVE STUDIO / TOOL / CANVAS: Minimal chrome, deep dark backdrop (#0d0e12), high contrast white canvas, tool rail with tooltip hints, compact property inspectors, undo/redo buttons.
- CORPORATE / SERVICES / SAAS: Clean slate-blue palette (#0f172a, #3b82f6), clear trust indicators, prominent feature comparison or pricing toggles, testimonial carousels with avatar initials/images.`
  },
  {
    id: 'design-archetype-dark-tech-linear',
    tenantId: 'public',
    title: 'Linear / Obsidian Dark Tech Design Archetype: Pitch-Black, Micro-Borders and Sidebar Docks',
    sourceUri: 'internal://devkiller/design-system/archetypes/dark-tech',
    sourceType: 'official',
    trust: 'certified',
    status: 'active',
    domains: ['design', 'builder', 'product', 'qa'],
    tags: ['linear', 'dark-tech', 'obsidian', 'sidebar', 'developer-tool', 'productivity'],
    version: '1.0.0',
    reviewedAt,
    expiresAt,
    content: `ARCHETYPE: Linear / Obsidian Dark Tech (for Productivity, DevTools, Task Systems, Issue Trackers)
Layout Structure: Collapsible or icon sidebar navigation on desktop (sidebar + main surface), responsive bottom navigation on mobile.

CSS Tokens & Styles:
:root {
  --bg-canvas: #08090a;
  --bg-surface: #0f1012;
  --bg-surface-elevated: #16181b;
  --bg-surface-hover: #1c1f24;
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-muted: rgba(255, 255, 255, 0.12);
  --border-focus: #5e6ad2;
  --text-primary: #f7f8f8;
  --text-secondary: #8a8f98;
  --text-muted: #575b63;
  --accent-primary: #5e6ad2;
  --accent-hover: #717cf0;
  --accent-glow: 0 0 20px rgba(94, 106, 210, 0.35);
  --status-active: #48bb78;
  --status-warning: #ecc94b;
  --status-critical: #f56565;
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
}

/* Master-detail & Sidebar Layout */
.app-shell { display: flex; min-height: 100vh; background: var(--bg-canvas); color: var(--text-primary); }
.app-sidebar { width: 240px; background: var(--bg-surface); border-right: 1px solid var(--border-subtle); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.app-main { flex: 1; min-width: 0; padding: 24px 32px; overflow-y: auto; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 500; color: var(--text-secondary); cursor: pointer; transition: all 120ms; }
.nav-item:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
.nav-item.active { background: var(--bg-surface-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle); }
.kbd-shortcut { margin-left: auto; font-size: 11px; padding: 2px 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle); border-radius: var(--radius-xs); color: var(--text-muted); }`
  },
  {
    id: 'design-archetype-industrial-data',
    tenantId: 'public',
    title: 'Enterprise Industrial & Operations Archetype: Dense Data Grids, Monospace Telemetry and Status Badges',
    sourceUri: 'internal://devkiller/design-system/archetypes/industrial-data',
    sourceType: 'official',
    trust: 'certified',
    status: 'active',
    domains: ['design', 'builder', 'product', 'qa'],
    tags: ['industrial', 'erp', 'operations', 'logistics', 'dense-grid', 'telemetry'],
    version: '1.0.0',
    reviewedAt,
    expiresAt,
    content: `ARCHETYPE: Enterprise Industrial & Operations (for ERP, Logistics, Manufacturing, Supply Chain, Auditing)
Layout Structure: Dense header with operational breadcrumbs + multi-column filter bar + wide data grid with pinned actions.

CSS Tokens & Styles:
:root {
  --bg-canvas: #12151a;
  --bg-surface: #181d24;
  --bg-surface-elevated: #202732;
  --border-subtle: #293241;
  --border-muted: #3d4a60;
  --border-focus: #f59e0b;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --accent-primary: #f59e0b; /* Safety / Industrial Amber */
  --accent-hover: #d97706;
  --telemetry-cyan: #06b6d4;
  --telemetry-emerald: #10b981;
  --telemetry-ruby: #f43f5e;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* Dense Data Grid & Industrial Cards */
.telemetry-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
.telemetry-card { background: var(--bg-surface); border: 1px solid var(--border-subtle); padding: 14px 16px; border-left: 3px solid var(--accent-primary); }
.telemetry-value { font-family: var(--font-mono); font-size: 20px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; font-size: 11px; font-family: var(--font-mono); font-weight: 600; text-transform: uppercase; border-radius: 2px; }
.status-pill.ok { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
.status-pill.warning { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
.status-pill.critical { background: rgba(244, 63, 94, 0.15); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.3); }`
  },
  {
    id: 'design-archetype-editorial-clean',
    tenantId: 'public',
    title: 'Modern Editorial & Light Professional Archetype: Off-White Foundation, Deep Charcoal and Refined Hierarchy',
    sourceUri: 'internal://devkiller/design-system/archetypes/editorial-clean',
    sourceType: 'official',
    trust: 'certified',
    status: 'active',
    domains: ['design', 'builder', 'product', 'qa'],
    tags: ['editorial', 'light-mode', 'professional', 'publishing', 'portfolio', 'firm'],
    version: '1.0.0',
    reviewedAt,
    expiresAt,
    content: `ARCHETYPE: Modern Editorial & Light Professional (for Consultancies, Real Estate, Law, Publishing, Architecture)
Layout Structure: Asymmetric magazine grid, hairline rules, generous breathing room, split view with sticky overview.

CSS Tokens & Styles:
:root {
  --bg-canvas: #f9f8f5;
  --bg-surface: #ffffff;
  --bg-surface-elevated: #f3f1ec;
  --border-subtle: #e5e2da;
  --border-muted: #c8c4b7;
  --border-focus: #1a1a1a;
  --text-primary: #171717;
  --text-secondary: #525252;
  --text-muted: #737373;
  --accent-primary: #171717; /* High-contrast editorial ink */
  --accent-hover: #404040;
  --accent-warm: #c2410c; /* Terracotta highlight */
  --shadow-editorial: 0 2px 8px rgba(0,0,0,0.04), 0 0 0 1px var(--border-subtle);
}

.editorial-header { border-bottom: 2px solid var(--text-primary); padding: 24px 0 16px; margin-bottom: 32px; }
.editorial-title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary); }
.editorial-card { background: var(--bg-surface); border: 1px solid var(--border-subtle); padding: 24px; box-shadow: var(--shadow-editorial); }
.hairline-rule { height: 1px; background: var(--border-subtle); margin: 24px 0; }`
  },
  {
    id: 'design-archetype-creative-studio',
    tenantId: 'public',
    title: 'Glassmorphism Studio Archetype: Canvas Workspace, Translucent Floating Rails and Dynamic Lighting',
    sourceUri: 'internal://devkiller/design-system/archetypes/creative-studio',
    sourceType: 'official',
    trust: 'certified',
    status: 'active',
    domains: ['design', 'builder', 'product', 'qa'],
    tags: ['studio', 'canvas', 'creative', 'glassmorphism', 'editor', 'graphic'],
    version: '1.0.0',
    reviewedAt,
    expiresAt,
    content: `ARCHETYPE: Glassmorphism Studio & Workspace (for Graphic Editors, Meme Generators, Poster Studios, Audio/Video Tools)
Layout Structure: Full-viewport canvas centerpiece + floating translucent tool dock + slide-over property drawer.

CSS Tokens & Styles:
:root {
  --bg-canvas: #0c0d14;
  --bg-surface: rgba(22, 24, 38, 0.72);
  --bg-surface-glass: rgba(28, 31, 50, 0.65);
  --glass-border: rgba(255, 255, 255, 0.12);
  --glass-blur: blur(16px);
  --text-primary: #ffffff;
  --text-secondary: #a5b4fc;
  --text-muted: #6366f1;
  --accent-primary: #8b5cf6;
  --accent-gradient: linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%);
  --shadow-glass: 0 8px 32px 0 rgba(0, 0, 0, 0.37), inset 0 0 0 1px var(--glass-border);
}

.studio-viewport { display: flex; height: 100vh; background: radial-gradient(circle at 50% 20%, #1e1b4b 0%, var(--bg-canvas) 80%); overflow: hidden; }
.floating-dock { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; padding: 8px 12px; background: var(--bg-surface-glass); backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-border); border-radius: 9999px; box-shadow: var(--shadow-glass); z-index: 20; }
.canvas-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px; }`
  },
  {
    id: 'design-archetype-warm-humanist',
    tenantId: 'public',
    title: 'Warm Humanist Archetype: Tactile Sand Surfaces, Sage Green and Friendly Rounded Containers',
    sourceUri: 'internal://devkiller/design-system/archetypes/warm-humanist',
    sourceType: 'official',
    trust: 'certified',
    status: 'active',
    domains: ['design', 'builder', 'product', 'qa'],
    tags: ['humanist', 'lifestyle', 'wellness', 'health', 'warm', 'friendly'],
    version: '1.0.0',
    reviewedAt,
    expiresAt,
    content: `ARCHETYPE: Warm Humanist & Lifestyle (for Habit Trackers, Health, Mindfulness, Personal Notes, Recipes)
Layout Structure: Welcoming progress cards + card feed with tactile rounded corners + warm pill buttons.

CSS Tokens & Styles:
:root {
  --bg-canvas: #faf7f2;
  --bg-surface: #ffffff;
  --bg-surface-warm: #f4eee3;
  --border-subtle: #e8ded1;
  --border-muted: #d4c5b3;
  --border-focus: #2d6a4f;
  --text-primary: #2d312e;
  --text-secondary: #58605a;
  --text-muted: #828d85;
  --accent-primary: #2d6a4f; /* Deep Forest / Sage */
  --accent-hover: #1b4332;
  --accent-warm: #d97736; /* Warm Terracotta */
  --radius-card: 16px;
  --radius-btn: 9999px; /* Tactile pill buttons */
  --shadow-soft: 0 4px 20px rgba(78, 67, 54, 0.06);
}

.humanist-card { background: var(--bg-surface); border-radius: var(--radius-card); border: 1px solid var(--border-subtle); padding: 20px; box-shadow: var(--shadow-soft); transition: transform 150ms ease; }
.pill-btn { border-radius: var(--radius-btn); padding: 10px 20px; font-weight: 600; background: var(--accent-primary); color: #fff; border: none; cursor: pointer; }`
  }
];

