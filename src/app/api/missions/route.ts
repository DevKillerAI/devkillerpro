import { NextResponse } from "next/server";
import {
  listMissionManifests,
  readArtifact,
  readMissionWorkspaceFiles,
  type MissionManifest,
} from "@/lib/server/missionRuntime";
import { database, databaseConfigured } from "@/lib/server/database";
import { listMissionQueueRecords } from "@/lib/server/jobs/queue";
import { accessContext, accessError } from "@/lib/server/access";
import {isSameOriginRequest} from "@/lib/server/requestOrigin";

export const runtime = "nodejs";

// Recoverable removal: retain artifacts and audit history, hide the mission from the registry.
export async function DELETE(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({error:"Origin not allowed."},{status:403});
  try {
    const access = await accessContext(req);
    if (access.internal) throw new Error("FORBIDDEN");
    const id = new URL(req.url).searchParams.get("missionId");
    if (!id || !/^[a-zA-Z0-9_-]{8,180}$/.test(id)) return NextResponse.json({error:"Invalid mission."},{status:400});
    const rows = await database()`update missions set metadata=coalesce(metadata,'{}'::jsonb)||'{"discarded":true}'::jsonb
      where id=${id} and (owner_id=${access.userId} or ${access.role === 'admin'})
      and not exists(select 1 from mission_jobs where mission_id=${id} and status in ('queued','running','retrying')) returning id`;
    if (!rows.length) return NextResponse.json({error:"Abort an active mission before deleting it, or refresh and try again."},{status:409});
    return NextResponse.json({success:true});
  } catch (error) {
    const known=accessError(error);
    return NextResponse.json({error:known?.error || "Unable to delete mission."},{status:known?.status || 500});
  }
}

// Increment only when an administrator explicitly resets the complete mission
// registry. Browsers use it to discard stale cached mission cards once.
const MISSION_REGISTRY_EPOCH = "2026-09-03-v2-owner-cutover-v1";

type CouncilArtifact = {
  decision?: {
    appTitle?: string;
    tagline?: string;
    category?: string;
    summary?: string;
    appType?: string;
    squadRationale?: string;
    architectureDecisions?: string[];
    securityChecklist?: string[];
  };
  contributions?: Array<{
    agentId?: string;
    agentName?: string;
    agentRole?: string;
    analysis?: string;
    recommendation?: string;
  }>;
};

const languageFor = (filePath: string) =>
  filePath.split(".").pop()?.toLowerCase() || "text";
const presentationText = (value: string) =>
  value
    .replace(/\bsimulated\b/gi, "demonstrative")
    .replace(/\bsimulate\b/gi, "demonstrate")
    .replace(/\bsimulation\b/gi, "scenario");
const presentationList = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => presentationText(String(item))) : [];

async function missionProject(manifest: MissionManifest) {
  let council: CouncilArtifact = {};
  try {
    council = await readArtifact<CouncilArtifact>(
      manifest.missionId,
      "council/decision.json",
    );
  } catch {}
  const files = await readMissionWorkspaceFiles(manifest.missionId);
  const decision = council.decision || {};
  const latestFailure = [...manifest.evidence]
    .reverse()
    .find((event) => event.status === "failed");
  const status =
    manifest.status === "verified" && files.length > 0
      ? "READY"
      : manifest.status === "verified"
        ? "BLOCKED"
      : manifest.status === "failed"
        ? "FAILED"
        : manifest.evidence.some((event) => event.stage === "council" && event.status === "verified")
          ? "MEETING_DONE"
          : "GENERATING";
  return {
    projectId: manifest.missionId,
    missionId: manifest.missionId,
    originalPrompt: manifest.prompt,
    version: Math.max(
      1,
      manifest.evidence.filter((event) => event.stage === "build" && event.status === "verified").length,
    ),
    createdAt: manifest.createdAt,
    status,
    executionStatus: status === "BLOCKED" ? "failed" : manifest.status,
    errorMessage:
      manifest.status === "verified" && files.length === 0
        ? "Verified evidence exists, but persisted source files are unavailable."
        : latestFailure?.summary
          ? presentationText(latestFailure.summary)
          : undefined,
    evidence: manifest.evidence.map((event) => ({
      ...event,
      summary: presentationText(event.summary),
    })),
    deliveryLimitations: presentationList(
      [...manifest.evidence]
        .reverse()
        .find((event) => Array.isArray(event.details?.deferredCapabilities))
        ?.details?.deferredCapabilities,
    ),
    appTitle:
      decision.appTitle ||
      manifest.prompt.match(/(?:named|called|chamad[oa])\s+["“]?([^"”\n.]+)/i)?.[1] ||
      "Untitled mission",
    tagline: presentationText(decision.tagline || manifest.prompt.slice(0, 120)),
    category: decision.category || "Software mission",
    summary: presentationText(decision.summary || manifest.prompt.slice(0, 320)),
    appType: decision.appType || "custom",
    squadRationale: presentationText(
      decision.squadRationale || "Recorded council mission.",
    ),
    suggestedAgentIds: (council.contributions || [])
      .map((item) => item.agentId)
      .filter((id): id is string => Boolean(id)),
    meetingSteps: (council.contributions || []).map((item, index) => ({
      phase: "INDEPENDENT ANALYSIS",
      agentId: item.agentId || `agent-${index + 1}`,
      agentName: item.agentName || "Specialist",
      agentRole: item.agentRole || "Council specialist",
      speech: presentationText(item.analysis || "Recorded contribution available."),
      keyPoint: presentationText(item.recommendation || "See council evidence."),
      avatarColor: ["#FF4B72", "#111420", "#FF6B6B", "#475569"][index % 4],
    })),
    interactiveApp: { themeColor: "slate", screens: [] },
    sourceFiles: files.map((file) => ({
      ...file,
      name: file.path.split("/").pop() || file.path,
      language: languageFor(file.path),
      description: "Persisted mission source file",
    })),
    architectureDoc: {
      title: `ADR-001: ${decision.appTitle || "Mission architecture"}`,
      adrCode: "ADR-001",
      date: manifest.createdAt.slice(0, 10),
      status: "Accepted by Council",
      decisions: (decision.architectureDecisions || []).map(presentationText),
      dataModel: [],
      securityChecklist: (decision.securityChecklist || []).map(presentationText),
    },
    deployGuide: { prerequisites: [], commands: [], envVariables: [] },
    generation: {
      provider: manifest.provider,
      modelUsed: manifest.model,
      isLiveLLM: true,
    },
  };
}

