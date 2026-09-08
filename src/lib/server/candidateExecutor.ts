import "server-only";
import { missionSignal } from "./jobs/cancellation";
import { spawn } from "node:child_process";
import path from "node:path";
import { runtimeSchema, testRuntime, checkRuntimeStartup, checkLocalRelease } from './localRuntime';
import { executeBrowserChecks, type BrowserEvidence } from './browserExecutor';
import {checkSupabaseSql,checkSupabaseBuild} from './supabaseExecutor';
import {provisionSupabaseSchema} from './supabaseRuntime';
import {verifyPantryLive} from './pantryVerification';
import {localSessionContractFailures} from './supabaseSessionContract';
import {operatorBrowserEvidence} from './operatorBrowserEvidence';
import {runtimeScriptFailures} from './runtimeScriptContract';

export interface ExecutedCheck {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}
export interface CandidateExecution {
  status: "passed" | "failed" | "not-applicable";
  checks: ExecutedCheck[];
  failures: string[];
  executedAt: string;
  browser?: BrowserEvidence;
  verificationNeeded?: string[];
}

const UNSAFE_TEST_SOURCE =
  /(?:\bfetch\s*\(|node:(?:child_process|cluster|dgram|http|https|net|tls|vm|worker_threads)|\b(?:exec|execFile|spawn|fork)\s*\(|\bprocess\.(?:binding|dlopen|kill)\b|\b(?:writeFile|appendFile|rm|rmdir|unlink|rename|chmod|chown|symlink)\b)/i;

function executeNode(
  cwd: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<ExecutedCheck> {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(
      process.execPath,
      ["--permission", `--allow-fs-read=${cwd}`, ...args],
      {
        cwd,
        windowsHide: true,
        shell: false,
        signal: missionSignal(),
        env: { PATH: process.env.PATH || "", NODE_ENV: process.env.NODE_ENV || "production", NODE_NO_WARNINGS: "1" },
        stdio: ["ignore", "pipe", "pipe"] as const,
      },
    );
    const capture = (current: string, chunk: Buffer) =>
      `${current}${chunk.toString("utf8")}`.slice(-32_000);
    child.stdout.on("data", (chunk) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = capture(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command: `node ${args.join(" ")}`,
        exitCode: null,
        timedOut,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - started,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        command: `node ${args.join(" ")}`,
        exitCode: code,
        timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });
}

export async function executeCandidateChecks(args: {
  missionId: string;
  candidateId: string;
  files: { path: string; content: string }[];
}): Promise<CandidateExecution> {
  const cwd = path.resolve(
    process.cwd(),
    ".devkiller",
    "missions",
    args.missionId,
    "candidates",
    args.candidateId,
  );
  const checks: ExecutedCheck[] = [];
  const failures: string[] = [];
  const scriptFailures=runtimeScriptFailures(args.files);
  failures.push(...scriptFailures);
  const supabase = args.files.some(file=>/^supabase\/migrations\/.*\.sql$/.test(file.path));
  if(supabase){
    failures.push(...localSessionContractFailures(args.missionId,args.files));
    for(const [command,run] of [
      ['isolated Supabase PostgreSQL migrations and pgTAP',()=>checkSupabaseSql(args.files,missionSignal())],
      ['isolated Next/Supabase production compilation',()=>checkSupabaseBuild(cwd,missionSignal())],
    ] as const){
      const started=Date.now();
      try{const stdout=await run();checks.push({command,exitCode:0,timedOut:false,stdout,stderr:'',durationMs:Date.now()-started});}
      catch(error){const message=error instanceof Error?error.message:'Supabase execution failed';failures.push(message);checks.push({command,exitCode:1,timedOut:false,stdout:'',stderr:message,durationMs:Date.now()-started});}
    }
    const verificationNeeded:string[]=[];
    if(!failures.length && args.missionId==='benchmark-firebase-orders-20260902'){
      const started=Date.now();
      try{
        await provisionSupabaseSchema(args.missionId,args.files);
        const report=await verifyPantryLive(args.missionId,missionSignal());
        checks.push({command:'dedicated Pantry live Auth, RLS and concurrent PostgREST requests',exitCode:0,timedOut:false,stdout:JSON.stringify(report),stderr:'',durationMs:Date.now()-started});
      }catch(error){
        missionSignal()?.throwIfAborted();
        const message=error instanceof Error?error.message:'Live verification unavailable';
        if((error as {code?:string}).code==='ERR_ASSERTION')failures.push(`Live Pantry verification: ${message}`);
        else verificationNeeded.push(`Live environment verification needs attention: ${message}`);
      }
    }
    const browser=failures.length?undefined:await operatorBrowserEvidence(args.missionId,args.files);
    if(browser)checks.push({command:'Recorded operator browser verification (exact candidate, within 24 hours)',exitCode:0,timedOut:false,stdout:JSON.stringify(browser.report),stderr:'',durationMs:0});
    return {status:failures.length?'failed':'passed',checks,failures,verificationNeeded,browser,executedAt:new Date().toISOString()};
  }
  const descriptor = args.files.find(file => file.path === 'devkiller.runtime.json');
  if(descriptor){
    // Report all cheap syntax/CSP defects together, before starting Docker or paying for diagnosis.
    for(const file of args.files.filter(file=>/\.(?:c?js|mjs)$/i.test(file.path))){
      const check=await executeNode(cwd,['--check',file.path.replaceAll('\\','/')]);checks.push(check);
      if(check.exitCode!==0)failures.push(`Syntax check failed for ${file.path}: ${check.stderr}`);
    }
    if(failures.length)return {status:'failed',checks,failures,executedAt:new Date().toISOString()};
  }
  if (descriptor) {
    try {
      const contract = runtimeSchema.parse(JSON.parse(descriptor.content));
      const started = Date.now();
      const startup = await checkRuntimeStartup(cwd, contract);
      checks.push({command:'isolated Node/SQLite real startup and seed',exitCode:0,timedOut:false,stdout:startup,stderr:'',durationMs:Date.now()-started});
      const testStarted=Date.now();
      const stdout=await testRuntime(cwd, contract);
      checks.push({command:'isolated Node/SQLite tests',exitCode:0,timedOut:false,stdout,stderr:'',durationMs:Date.now()-testStarted});
      const packageFile=args.files.find(file=>file.path==='package.json');
      if(packageFile && JSON.parse(packageFile.content).scripts?.build){
        const releaseStarted=Date.now();
        const releaseOutput=await checkLocalRelease(cwd);
        checks.push({command:'isolated local migration and release assembly',exitCode:0,timedOut:false,stdout:releaseOutput,stderr:'',durationMs:Date.now()-releaseStarted});
      }
    } catch (error) {
      const diagnostic=error as {stdout?:string;stderr?:string;killed?:boolean;code?:string|number};
      failures.push(`Isolated backend tests failed: ${error instanceof Error ? error.message : 'runtime unavailable'}\nExit: ${diagnostic.code ?? 'unavailable'}; timeout/terminated: ${Boolean(diagnostic.killed)}\nSTDOUT: ${String(diagnostic.stdout || '<empty>').slice(-6000)}\nSTDERR: ${String(diagnostic.stderr || '<empty>').slice(-6000)}`);
    }
  }
  const scripts = args.files.filter(
    (file) =>
      /\.(?:c?js|mjs)$/i.test(file.path) &&
      !/(^|[\\/])tests?[\\/]/i.test(file.path),
  );
  const tests = args.files.filter((file) =>
    /(^|[\\/])tests?[\\/].*\.test\.(?:c?js|mjs)$/i.test(file.path),
  );
  for (const file of [...scripts, ...tests]) {
    if(descriptor)continue; // Syntax already checked; executable tests ran in the isolated runtime.
    if (tests.includes(file) && descriptor) continue;
    // Syntax inspection does not run application code. Restrict capabilities
    // only for tests that would actually be executed on the host.
    if (tests.includes(file) && UNSAFE_TEST_SOURCE.test(file.content)) {
      failures.push(
        `${file.path} requests network, process, or filesystem mutation capabilities and was not executed.`,
      );
      continue;
    }
    const normalized = file.path.replaceAll("\\", "/");
    const check = await executeNode(
      cwd,
      tests.includes(file) ? [normalized] : ["--check", normalized],
    );
    checks.push(check);
    if (check.timedOut)
      failures.push(`${file.path} exceeded the 20 second execution limit.`);
    else if (check.exitCode !== 0)
      failures.push(
        `${file.path} failed with exit code ${check.exitCode}: ${(check.stderr || check.stdout).slice(-1200)}`,
      );
  }
  const browser = failures.length ? undefined : await executeBrowserChecks({files:args.files,signal:missionSignal(),outputDirectory:path.join(cwd,'..',`${args.candidateId}-browser-evidence`)});
  if(browser?.status==='failed')failures.push(...browser.failures.map(f=>`Browser: ${f}`));
  if(browser && ['passed','failed'].includes(browser.status))checks.push({command:'isolated Chromium browser checks',exitCode:browser.status==='passed'?0:1,timedOut:false,stdout:JSON.stringify(browser),stderr:'',durationMs:browser.durationMs});
  if (!checks.length && !failures.length)
    return {
      status: "not-applicable",
      checks,
      failures,
      executedAt: new Date().toISOString(),
      browser,
    };
  return {
    status: failures.length ? "failed" : "passed",
    checks,
    failures,
    executedAt: new Date().toISOString(),
    browser,
  };
}

export function formatExecutionEvidence(execution: CandidateExecution) {
  if (execution.status === "not-applicable")
    return "No safely executable JavaScript checks were present.";
  return [
    `Candidate execution status: ${execution.status}.`,
    `Executed at: ${execution.executedAt}.`,
    `Browser limitations: ${execution.browser?.limitations.join(' ') || 'Browser checks did not run.'}`,
    ...execution.checks.map(
      (check) =>
        `${check.command} => exit ${check.exitCode}${check.timedOut ? " (timed out)" : ""}\nSTDOUT: ${check.stdout || "<empty>"}\nSTDERR: ${check.stderr || "<empty>"}`,
    ),
    ...execution.failures.map((failure) => `FAILURE: ${failure}`),
  ].join("\n\n");
}
