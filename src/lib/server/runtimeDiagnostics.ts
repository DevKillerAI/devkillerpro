import {redactKnowledge} from './rag/governance';
export type RuntimeState={Running?:boolean;ExitCode?:number;OOMKilled?:boolean;Error?:string};
export class RuntimeStartupError extends Error {
  code:number|undefined; stdout:string; stderr:string; killed:boolean;
  constructor(state:RuntimeState,stdout:string,stderr:string,lastHttp?:number){
    const detail=redactKnowledge([state.Error,stderr,stdout].filter(Boolean).join('\n')).slice(-6000);
    super(`Backend did not become ready. State: ${state.Running===false?'exited':'not ready'}; exit: ${state.ExitCode??'unknown'}; OOM: ${Boolean(state.OOMKilled)}; last HTTP: ${lastHttp??'unavailable'}.\n${detail||'Container produced no diagnostic output.'}`);
    this.name='RuntimeStartupError';this.code=state.ExitCode;this.killed=Boolean(state.OOMKilled);
    this.stdout=redactKnowledge(stdout).slice(-6000);this.stderr=redactKnowledge(stderr).slice(-6000);
  }
}
