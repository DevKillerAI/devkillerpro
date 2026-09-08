import type { ProjectWorkspace } from "./projectWorkspace";
export function missionActivityState(project:ProjectWorkspace) {
  if(project.executionStatus==="cancelled") return "Cancelled";
  if(project.status==="READY") return "Ready";
  if(project.status==="FAILED"||project.status==="BLOCKED") return "Needs attention";
  if(project.evidence?.at(-1)?.stage==="recovery") return "Repairing";
  return "Working";
}
export function activityText(stage:string,status:string) {
  if(status==="failed") return {title:"A check needs attention",text:"The latest result was not approved. See the diagnostic for details."};
  if(stage==="recovery") return {title:"Repairing the build",text:"A check found an issue. The builder is working on the recorded repair plan."};
  if(stage==="council") return status==="verified"
    ? {title:"Council decision recorded",text:"The specialists completed their contributions. The build can proceed."}
    : {title:"Specialists are reviewing the brief",text:"Product, design and engineering decisions are being prepared."};
  if(stage==="functional-qa") return {title:status==="verified"?"Quality review recorded":"Reviewing the application",text:"Functional requirements and delivery checks are being evaluated."};
  if(stage==="build"||stage==="revision") return {title:status==="verified"?"Build recorded":"Writing and checking the application",text:status==="verified"?"The generated files have been saved.":"The builder is creating the application and checking its required behavior."};
  return {title:"Mission opened",text:"The workspace has been created for this request."};
}
