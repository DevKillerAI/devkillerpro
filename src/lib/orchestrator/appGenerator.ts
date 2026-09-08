/**
 * @deprecated LEGACY V1 COUNCIL MEETING SIMULATION ONLY
 * This file powers the animated council deliberation in the War Room UI.
 * It is NOT the real code generator.
 * The production DevKiller V2 Engine is located at:
 * src/lib/server/generator/workbenchSupervisor.ts
 * which uses Docker, Playwright, PostgreSQL/Supabase, AST verification, and RAG Core 1.1.
 */

import { AgentCard } from "../types/domain";
import { FOUNDING_AGENTS } from "../agents/catalog";

export interface InteractiveProjectCard {
  id: string;
  title: string;
  category: string;
  timeLeft: string;
  progress: number;
  team: string[];
  color: string;
  iconBg: string;
  status: "Started" | "Approval" | "Completed";
}

export interface InteractiveTask {
  id: string;
  title: string;
  subtitle: string;
  done: boolean;
  tag: string;
  color: string;
}

export interface GeneratedAppPackage {
  appTitle: string;
  tagline: string;
  category: string;
  summary: string;
  squadRationale: string;
  suggestedAgentIds: string[];
  meetingSteps: {
    phase: string;
    agentId: string;
    agentName: string;
    agentRole: string;
    speech: string;
    keyPoint: string;
    avatarColor: string;
    avatarUrl?: string;
  }[];
  appType: "dashboard" | "delivery" | "fintech" | "booking" | "ecommerce" | "calculator" | "task" | "custom";
  interactiveApp: {
    themeColor: string;
    headline: string;
    description?: string;
    userProfile?: { name: string; role: string; avatar: string };
    stats?: { label: string; value: string; change?: string; color: string }[];
    projectCards?: any[];
    tasks?: InteractiveTask[];
    categories?: string[];
  };
  sourceFiles: {
    name: string;
    path: string;
    language: string;
    description: string;
    content: string;
  }[];
  architectureDoc: {
    title: string;
    adrCode: string;
    date: string;
    status: string;
    decisions: string[];
    dataModel: string[];
    securityChecklist: string[];
  };
  deployGuide: {
    prerequisites: string[];
    commands: string[];
    envVariables: string[];
  };
  /** Generation provenance — tracks which engine produced this package */
  generation?: {
    provider: string;
    modelUsed: string;
    isLiveLLM: boolean;
    meetingTokensUsed?: number;
    codegenTokensUsed?: number;
  };
}

