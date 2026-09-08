/**
 * DevKiller Project Workspace
 * 
 * SINGLE SOURCE OF TRUTH for all generated projects and multi-workspace management.
 * Code Viewer, Sandbox, ZIP Exporter, and ADR read exclusively from here.
 */

import type { GeneratedAppPackage } from "@/lib/orchestrator/appGenerator";

export type WorkspaceStatus =
  | "EMPTY"        // No mission initiated
  | "GENERATING"   // Deliberation and coding in progress
  | "MEETING_DONE" // Council meeting concluded, compiling code
  | "READY"        // Fully compiled, operational, and verified
  | "FAILED"       // Generation failure with graceful retry
  | "BLOCKED";     // Security or QA veto

export interface ProjectFile {
  name: string;
  path: string;
  language: string;
  description: string;
  content: string;
}

export interface ProjectScreen {
  id: string;
  name: string;
  icon: string;
  description: string;
  stats?: { label: string; value: string; change?: string }[];
  items?: { id: string; title: string; subtitle: string; value: string; tag: string; status: string }[];
  formFields?: { label: string; name: string; type: string; placeholder: string }[];
}

export interface ProjectArchitectureDoc {
  title: string;
  adrCode: string;
  date: string;
  status: string;
  decisions: string[];
  dataModel: string[];
  securityChecklist: string[];
}

export interface ProjectWorkspace {
  providerActivity?: { schema: string; status: string; startedAt: string; checkedAt: string };
  // Identity
  projectId: string;
  missionId: string;
  originalPrompt?: string;
  version: number;
  createdAt: string;
  
  // Status
  status: WorkspaceStatus;
  errorMessage?: string;
  executionStatus?: "planned" | "running" | "failed" | "verified" | "cancelled";
  evidence?: { stage: string; status: "planned" | "running" | "failed" | "verified"; at: string; summary: string; artifact?: string }[];
  deliveryLimitations?: string[];
  
  // App Metadata
  appTitle: string;
  tagline: string;
  category: string;
  summary: string;
  appType: string;
  
  // Council Deliberation
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
  
  // Generated UI & Prototype
  interactiveApp: {
    themeColor: string;
    screens: ProjectScreen[];
  };
  
  // Source Code Files
  sourceFiles: ProjectFile[];
  
  // Architecture & Documentation
  architectureDoc: ProjectArchitectureDoc;
  deployGuide: {
    prerequisites: string[];
    commands: string[];
    envVariables: string[];
  };
  
  // Observability & Telemetry
  generation: {
    provider: string;
    modelUsed: string;
    isLiveLLM: boolean;
    meetingTokensUsed?: number;
    codegenTokensUsed?: number;
    totalDurationMs?: number;
  };
}

export interface WorkspaceAggregates {
  totalProjects: number;
  totalTasks: number;
  totalTokens: number;
  estimatedHoursSaved: number;
  totalCostSavedUSD: number;
  activeProject: ProjectWorkspace | null;
  allProjects: ProjectWorkspace[];
}

/** Creates an empty workspace (initial state before any mission) */
export function createEmptyWorkspace(): ProjectWorkspace {
  return {
    projectId: "",
    missionId: "",
    version: 0,
    createdAt: "",
    status: "EMPTY",
    executionStatus: "planned",
    evidence: [],
    deliveryLimitations: [],
    appTitle: "",
    tagline: "",
    category: "",
    summary: "",
    appType: "",
    squadRationale: "",
    suggestedAgentIds: [],
    meetingSteps: [],
    interactiveApp: { themeColor: "slate", screens: [] },
    sourceFiles: [],
    architectureDoc: {
      title: "",
      adrCode: "",
      date: "",
      status: "",
      decisions: [],
      dataModel: [],
      securityChecklist: [],
    },
    deployGuide: { prerequisites: [], commands: [], envVariables: [] },
    generation: { provider: "", modelUsed: "", isLiveLLM: false },
  };
}

