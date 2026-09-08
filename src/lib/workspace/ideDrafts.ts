export interface IdeSourceFile {
  path: string;
  content: string;
}

export interface IdeWorkspaceIdentity {
  projectId?: string;
  missionId?: string;
}

/** Legacy projects may omit a mission ID or store it as ""; project IDs never fall back to a title. */
export function canSaveIdeWorkspace(displayed: IdeWorkspaceIdentity | null | undefined, active: IdeWorkspaceIdentity | null | undefined): boolean {
  if (!displayed || !active || typeof displayed.projectId !== "string" || !displayed.projectId.trim()) return false;
  if (displayed.projectId !== active.projectId) return false;
  const validMission = (value: unknown) => value === undefined || value === "" || (typeof value === "string" && value.trim().length > 0);
  return validMission(displayed.missionId) && validMission(active.missionId) && (displayed.missionId || undefined) === (active.missionId || undefined);
}

export interface IdeDraftConflict {
  path: string;
  kind: "changed" | "removed";
}

export interface IdeDraftState<T extends IdeSourceFile> {
  source: T[];
  drafts: T[];
  conflicts: IdeDraftConflict[];
}

const copy = <T extends IdeSourceFile>(files: T[]) => files.map(file => ({ ...file }));

/** State belongs to one project. Remount/reset it when the project identity changes. */
export function createIdeDrafts<T extends IdeSourceFile>(source: T[]): IdeDraftState<T> {
  return { source: copy(source), drafts: copy(source), conflicts: [] };
}

export function dirtyIdePaths<T extends IdeSourceFile>(state: IdeDraftState<T>): Set<string> {
  const source = new Map(state.source.map(file => [file.path, file.content]));
  return new Set(state.drafts.filter(file => !source.has(file.path) || source.get(file.path) !== file.content).map(file => file.path));
}

/** Refresh untouched files, but never replace unsaved content with an incoming snapshot. */
export function reconcileIdeDrafts<T extends IdeSourceFile>(state: IdeDraftState<T>, incoming: T[]): IdeDraftState<T> {
  const source = new Map(state.source.map(file => [file.path, file]));
  const drafts = new Map(state.drafts.map(file => [file.path, file]));
  const pending = new Set(state.conflicts.map(conflict => conflict.path));
  const nextPaths = new Set(incoming.map(file => file.path));
  const conflicts: IdeDraftConflict[] = [];
  const nextDrafts = incoming.map(file => {
    const local = drafts.get(file.path);
    const previous = source.get(file.path);
    if (!local || (previous && local.content === previous.content) || local.content === file.content)
      return { ...file };
    if (pending.has(file.path) || previous?.content !== file.content)
      conflicts.push({ path: file.path, kind: "changed" });
    return { ...file, content: local.content };
  });

  // Keep a locally edited file even when a new candidate deleted it.
  for (const local of state.drafts) {
    if (nextPaths.has(local.path)) continue;
    const previous = source.get(local.path);
    if (!previous || local.content !== previous.content) {
      nextDrafts.push({ ...local });
      if (previous || pending.has(local.path)) conflicts.push({ path: local.path, kind: "removed" });
    }
  }
  return { source: copy(incoming), drafts: nextDrafts, conflicts };
}

export function editIdeDraft<T extends IdeSourceFile>(state: IdeDraftState<T>, path: string, content: string): IdeDraftState<T> {
  const source = state.source.find(file => file.path === path);
  return {
    ...state,
    drafts: state.drafts.map(file => file.path === path ? { ...file, content } : file),
    conflicts: source?.content === content ? state.conflicts.filter(conflict => conflict.path !== path) : state.conflicts,
  };
}

/** Both overwriting incoming content and discarding a draft require an explicit choice. */
export function resolveIdeDraft<T extends IdeSourceFile>(state: IdeDraftState<T>, path: string, choice: "local" | "incoming"): IdeDraftState<T> {
  if (!state.conflicts.some(conflict => conflict.path === path)) return state;
  const incoming = state.source.find(file => file.path === path);
  return {
    ...state,
    drafts: choice === "local" ? state.drafts : state.drafts.flatMap(file => file.path !== path ? [file] : incoming ? [{ ...incoming }] : []),
    conflicts: state.conflicts.filter(conflict => conflict.path !== path),
  };
}
