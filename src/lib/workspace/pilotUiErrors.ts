export type PilotUiErrors = { selectedRunId: string; runs: string; detail: string; action: string };
export const INITIAL_PILOT_UI_ERRORS: PilotUiErrors = { selectedRunId: '', runs: '', detail: '', action: '' };
type PilotUiErrorUpdate =
  | { type: 'select-run'; runId: string }
  | { type: 'runs-result'; error: string }
  | { type: 'detail-result'; runId: string; error: string }
  | { type: 'action-result'; error: string };

/** A successful refresh resolves only its own error, never a failed user action. */
export function pilotUiErrors(state: PilotUiErrors, update: PilotUiErrorUpdate): PilotUiErrors {
  if (update.type === 'select-run') return state.selectedRunId === update.runId ? state : { ...state, selectedRunId: update.runId, detail: '' };
  if (update.type === 'runs-result') return { ...state, runs: update.error };
  if (update.type === 'action-result') return { ...state, action: update.error };
  return update.runId === state.selectedRunId ? { ...state, detail: update.error } : state;
}
