export type DeliveryDepth = "prototype" | "local_mvp" | "commercial_pilot" | "production";

export interface MissionBrief {
  appName: string;
  vision: string;
  targetUsers: string;
  platform: "responsive_web" | "desktop_web" | "mobile_first" | "internal_tool";
  deliveryDepth: DeliveryDepth;
  designStyle: string;
  palette: { primary: string; secondary: string; accent: string };
  visualKeywords: string;
  referenceImages: { name: string; type: string; dataUrl: string }[];
  coreFeatures: string;
  integrations: string;
  dataSensitivity: "low" | "standard" | "sensitive" | "regulated";
  dataProvider: "auto" | "none" | "sqlite" | "supabase" | "firebase";
  authentication: "auto" | "not_required" | "required";
  offlineExpectation: "not_required" | "helpful" | "required";
  constraints: string;
  nonGoals: string;
}

export function briefFromPrompt(prompt: string): MissionBrief {
  return { appName: "", vision: prompt, targetUsers: "", platform: "responsive_web", deliveryDepth: "local_mvp", designStyle: "Modern and polished", palette: { primary: "#FF4B72", secondary: "#172033", accent: "#10B981" }, visualKeywords: "", referenceImages: [], coreFeatures: "", integrations: "", dataSensitivity: "standard", dataProvider: "auto", authentication: "auto", offlineExpectation: "not_required", constraints: "", nonGoals: "" };
}

export function compileMissionBrief(brief: MissionBrief, visualDirection?: string) {
  return [`Build ${brief.appName ? `an application named "${brief.appName}"` : "an application"}.`, `Product vision: ${brief.vision}`, brief.targetUsers && `Primary users: ${brief.targetUsers}`, `Platform: ${brief.platform.replaceAll("_", " ")}.`, `Delivery depth explicitly selected by the user: ${brief.deliveryDepth}.`, brief.coreFeatures && `Core features: ${brief.coreFeatures}`, `Visual direction: ${brief.designStyle}. Palette: primary ${brief.palette.primary}, secondary ${brief.palette.secondary}, accent ${brief.palette.accent}. ${brief.visualKeywords}`, visualDirection && `Reference-image analysis: ${visualDirection}`, brief.integrations && `Required integrations: ${brief.integrations}`, `Data sensitivity: ${brief.dataSensitivity}. Data provider explicitly selected: ${brief.dataProvider}. Authentication requirement: ${brief.authentication}. Offline expectation: ${brief.offlineExpectation}.`, brief.constraints && `Constraints: ${brief.constraints}`, brief.nonGoals && `Explicit non-goals: ${brief.nonGoals}`].filter(Boolean).join("\n");
}