function queuedMissionProject(row: Record<string, unknown>) {
  const missionId = String(row.id);
  const prompt = String(row.prompt || "Queued software mission");
  const dbStatus = String(row.status || "queued");
  const status =
    dbStatus === "verified"
      ? "READY"
      : dbStatus === "failed" || dbStatus === "cancelled"
        ? "FAILED"
        : dbStatus === "running" && String(row.phase) !== "council"
          ? "MEETING_DONE"
          : "GENERATING";
  return {
    projectId: missionId,
    missionId,
    originalPrompt: prompt,
    version: 1,
    createdAt: new Date(String(row.created_at)).toISOString(),
    status,
    executionStatus: dbStatus,
    errorMessage: row.error_message ? presentationText(String(row.error_message)) : undefined,
    evidence: [],
    deliveryLimitations: [],
    appTitle: row.app_title ? String(row.app_title) : "Mission in progress",
    tagline: prompt.slice(0, 120),
    category: "Software mission",
    summary: prompt.slice(0, 320),
    appType: "custom",
    squadRationale: "Assigned specialist squad.",
    suggestedAgentIds: [],
    meetingSteps: [],
    interactiveApp: { themeColor: "slate", screens: [] },
    sourceFiles: [],
    architectureDoc: {
      title: "Mission architecture",
      adrCode: "ADR-001",
      date: new Date(String(row.created_at)).toISOString().slice(0, 10),
      status: "In progress",
      decisions: [],
      dataModel: [],
      securityChecklist: [],
    },
    deployGuide: { prerequisites: [], commands: [], envVariables: [] },
    generation: { provider: "OpenAI", modelUsed: process.env.OPENAI_MODEL || "configured model", isLiveLLM: true },
    queueProgress: Number(row.progress || 0),
    queuePhase: String(row.phase || "council"),
  };
}

export async function GET(req: Request) {
  let access; try { access=await accessContext(req); } catch(error) { const known=accessError(error); return NextResponse.json({success:false,error:known?.error||"Authentication required."},{status:known?.status||401}); }
  const manifests = await listMissionManifests(50);
  const persistedProjects = await Promise.all(manifests.map(missionProject));
  let queuedProjects: ReturnType<typeof queuedMissionProject>[] = [];
  let discardedMissionIds: string[] = [];
  if (databaseConfigured()) {
    try {
      const rows = await listMissionQueueRecords(50, access.userId, access.role === "admin");
      discardedMissionIds = rows.filter(row => row.metadata?.discarded).map(row => String(row.id));
      queuedProjects = rows.filter(row => !row.metadata?.discarded).map((row) =>
        queuedMissionProject(row as Record<string, unknown>),
      );
    } catch {}
  }
  const projectsByMission = new Map(
    queuedProjects.map((project) => [project.missionId, project]),
  );
  for (const project of persistedProjects)
    projectsByMission.set(project.missionId, {
      ...(projectsByMission.get(project.missionId) || {}),
      ...project,
    } as ReturnType<typeof queuedMissionProject>);
  for (const queued of queuedProjects) {
    const project = projectsByMission.get(queued.missionId);
    if (project && queued.executionStatus !== 'verified') projectsByMission.set(queued.missionId, {
      ...project, status: queued.status, executionStatus: queued.executionStatus,
      appTitle: project.appTitle === "Untitled mission" ? queued.appTitle : project.appTitle,
      errorMessage: queued.errorMessage, queuePhase: queued.queuePhase, queueProgress: queued.queueProgress,
    });
  }
  const allowedMissionIds = new Set(queuedProjects.map(project=>project.missionId));
  const projects = [...projectsByMission.values()].filter(project => allowedMissionIds.has(project.missionId) && !discardedMissionIds.includes(project.missionId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 50);
  const activity = await database()`select distinct on (r.mission_id) r.mission_id,r.schema_name,r.status,r.created_at,r.updated_at
    from provider_requests r join missions m on m.id=r.mission_id
    where m.status in ('running','waiting','queued') and (${access.role === 'admin'} or m.owner_id=${access.userId})
    order by r.mission_id,r.created_at desc`;
  const visibleProjects = projects.map(project => {
    const row=activity.find(item=>item.mission_id===project.missionId);
    return {...project,providerActivity:row ? {schema:row.schema_name,status:row.status,startedAt:row.created_at,checkedAt:row.updated_at}:undefined};
  });
  return NextResponse.json(
    {
      success: true,
      projects: visibleProjects,
      discardedMissionIds,
      registryEpoch: MISSION_REGISTRY_EPOCH,
      synchronizedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
