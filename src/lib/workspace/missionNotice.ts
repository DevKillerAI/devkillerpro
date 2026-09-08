export const DISMISSED_MISSION_NOTICES_KEY = "devkiller.dismissed-mission-notices.v1";

export function missionNoticeKey(projectId: string, stage: string, version = 0, eventAt = "") {
  return JSON.stringify([projectId, stage, version, eventAt]);
}

export function noticeForProject(project?: ProjectWorkspace): { projectId: string; title: string; stage: "ready" | "failed" | "build" | "council" } | null {
  if (!project || project.executionStatus === "cancelled") return null;
  const stage = project.status === "READY" ? "ready" : project.status === "FAILED" || project.status === "BLOCKED" ? "failed" : project.status === "MEETING_DONE" ? "build" : project.status === "GENERATING" ? "council" : null;
  return stage ? { projectId: project.projectId, title: project.appTitle, stage } : null;
}

export function noticeEventAt(project: ProjectWorkspace | undefined, stage: string) {
  // Progress evidence is not a new notification. Only a new terminal outcome
  // should reappear after dismissal, including a later retry of the same version.
  const status = stage === "ready" ? "verified" : stage === "failed" ? "failed" : null;
  return status ? project?.evidence?.filter(event => event.status === status && (event.stage === "build" || event.stage === "qa" || event.stage === "delivery")).at(-1)?.at || "" : "";
}

export function parseDismissedNotices(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}
import type { ProjectWorkspace } from "./projectWorkspace";
