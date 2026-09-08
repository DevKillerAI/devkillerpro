"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { DynamicMultiLayerSandbox } from "@/components/sandbox/DynamicMultiLayerSandbox";
import { GeneratedAppPackage } from "@/lib/orchestrator/appGenerator";
import { getAllProjects, loadActiveWorkspace, workspaceToAppPackage } from "@/lib/workspace/projectWorkspace";
import type { ProjectWorkspace } from '@/lib/workspace/projectWorkspace';
import { hasDeliveredPreview } from '@/lib/workspace/editorContinuity';

export default function StandaloneSandboxPage() {
  const [appPackage, setAppPackage] = useState<GeneratedAppPackage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editorUrl, setEditorUrl] = useState("/?editor=1");
  const [missionId, setMissionId] = useState<string>();
  useEffect(() => {
    let cancelled=false;
    const projectId = new URLSearchParams(window.location.search).get("project");
    const cached = projectId ? getAllProjects().find(project => project.projectId === projectId || project.missionId===projectId) : loadActiveWorkspace();
    const load=async()=>{
    try {
    const response=await fetch('/api/missions',{cache:'no-store'});
    if(!response.ok)throw new Error('Registry unavailable');
    const data=await response.json() as {projects?:ProjectWorkspace[]};
    const identity=cached?.missionId || projectId;
    const workspace=data.projects?.find(project=>project.missionId===identity || project.projectId===identity);
    if(cancelled)return;
    if (workspace?.appTitle && hasDeliveredPreview(workspace)) {
      setMissionId(workspace.missionId);
      setEditorUrl(`/?editor=1&project=${encodeURIComponent(workspace.missionId)}`);
      const app = workspaceToAppPackage(workspace);
      setAppPackage(app);
      document.title = app.appTitle;
    }
    }catch { /* Do not substitute an unrelated or stale cached delivery. */ }
    if(!cancelled)
    setLoaded(true);
    };
    void load();return ()=>{cancelled=true;};
  }, []);
  return (
    <main className="min-h-[100dvh] bg-white text-slate-900">
      {appPackage ? <DynamicMultiLayerSandbox appPackage={appPackage} missionId={missionId} standalone /> : (
        <div className="flex min-h-[100dvh] items-center justify-center p-8 text-center">
          <p>{loaded ? "Open a project in the editor to preview your application." : "Opening application…"}</p>
        </div>
      )}
      <a href={editorUrl} className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur transition hover:border-[#FF4B72] hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4B72]">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to editor
      </a>
    </main>
  );
}
