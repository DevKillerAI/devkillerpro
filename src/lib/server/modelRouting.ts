export type ModelTask = "council" | "build" | "qa" | "repair";
export function modelTask(schemaName:string):ModelTask {
  if(schemaName === "functional_qa_review") return "qa";
  if(["mission_patch_repair","delivery_recovery_plan"].includes(schemaName)) return "repair";
  if(schemaName === "mission_build") return "build";
  return "council";
}
// Server-only settings, deliberately opt-in. Never silently change model on
// network failure or let a generated prompt choose a more expensive model.
export function selectTaskModel(schemaName:string, settings:Record<string,string|undefined>=process.env) {
  const baseline=settings.OPENAI_MODEL;
  if(!baseline) throw new Error("OPENAI_MODEL must be configured on the server.");
  if(settings.DEVKILLER_MODEL_ROUTING !== "enabled") return baseline;
  const override=settings[`OPENAI_MODEL_${modelTask(schemaName).toUpperCase()}`]?.trim();
  return override || baseline;
}