/** Converts ProjectWorkspace to GeneratedAppPackage */
export function workspaceToAppPackage(ws: ProjectWorkspace): GeneratedAppPackage {
  return {
    appTitle: ws.appTitle,
    tagline: ws.tagline,
    category: ws.category,
    summary: ws.summary,
    squadRationale: ws.squadRationale,
    suggestedAgentIds: ws.suggestedAgentIds,
    meetingSteps: ws.meetingSteps,
    appType: (ws.appType || "custom") as any,
    interactiveApp: {
      themeColor: ws.interactiveApp?.themeColor || "slate",
      headline: ws.appTitle,
      screens: ws.interactiveApp?.screens || [],
    } as any,
    sourceFiles: ws.sourceFiles || [],
    architectureDoc: ws.architectureDoc,
    deployGuide: ws.deployGuide,
    generation: ws.generation,
  };
}


/** Generates a unique project ID */
export function generateProjectId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Generates a unique mission ID */
export function generateMissionId(prompt: string): string {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 24);
  return `mission_${slug}_${Date.now()}`;
}

const STORAGE_ACTIVE_WS_KEY = "devkiller_active_workspace";
const STORAGE_ACTIVE_APP_KEY = "devkiller_active_app";
const STORAGE_PROJECTS_STORE_KEY = "devkiller_projects_store";
const STORAGE_ACTIVE_ID_KEY = "devkiller_active_project_id";
const STORAGE_MISSION_REGISTRY_EPOCH_KEY = "devkiller_mission_registry_epoch";

export function applyMissionRegistryReset(registryEpoch: string) {
  if (typeof window === "undefined" || !registryEpoch) return false;
  if (localStorage.getItem(STORAGE_MISSION_REGISTRY_EPOCH_KEY) === registryEpoch)
    return false;
  localStorage.removeItem(STORAGE_PROJECTS_STORE_KEY);
  localStorage.removeItem(STORAGE_ACTIVE_WS_KEY);
  localStorage.removeItem(STORAGE_ACTIVE_APP_KEY);
  localStorage.removeItem(STORAGE_ACTIVE_ID_KEY);
  localStorage.removeItem("devkiller_project_history");
  localStorage.setItem(STORAGE_MISSION_REGISTRY_EPOCH_KEY, registryEpoch);
  return true;
}

export function mergeProjectCollections(
  localProjects: ProjectWorkspace[],
  serverProjects: ProjectWorkspace[],
) {
  const merged = new Map<string, ProjectWorkspace>();
  for (const project of localProjects)
    merged.set(project.missionId || project.projectId, project);
  for (const server of serverProjects) {
    const key = server.missionId || server.projectId;
    const local = merged.get(key);
    merged.set(key, {
      ...(local || createEmptyWorkspace()),
      ...server,
      projectId: local?.projectId || server.projectId,
      sourceFiles:
        server.sourceFiles?.length > 0
          ? server.sourceFiles
          : local?.sourceFiles || [],
      interactiveApp:
        (local?.interactiveApp?.screens?.length || 0) > 0
          ? local!.interactiveApp
          : server.interactiveApp,
      evidence: server.evidence || local?.evidence || [],
    });
  }
  return [...merged.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 50);
}

export function replaceProjectsStore(projects: ProjectWorkspace[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_PROJECTS_STORE_KEY, JSON.stringify(projects));
  const activeId = localStorage.getItem(STORAGE_ACTIVE_ID_KEY);
  const active =
    projects.find((project) => project.projectId === activeId) || projects[0];
  if (active) {
    localStorage.setItem(STORAGE_ACTIVE_WS_KEY, JSON.stringify(active));
    localStorage.setItem(
      STORAGE_ACTIVE_APP_KEY,
      JSON.stringify(workspaceToAppPackage(active)),
    );
    localStorage.setItem(STORAGE_ACTIVE_ID_KEY, active.projectId);
  }
}

/** Loads all stored projects from localStorage */
export function getAllProjects(): ProjectWorkspace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS_STORE_KEY);
    if (!raw) {
      // Fallback check legacy history
      const legacy = localStorage.getItem("devkiller_project_history");
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localStorage.setItem(STORAGE_PROJECTS_STORE_KEY, JSON.stringify(parsed));
          return parsed;
        }
      }
      return [];
    }
    return JSON.parse(raw) as ProjectWorkspace[];
  } catch (err) {
    console.warn("DevKiller: Error loading projects:", err);
    return [];
  }
}

