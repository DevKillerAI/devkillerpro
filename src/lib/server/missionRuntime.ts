import "server-only";
import { backgroundJson } from "./openaiBackground";
import { selectTaskModel } from "./modelRouting";
import { missionContext } from "./jobs/cancellation";
import { assertMissionActive, missionSignal } from "./jobs/cancellation";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileSnapshot } from './fileSnapshot';
import { database, databaseConfigured } from "./database";

export type MissionStage = "planned" | "running" | "failed" | "verified";
export interface StageEvidence {
  stage: string;
  status: MissionStage;
  at: string;
  summary: string;
  artifact?: string;
  details?: Record<string, unknown>;
}
export interface MissionManifest {
  missionId: string;
  prompt: string;
  provider: "OpenAI";
  model: string;
  status: MissionStage;
  createdAt: string;
  updatedAt: string;
  evidence: StageEvidence[];
}

const MISSIONS_ROOT = path.join(process.cwd(), ".devkiller", "missions");
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
function missionDirectory(missionId: string) {
  if (!SAFE_ID.test(missionId)) throw new Error("Invalid mission id.");
  return path.join(MISSIONS_ROOT, missionId);
}

export async function createMission(
  missionId: string,
  prompt: string,
  model: string,
) {
  const dir = missionDirectory(missionId);
  await assertMissionActive(missionId);
  if (databaseConfigured()) {
    try {
      await database()`
        insert into public.missions (id, prompt, status)
        values (${missionId}, ${prompt}, 'running')
        on conflict (id) do update set prompt = excluded.prompt, status = 'running'
      `;
    } catch {}
  }
  await mkdir(path.join(dir, "artifacts", "council"), { recursive: true });
  await mkdir(path.join(dir, "workspace"), { recursive: true });
  const now = new Date().toISOString();
  const manifest: MissionManifest = {
    missionId,
    prompt,
    provider: "OpenAI",
    model,
    status: "planned",
    createdAt: now,
    updatedAt: now,
    evidence: [
      {
        stage: "mission",
        status: "planned",
        at: now,
        summary: "Mission workspace created.",
      },
    ],
  };
  await writeArtifact(missionId, "manifest.json", manifest);
  return manifest;
}
export async function readManifest(missionId: string) {
  return JSON.parse(
    await readFile(
      path.join(missionDirectory(missionId), "artifacts", "manifest.json"),
      "utf8",
    ),
  ) as MissionManifest;
}
export async function listMissionManifests(limit = 50) {
  await mkdir(MISSIONS_ROOT, { recursive: true });
  const entries = await readdir(MISSIONS_ROOT, { withFileTypes: true });
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
      .map(async (entry) => {
        try {
          return await readManifest(entry.name);
        } catch {
          return null;
        }
      }),
  );
  return manifests
    .filter((manifest): manifest is MissionManifest => Boolean(manifest))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, Math.max(1, Math.min(100, limit)));
}