export function analyzeAndGenerateApp(userPrompt: string): GeneratedAppPackage {
  const text = userPrompt.toLowerCase();

  const isCalculator = text.includes("calculadora") || text.includes("calc") || text.includes("conversor") || text.includes("matemática") || text.includes("juros");
  const isTaskApp = text.includes("todo") || text.includes("task") || text.includes("tarefa") || text.includes("kanban") || text.includes("backlog");
  const isDelivery = text.includes("entrega") || text.includes("delivery") || text.includes("restaurante") || text.includes("comida") || text.includes("pet");
  const isEcommerce = text.includes("loja") || text.includes("e-commerce") || text.includes("ecommerce") || text.includes("venda") || text.includes("produto");
  const isFintech = text.includes("pagamento") || text.includes("pix") || text.includes("fintech") || text.includes("financeiro") || text.includes("split") || text.includes("banco");
  const isBooking = text.includes("saude") || text.includes("saúde") || text.includes("agendamento") || text.includes("clinica") || text.includes("clínica") || text.includes("barbearia") || text.includes("consulta");
  const isAIApp = text.includes("ia") || text.includes("ai") || text.includes("inteligencia") || text.includes("chatbot") || text.includes("llm");
  const isQrCode = text.includes("qr") || text.includes("qrcode") || text.includes("código") || text.includes("codigo");

  let appType: GeneratedAppPackage["appType"] = "dashboard";
  let appTitle = "Boardto Studio";
  let tagline = "Real-time project tracking, metrics, and software delivery dashboard";
  let category = "Management & Reporting Dashboard";
  let themeColor = "brand-500";

  if (isQrCode) {
    appType = "custom";
    appTitle = "QRCustom Studio Pro";
    tagline = "Dynamic vector QR Code studio with custom color palettes and high-resolution export";
    category = "Design & Utility Tools";
    themeColor = "emerald";
  } else if (isCalculator) {
    appType = "calculator";
    appTitle = "OmniCalc Pro";
    tagline = "Executive calculator with tape history, scenario modeling, and high precision";
    category = "Scientific & Financial Utilities";
    themeColor = "indigo";
  } else if (isTaskApp) {
    appType = "task";
    appTitle = "DevFlow Tasks";
    tagline = "Agile task board with priorities, real-time checklists, and sprint telemetry";
    category = "Task & Workflow Management";
    themeColor = "rose";
  } else if (isDelivery) {
    appType = "delivery";
    appTitle = text.includes("pet") ? "PetExpress Pro" : "SpeedDelivery Hub";
    tagline = "On-demand ordering platform with dynamic catalog, checkout, and tracking";
    category = "On-Demand Delivery & Logistics";
    themeColor = "orange";
  } else if (isFintech) {
    appType = "fintech";
    appTitle = "PayFlow Splitter";
    tagline = "Instant settlement gateway with automated multi-account splits and webhooks";
    category = "Fintech & Smart Payments";
    themeColor = "emerald";
  } else if (isBooking) {
    appType = "booking";
    appTitle = text.includes("barbearia") ? "BarberElite Cloud" : "OmniAgenda Health";
    tagline = "Automated scheduling system with smart notifications and customer CRM";
    category = "Smart Booking & Appointments";
    themeColor = "purple";
  } else if (isEcommerce) {
    appType = "ecommerce";
    appTitle = "NovaStore Commerce";
    tagline = "Headless e-commerce platform with fast checkout and inventory control";
    category = "Headless E-Commerce";
    themeColor = "cyan";
  } else {
    appType = "custom";
    appTitle = userPrompt.length > 3 ? userPrompt.slice(0, 30).trim() : "Custom Application";
    tagline = `Tailored software designed by the council for: ${userPrompt.slice(0, 60)}`;
    category = "Custom Business Software";
    themeColor = "indigo";
  }

  // Recommended Agents
  const suggestedAgentIds = ["cto", "architect", "security", "designer", "fullstack"];
  if (isFintech || isDelivery) suggestedAgentIds.push("qa");
  if (isAIApp) suggestedAgentIds.push("ai_systems");
  if (text.includes("escala") || text.includes("docker") || text.includes("deploy")) suggestedAgentIds.push("devops");

  // Plain-language Squad Rationale
  const squadRationale = `Convened Principal Architect, Security Engineer, Lead Designer, and Full-Stack Engineer to build '${userPrompt}'.`;

  // Meeting Speeches with Human Clarity
  const meetingSteps = [
    {
      phase: "1. Diagnosis & Project Scope",
      agentId: "cto",
      agentName: "Vince",
      agentRole: "COUNCIL CHAIR",
      speech: `Analyzing requirements: "${userPrompt}". Leading the council to guarantee rock-solid architecture, clean contracts, and executive delivery.`,
      keyPoint: "Scope alignment, reversibility, and explicit contracts",
      avatarColor: "bg-[#111420]",
      avatarUrl: "/emblems/council-chair.png",
    },
    {
      phase: "2. Architecture & Data Schema",
      agentId: "architect",
      agentName: "Atlas",
      agentRole: "SOLUTION ARCHITECT",
      speech: `Structured the data model in Next.js 15 + TypeScript with normalized schemas, referential integrity, and high-performance indices.`,
      keyPoint: "Next.js 15 + Strict TypeScript contracts",
      avatarColor: "bg-[#2A1B24]",
      avatarUrl: "/emblems/solution-architect.png",
    },
    {
      phase: "3. Security & Trust Boundaries",
      agentId: "security",
      agentName: "Sentinel",
      agentRole: "SECURITY ENGINEER",
      speech: `Enforced zero-trust boundaries: strict server-side validation, OWASP safeguards, and rate-limiting on sensitive endpoints.`,
      keyPoint: "Zod Validation + HttpOnly Cookies + OWASP Standards",
      avatarColor: "bg-[#D93B60]",
      avatarUrl: "/emblems/security-engineer.png",
    },
    {
      phase: "4. Design & Ergonomics",
      agentId: "designer",
      agentName: "Iris",
      agentRole: "EXPERIENCE DESIGNER",
      speech: `Crafted a clean, modern interface with expressive typography, instant feedback, and fluid responsive layouts.`,
      keyPoint: "Clean ergonomics, subtle micro-interactions, responsive grid",
      avatarColor: "bg-[#FF6B6B]",
      avatarUrl: "/emblems/experience-designer.png",
    },
    {
      phase: "5. Code & Production Implementation",
      agentId: "fullstack",
      agentName: "Forge",
      agentRole: "FULL-STACK ENGINEER",
      speech: `Synthesized typed source code and connected interactive runtime. Prototype ready for live validation.`,
      keyPoint: "Typed components, interactive sandbox, export ready",
      avatarColor: "bg-[#FF4B72]",
      avatarUrl: "/emblems/full-stack-engineer.png",
    },
  ];

  // Interactive Live App Data
  const interactiveApp = {
    themeColor,
    headline: isDelivery ? "Gestão de Pedidos & Cardápio" : "Visão Geral de Operações",
    userProfile: {
      name: "Augusta Ryan",
      role: isDelivery ? "Gerente de Operações Gastronômicas" : "Diretora de Operações",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80",
    },
    categories: isDelivery 
      ? ["Cardápio Completo", "Burgers & Sanduíches", "Pizzas Artesanais", "Bebidas", "Sobremesas"]
      : ["Todos (50)", "Em Andamento (20)", "Em Aprovação (15)", "Concluídos (34)"],
    stats: isDelivery 
      ? [
          { label: "Pedidos em Tempo Real", value: "48", change: "+18% hoje", color: "#FF4B72" },
          { label: "Tempo Médio Entrega", value: "24 min", change: "Otimizado", color: "#00C9A7" },
          { label: "Taxa de Conversão", value: "94.8%", change: "+3.2%", color: "#00B2FF" },
          { label: "Faturamento Diário", value: "R$ 6.420", change: "Meta atingida", color: "#7C5CFC" },
        ]
      : [
          { label: "Projetos Ativos", value: "24", change: "+12% este mês", color: "#00B2FF" },
          { label: "Tarefas Finalizadas", value: "184", change: "98% no prazo", color: "#00C9A7" },
          { label: "Horas Dedicadas", value: "328 h", change: "Média 38h/membro", color: "#FF9F43" },
          { label: "SLA de Entrega", value: "99.4%", change: "Excelente", color: "#7C5CFC" },
        ],
    projectCards: [
      {
        id: "proj-1",
        title: appTitle,
        category: isDelivery ? "Delivery & Quick Commerce" : "Engenharia de Software",
        timeLeft: "Pronto para Deploy",
        progress: 100,
        team: [
          "/emblems/council-chair.png",
          "/emblems/full-stack-engineer.png",
          "/emblems/solution-architect.png",
          "/emblems/security-engineer.png",
        ],
        color: "#FF4B72",
        iconBg: "bg-rose-100 text-rose-600",
        status: "Completed" as const,
      },
    ],
    tasks: isDelivery
      ? [
          {
            id: "task-1",
            title: "Disponibilizar Cardápio & Fotos em Alta Resolução",
            subtitle: "Design & UX Gastronômico",
            done: true,
            tag: "Concluído",
            color: "#00C9A7",
          },
          {
            id: "task-2",
            title: "Simulador de Carrinho Reativo & Cálculo de Taxa",
            subtitle: "Engenharia Full Stack",
            done: true,
            tag: "Pronto",
            color: "#00B2FF",
          },
          {
            id: "task-3",
            title: "Integração do Gateway PIX Dinâmico com QR Code",
            subtitle: "Segurança & Pagamentos",
            done: true,
            tag: "Ativo",
            color: "#FF4B72",
          },
        ]
      : [
          {
            id: "task-1",
            title: "Validar contratos de API com Zod",
            subtitle: "Engenharia de Backend",
            done: true,
            tag: "Urgente",
            color: "#FF5A82",
          },
          {
            id: "task-2",
            title: "Revisar fluxo de checkout no mobile",
            subtitle: "Design & UX",
            done: false,
            tag: "Em Revisão",
            color: "#00B2FF",
          },
          {
            id: "task-3",
            title: "Auditoria de segurança nas variáveis de ambiente",
            subtitle: "Segurança & Infra",
            done: false,
            tag: "Segurança",
            color: "#7C5CFC",
          },
        ],
  };

  // Complete Production Source Code
  const sourceFiles = isDelivery
    ? [
        {
          name: "page.tsx",
          path: "src/app/page.tsx",
          language: "typescript",
          description: "Vitrine completa de delivery com catálogo, carrinho reativo, cálculo de frete e checkout PIX.",
          content: `"use client";

import React, { useState } from "react";
import { 
  ShoppingBag, 
  Plus, 
  Minus, 
  QrCode, 
  MapPin, 
  Clock, 
  Search, 
  CheckCircle2, 
  Bike 
} from "lucide-react";

export default function DeliveryApp() {
  const [activeCategory, setActiveCategory] = useState("all");
  const [cart, setCart] = useState<{ id: string; name: string; price: number; quantity: number }[]>([]);
  const [isPixOpen, setIsPixOpen] = useState(false);

  const menu = [
    { id: "1", name: "Smash Burger Especial", category: "burgers", price: 38.90, desc: "2x carnes 150g, queijo cheddar inglês derretido e bacon artesanal." },
    { id: "2", name: "Pizza Margherita DOC", category: "pizzas", price: 54.00, desc: "Fermentação natural 48h, molho San Marzano e mozzarella di bufala." },
    { id: "3", name: "Batatas Rústicas com Queijo", category: "sides", price: 22.90, desc: "Batatas cortadas à mão com alecrim e fondue de queijos." }
  ];

  const addToCart = (item: any) => {
    setCart((prev) => {
      const exists = prev.find((i) => i.id === item.id);
      if (exists) return prev.map((i) => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { id: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const subtotal = cart.reduce((acc, i) => acc + i.price * i.quantity, 0);

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-800 p-4 sm:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">${appTitle}</h1>
            <p className="text-xs text-slate-500">${tagline}</p>
          </div>
          <button className="px-4 py-2 bg-[#FF4B72] text-white rounded-2xl text-xs font-bold flex items-center gap-2">
            <ShoppingBag className="w-4 h-4" />
            <span>Carrinho ({cart.reduce((a, b) => a + b.quantity, 0)})</span>
          </button>
        </header>

        {/* Cardápio Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {menu.map((item) => (
            <div key={item.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
              <h3 className="text-base font-bold text-slate-900">{item.name}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-sm font-black text-slate-900">R$ {item.price.toFixed(2)}</span>
                <button
                  onClick={() => addToCart(item)}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-[#FF4B72]"
                >
                  + Adicionar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}`,
        },
        {
          name: "schema.ts",
          path: "src/lib/db/schema.ts",
          language: "typescript",
          description: "Esquema relacional em Drizzle ORM para restaurantes, produtos, pedidos e PIX.",
          content: `import { pgTable, text, timestamp, uuid, integer, numeric, boolean } from "drizzle-orm/pg-core";

export const restaurants = pgTable("restaurants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  phone: text("phone").notNull(),
  isOpen: boolean("is_open").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const menuItems = pgTable("menu_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").references(() => restaurants.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  category: text("category").notNull(),
  imageUrl: text("image_url"),
  isAvailable: boolean("is_available").default(true).notNull(),
});

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  pixCode: text("pix_code"),
  status: text("status").default("PENDING").notNull(), // PENDING, PAID, IN_PREP, IN_TRANSIT, DELIVERED
  createdAt: timestamp("created_at").defaultNow().notNull(),
});`,
        },
        {
          name: "route.ts",
          path: "src/app/api/orders/route.ts",
          language: "typescript",
          description: "Endpoint seguro com validação Zod para criação e checkout PIX de pedidos.",
          content: `import { NextResponse } from "next/server";
import { z } from "zod";

const OrderSchema = z.object({
  customerName: z.string().min(2),
  customerPhone: z.string().min(10),
  deliveryAddress: z.string().min(5),
  items: z.array(
    z.object({
      itemId: z.string(),
      quantity: z.number().int().positive(),
    })
  ).min(1, "O carrinho não pode estar vazio"),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD"]),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validatedData = OrderSchema.parse(body);

    const orderId = "order_" + Date.now();
    const pixCode = "00020126580014BR.GOV.BCB.PIX0136" + orderId;

    return NextResponse.json({
      success: true,
      orderId,
      status: "AWAITING_PAYMENT",
      pixCode,
      qrCodeUrl: \`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=\${encodeURIComponent(pixCode)}\`,
    }, { status: 201 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Dados do pedido inválidos", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}`,
        },
      ]
    : [
        {
          name: "page.tsx",
          path: "src/app/page.tsx",
          language: "typescript",
          description: "Página principal com layout responsivo limpo, estado reativo e componentes modernos.",
          content: `"use client";

import React, { useState } from "react";
import { 
  LayoutDashboard, 
  CheckCircle2, 
  Clock, 
  Users, 
  Search, 
  Bell, 
  Plus, 
  TrendingUp, 
  Sparkles,
  Layers,
  ArrowRight
} from "lucide-react";

export default function DashboardApp() {
  const [filter, setFilter] = useState("all");
  const [tasks, setTasks] = useState([
    { id: 1, title: "Validar contratos de API com Zod", done: true },
    { id: 2, title: "Revisar fluxo de checkout no mobile", done: false },
    { id: 3, title: "Auditoria de segurança nas variáveis de ambiente", done: false },
  ]);

  const toggleTask = (id: number) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  return (
    <main className="min-h-screen bg-[#F4F6FA] text-slate-800 p-4 sm:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">${appTitle}</h1>
            <p className="text-sm text-slate-500 mt-0.5">${tagline}</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="bg-sky-500 hover:bg-sky-600 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors shadow-sm flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              <span>Novo Registro</span>
            </button>
          </div>
        </header>
      </div>
    </main>
  );
}`,
        },
        {
          name: "schema.ts",
          path: "src/lib/db/schema.ts",
      language: "typescript",
      description: "Esquema relacional em Drizzle ORM com tipagem TypeScript estrita.",
      content: `import { pgTable, text, timestamp, uuid, integer, boolean, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").default("MEMBER").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  progress: integer("progress").default(0).notNull(),
  status: text("status").default("STARTED").notNull(),
  ownerId: uuid("owner_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id).notNull(),
  title: text("title").notNull(),
  isDone: boolean("is_done").default(false).notNull(),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});`,
    },
    {
      name: "route.ts",
      path: "src/app/api/projects/route.ts",
      language: "typescript",
      description: "Endpoint seguro com validação Zod e Server Actions.",
      content: `import { NextResponse } from "next/server";
import { z } from "zod";

const ProjectInputSchema = z.object({
  title: z.string().min(3, "Título deve ter no mínimo 3 caracteres").max(100),
  category: z.string().min(2),
  progress: z.number().min(0).max(100).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validatedData = ProjectInputSchema.parse(body);

    const newProject = {
      id: "proj_" + Date.now(),
      ...validatedData,
      progress: validatedData.progress ?? 0,
      status: "STARTED",
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, project: newProject }, { status: 201 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Dados inválidos", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}`,
    },
    {
      name: "package.json",
      path: "package.json",
      language: "json",
      description: "Dependências e scripts de inicialização.",
      content: `{
  "name": "${appTitle.toLowerCase().replace(/[^a-z0-9]/g, "-")}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "drizzle-orm": "^0.38.3",
    "lucide-react": "^0.468.0",
    "next": "^15.1.4",
    "pg": "^8.13.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/react": "^19.0.4",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.3"
  }
}`,
    },
    {
      name: "README.md",
      path: "README.md",
      language: "markdown",
      description: "Guia de execução local.",
      content: `# ${appTitle}
> ${tagline}

Projeto concebido e aprovado pelo **DevKiller Engineering Council**.

## 🚀 Como Rodar

\`\`\`bash
npm install
npm run dev
\`\`\`

Acesse em [http://localhost:3000](http://localhost:3000).`,
    },
  ];

  // Formal ADR Document
  const architectureDoc = {
    title: `ADR-001: Arquitetura & Diretrizes para ${appTitle}`,
    adrCode: "ADR-001",
    date: new Date().toLocaleDateString("pt-BR"),
    status: "Aprovado pelo Conselho",
    decisions: [
      "Modular Monolith com Next.js 15 App Router para máxima velocidade de iteração e baixo acoplamento.",
      "TypeScript estrito com contratos Zod compartilhados entre API e UI.",
      "Drizzle ORM com PostgreSQL para queries SQL previsíveis sem runtime binário intermediário.",
      "Design System moderno com Tailwind CSS e paleta limpa/acolhedora.",
    ],
    dataModel: [
      "users (id, email, name, role, createdAt)",
      "projects (id, title, category, progress, status, ownerId, createdAt)",
      "tasks (id, projectId, title, isDone, dueDate, createdAt)",
    ],
    securityChecklist: [
      "Sanitização e validação Zod rigorosa em todos os formulários e endpoints.",
      "Cookies HttpOnly seguros para controle de sessão.",
      "Queries SQL 100% parametrizadas prevenindo SQL Injection.",
    ],
  };

  const deployGuide = {
    prerequisites: [
      "Node.js 20+ ou 22+",
      "PostgreSQL (Supabase, Neon, Railway ou local Docker)",
      "Conta na Vercel ou VPS para deploy",
    ],
    commands: [
      "npm install",
      "npx drizzle-kit push",
      "npm run dev",
    ],
    envVariables: [
      "DATABASE_URL=postgresql://user:pass@host:5432/db",
      "AUTH_SECRET=sua_chave_secreta_jwt",
    ],
  };

  return {
    appTitle,
    tagline,
    category,
    summary: `Arquitetura completa e aplicativo interativo gerados para "${userPrompt}".`,
    squadRationale,
    suggestedAgentIds,
    meetingSteps,
    appType,
    interactiveApp,
    sourceFiles,
    architectureDoc,
    deployGuide,
  };
}