/** Persists a single project and updates the multi-project store */
export function persistWorkspace(workspace: ProjectWorkspace, activate = true): void {
  if (typeof window === "undefined" || !workspace || !workspace.projectId) return;
  try {
    if (activate) {
    localStorage.setItem(STORAGE_ACTIVE_WS_KEY, JSON.stringify(workspace));
    localStorage.setItem(STORAGE_ACTIVE_APP_KEY, JSON.stringify(workspaceToAppPackage(workspace)));
    localStorage.setItem(STORAGE_ACTIVE_ID_KEY, workspace.projectId);
    }

    const all = getAllProjects();
    const idx = all.findIndex((p) => p.projectId === workspace.projectId);
    if (idx >= 0) {
      all[idx] = workspace;
    } else {
      all.unshift(workspace);
    }
    // Retain up to 50 isolated project workspaces
    localStorage.setItem(STORAGE_PROJECTS_STORE_KEY, JSON.stringify(all.slice(0, 50)));
  } catch (e) {
    console.warn("DevKiller: Unable to persist workspace:", e);
  }
}

/** Loads the active workspace from localStorage */
export function loadActiveWorkspace(): ProjectWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_ACTIVE_WS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProjectWorkspace;
  } catch {
    return null;
  }
}

/** Switches the active workspace to a specific project ID */
export function switchActiveProject(projectId: string): ProjectWorkspace | null {
  if (typeof window === "undefined") return null;
  const all = getAllProjects();
  const target = all.find((p) => p.projectId === projectId);
  if (target) {
    persistWorkspace(target);
    return target;
  }
  return null;
}

/** Deletes a project from the multi-project store */
export function deleteProject(projectId: string): ProjectWorkspace[] {
  if (typeof window === "undefined") return [];
  const all = getAllProjects().filter((p) => p.projectId !== projectId);
  localStorage.setItem(STORAGE_PROJECTS_STORE_KEY, JSON.stringify(all));

  const activeId = localStorage.getItem(STORAGE_ACTIVE_ID_KEY);
  if (activeId === projectId) {
    if (all.length > 0) {
      persistWorkspace(all[0]);
    } else {
      localStorage.removeItem(STORAGE_ACTIVE_WS_KEY);
      localStorage.removeItem(STORAGE_ACTIVE_APP_KEY);
      localStorage.removeItem(STORAGE_ACTIVE_ID_KEY);
    }
  }
  return all;
}

/** Computes live multi-project ROI, tokens, and engineering stats */
export function computeWorkspaceAggregates(): WorkspaceAggregates {
  const allProjects = getAllProjects();
  const activeProject = loadActiveWorkspace();

  let totalTasks = 0;
  let totalTokens = 0;

  allProjects.forEach((proj) => {
    // Count screens and items as completed tasks
    const screens = proj.interactiveApp?.screens || [];
    screens.forEach((s) => {
      totalTasks += (s.items?.length || 0) + (s.stats?.length || 0) + 1;
    });
    totalTasks += (proj.meetingSteps?.length || 0);

    // Calculate tokens
    const meetingTok = proj.generation?.meetingTokensUsed || 1850;
    const codegenTok = proj.generation?.codegenTokensUsed || 3200;
    totalTokens += (meetingTok + codegenTok);
  });

  // If no projects yet, provide realistic initial baseline
  if (allProjects.length === 0) {
    totalTasks = 0;
    totalTokens = 0;
  }

  // Estimated traditional dev hours saved (average 24 hours per web application delivery)
  const estimatedHoursSaved = Math.max(allProjects.length * 24, allProjects.length > 0 ? 24 : 0);
  
  // Traditional agency cost ($100/hour) minus AI API cost ($0.05/app)
  const traditionalCost = estimatedHoursSaved * 100;
  const aiCost = allProjects.length * 0.08;
  const totalCostSavedUSD = Math.max(0, traditionalCost - aiCost);

  return {
    totalProjects: allProjects.length,
    totalTasks: Math.max(totalTasks, allProjects.length * 8),
    totalTokens,
    estimatedHoursSaved,
    totalCostSavedUSD,
    activeProject,
    allProjects,
  };
}