export async function readMissionWorkspaceFiles(missionId: string) {
  const base = path.join(missionDirectory(missionId), "workspace");
  const files: { path: string; content: string }[] = [];
  const walk = async (directory: string) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= 250) return;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) {
        const metadata = await stat(target);
        if (metadata.size > 1_000_000) continue;
        files.push({
          path: path.relative(base, target).replaceAll("\\", "/"),
          content: await readFile(target, "utf8"),
        });
      }
    }
  };
  await walk(base);
  return files;
}
export async function readArtifact<T>(missionId: string, relativeName: string) {
  const base = path.join(missionDirectory(missionId), "artifacts");
  const target = path.resolve(base, relativeName);
  if (!target.startsWith(base + path.sep))
    throw new Error("Artifact path escapes mission directory.");
  return JSON.parse(await readFile(target, "utf8")) as T;
}
export async function updateManifest(
  missionId: string,
  update: Partial<MissionManifest>,
  event?: StageEvidence,
) {
  const current = await readManifest(missionId);
  const next = {
    ...current,
    ...update,
    updatedAt: new Date().toISOString(),
    evidence: event ? [...current.evidence, event] : current.evidence,
  };
  await writeArtifact(missionId, "manifest.json", next);
  return next;
}
export async function writeArtifact(
  missionId: string,
  relativeName: string,
  value: unknown,
) {
  await assertMissionActive(missionId);
  const base = path.join(missionDirectory(missionId), "artifacts");
  const target = path.resolve(base, relativeName);
  if (target !== base && !target.startsWith(base + path.sep))
    throw new Error("Artifact path escapes mission directory.");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2), "utf8");
  return path.relative(process.cwd(), target).replaceAll("\\", "/");
}
export async function writeWorkspaceFiles(
  missionId: string,
  files: { path: string; content: string }[],
) {
  await assertMissionActive(missionId);
  const base = path.join(missionDirectory(missionId), "workspace");
  return writeFileSnapshot(base,files);
}
export async function writeCandidateFiles(
  missionId: string,
  candidateId: string,
  files: { path: string; content: string }[],
) {
  if (!SAFE_ID.test(candidateId)) throw new Error("Invalid candidate id.");
  await assertMissionActive(missionId);
  const base = path.join(
    missionDirectory(missionId),
    "candidates",
    candidateId,
  );
  return writeFileSnapshot(base,files);
}
export function publicError(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown failure")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 1200);
}

export async function openAIJson<T>(args: {
  schemaName: string;
  schema: Record<string, unknown>;
  prompt: string;
  parse: z.ZodType<T>;
}) {
  if (missionContext()) {
    const result = await backgroundJson(args);
    return { ...result, data: args.parse.parse(result.data) };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  const model = selectTaskModel(args.schemaName);
  if (!apiKey)
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  if (!model) throw new Error("OPENAI_MODEL is not configured on the server.");
  const maximumAttempts = Math.max(
    2,
    Math.min(4, Number(process.env.DEVKILLER_OPENAI_ATTEMPTS) || 3),
  );
  let lastFailure = "OpenAI request failed.";
  for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
    missionSignal()?.throwIfAborted();
    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(missionSignal() ? [missionSignal()!] : [])]),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "DevKiller's interface language is English. Write operational summaries, QA findings, recovery plans, status explanations and diagnostic messages in English, regardless of the language of the mission request. Preserve original user content and product names. Generated application content may follow the user's explicitly requested language." },
              { role: "user", content: args.prompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: args.schemaName,
                strict: true,
                schema: args.schema,
              },
            },
          }),
        },
      );
      const requestId = response.headers.get("x-request-id") || undefined;
      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        lastFailure = `OpenAI request failed (${response.status}, request ${requestId || "unavailable"}): ${payload?.error?.message || "No provider message"}`;
        if (
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 409 &&
          response.status !== 429
        )
          throw new Error(lastFailure);
      } else {
        const raw = payload?.choices?.[0]?.message?.content;
        if (typeof raw !== "string")
          throw new Error(
            `OpenAI returned no structured content (request ${requestId || "unavailable"}).`,
          );
        let decoded: unknown;
        try {
          decoded = JSON.parse(raw);
        } catch {
          throw new Error(
            `OpenAI returned invalid JSON (request ${requestId || "unavailable"}).`,
          );
        }
        return {
          data: args.parse.parse(decoded),
          requestId,
          usage: payload.usage,
          model,
        };
      }
    } catch (error) {
      lastFailure =
        error instanceof Error
          ? error.message
          : "Network failure while contacting OpenAI.";
      if (
        /OPENAI_API_KEY|OPENAI_MODEL|invalid JSON|structured content|\(4\d\d,/.test(
          lastFailure,
        ) &&
        !/\((408|409|429),/.test(lastFailure)
      )
        throw error;
    }
    if (attempt < maximumAttempts)
      await new Promise((resolve) =>
        setTimeout(resolve, 750 * 2 ** (attempt - 1)),
      );
  }
  throw new Error(`${lastFailure} after ${maximumAttempts} attempts.`);
}
