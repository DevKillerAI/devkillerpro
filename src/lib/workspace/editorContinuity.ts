import type { ProjectWorkspace } from './projectWorkspace';

// Registry status describes the latest operation, not whether a previous
// approved delivery remains usable. Candidate files are never previewed here.
export function hasDeliveredPreview(project: ProjectWorkspace): boolean {
  return project.sourceFiles.length > 0 && (project.status === 'READY' ||
    Boolean(project.evidence?.some(event => ['build','delivery'].includes(event.stage) && event.status === 'verified')));
}

export function preservePreviewIdentity<T extends {sourceFiles?: unknown;appTitle?:string}>(current:T|null,next:T):T {
  return current && current.appTitle===next.appTitle && JSON.stringify(current.sourceFiles)===JSON.stringify(next.sourceFiles) ? current : next;
}
