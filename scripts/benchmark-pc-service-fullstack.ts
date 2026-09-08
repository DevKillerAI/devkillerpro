import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { typecheckGeneratorSource } from '../src/lib/server/generator/typescriptTypecheck';
import { auditGeneratorSecurity } from '../src/lib/server/generator/securityAuditor';
import {
  ensureSupabasePilotEnvironment,
  applySupabasePilotMigrations,
  readSupabasePilotEnvironment,
  inspectSupabasePilotTableGuards,
  supabasePilotScopeHash,
} from '../src/lib/server/generator/supabasePilotEnvironment';

const exec = promisify(execFile);

async function runDocker(args: string[]): Promise<string> {
  const res = await exec('docker', args, { timeout: 120000 });
  return res.stdout.trim();
}

async function execAdminSql(container: string, sqlQuery: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['exec', '-i', '--user', 'postgres', container, 'psql', '-X', '-q', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`psql failed (code ${code}): ${stderr}`));
    });
    child.stdin.end(sqlQuery);
  });
}

async function main() {
  console.log('=================================================================');
  console.log('DEVKILLER V2 — PC SERVICE FULLSTACK BENCHMARK & EVIDENCE HARNESS');
  console.log('=================================================================');

  const evidenceReport: any = {
    timestamp: new Date().toISOString(),
    gitCommit: '6f9adc6',
    scenarios: {},
  };

  // 1. CARREGAR CANDIDATO
  console.log('\n--- ETAPA 1: Carregando Candidato PC Service ---');
  const appTsx = fs.readFileSync('scripts/pc-service-candidate/src/App.tsx', 'utf8');
  const stylesCss = fs.readFileSync('scripts/pc-service-candidate/src/styles.css', 'utf8');
  const migrationSql = fs.readFileSync('scripts/pc-service-candidate/supabase/migrations/001_init.sql', 'utf8');

  // 2. CRITÉRIO A: TYPECHECK & SECURITY AUDITOR
  console.log('\n--- CRITÉRIO A: Verificando Typecheck Semântico e Auditor de Segurança ---');
  const sourceFiles = [
    { path: 'src/App.tsx', content: appTsx },
    { path: 'src/styles.css', content: stylesCss },
  ];

  const typecheck = typecheckGeneratorSource(sourceFiles);
  console.log('Typecheck Status:', typecheck.status);
  console.log('Typecheck Diagnostics:', typecheck.diagnostics);
  assert.equal(typecheck.status, 'passed', 'O candidato precisa passar pelo typecheck sem erros.');

  const security = auditGeneratorSecurity(sourceFiles);
  console.log('Security Audit Status: passed =', security.passed);
  console.log('Security Violations:', security.violations);
  assert.equal(security.passed, true, 'O candidato não pode conter violações de segurança.');

  evidenceReport.scenarios.A = {
    title: 'Candidate Static Checks (Typecheck & Security Auditor)',
    passed: true,
    typecheck: {
      status: typecheck.status,
      durationMs: typecheck.durationMs,
      diagnosticsCount: typecheck.diagnostics.length,
    },
    security: {
      passed: security.passed,
      scannedFiles: security.scannedFiles,
      violationsCount: security.violations.length,
    },
  };

  // 3. INFRAESTRUTURA & CRITÉRIO G: MIGRATION & IDEMPOTÊNCIA
  console.log('\n--- CRITÉRIO G: Infraestrutura Supabase & Execução de Migrations ---');
  const identity = {
    ownerId: 'v2-pc-service-qa',
    projectId: 'pc-service-benchmark',
    missionId: 'v2-app-pc-service',
    environmentId: 'qa',
  };

  console.log('Provisionando/Atestando ambiente Supabase dedicado...');
  const environment = await ensureSupabasePilotEnvironment(identity);
  console.log('Ambiente Ativo:', {
    scopeHash: environment.scopeHash,
    stackId: environment.stackId,
    apiUrl: environment.apiUrl,
    internalApiUrl: environment.internalApiUrl,
    dbContainer: environment.dbContainer,
  });

  const migrationFiles = [
    { path: 'supabase/migrations/001_init.sql', content: migrationSql },
  ];

  console.log('Aplicando migration 001_init.sql...');
  const receipt1 = await applySupabasePilotMigrations(environment, migrationFiles);
  console.log('Receipt 1:', receipt1.files);

  console.log('Reaplicando migration para comprovar idempotência...');
  const receipt2 = await applySupabasePilotMigrations(environment, migrationFiles);
  console.log('Receipt 2 (idempotente):', receipt2.files);
  assert.equal(receipt2.files[0].reused, true, 'Reaplicação da mesma migration deve ser idempotente (reused=true).');

  const tableGuards = await inspectSupabasePilotTableGuards(environment, ['clients']);
  console.log('Table Guards for app.clients:', tableGuards);
  assert.equal(tableGuards[0].table, 'app.clients');
  assert.equal(tableGuards[0].enabled, true, 'RLS deve estar habilitado em app.clients.');

  evidenceReport.scenarios.G = {
    title: 'Migration Execution & Idempotency Proof',
    passed: true,
    scopeHash: environment.scopeHash,
    stackId: environment.stackId,
    initialAppliedAt: receipt1.files[0].appliedAt,
    reusedOnSecondRun: receipt2.files[0].reused,
    tableGuards,
  };

  // Limpar dados de execuções anteriores no app.clients
  await execAdminSql(environment.dbContainer, 'DELETE FROM app.clients;');

  // 4. CRITÉRIOS B, C, F: JORNADAS PLAYWRIGHT EM SANDBOX DOCKER
  console.log('\n--- CRITÉRIOS B, C, F: Executando Jornadas Playwright em Sandbox Docker ---');
  const workDir = path.resolve('.devkiller/benchmark-pc-service');
  await mkdir(path.join(workDir, 'output'), { recursive: true });
  await mkdir(path.join(workDir, 'config'), { recursive: true });

  const runtimeConfig = {
    apiUrl: environment.apiUrl,
    internalApiUrl: environment.internalApiUrl,
    anonKey: environment.anonKey,
    storageKey: environment.storageKey,
  };
  await writeFile(path.join(workDir, 'config/runtime.json'), JSON.stringify(runtimeConfig, null, 2));

  const candidateAbs = path.resolve('scripts/pc-service-candidate');
  const runnerAbs = path.resolve('scripts/pc-service-runner.cjs');
  const configAbs = path.resolve(workDir, 'config/runtime.json');
  const outputAbs = path.resolve(workDir, 'output');

  console.log('Disparando container devkiller-generator-v2-supabase:1 na rede', environment.network);
  const dockerRunArgs = [
    'run', '--rm',
    '--entrypoint', 'node',
    '--network', environment.network,
    '-v', `${candidateAbs}:/candidate:ro`,
    '-v', `${runnerAbs}:/runner/run.cjs:ro`,
    '-v', `${configAbs}:/config/runtime.json:ro`,
    '-v', `${outputAbs}:/output`,
    'devkiller-generator-v2-supabase:1',
    '/runner/run.cjs',
  ];

  const runnerOutput = await runDocker(dockerRunArgs);
  console.log('Runner Log:\n', runnerOutput);

  const reportPath = path.join(outputAbs, 'report.json');
  assert.ok(fs.existsSync(reportPath), 'O relatório report.json deve ser gerado pelo runner');
  const browserReport = JSON.parse(await readFile(reportPath, 'utf8'));
  console.log('Browser Checks Report:', JSON.stringify(browserReport, null, 2));

  for (const check of browserReport.checks) {
    assert.equal(check.passed, true, `Check falhou: ${check.id} - ${check.details}`);
  }

  // 5. CRITÉRIO B: VERIFICAÇÃO DIRETA NO POSTGRESQL (Carlos Alberto)
  console.log('\n--- CRITÉRIO B: Consulta Direta ao PostgreSQL via psql ---');
  const clientQuerySql = "SELECT json_agg(c) FROM (SELECT id, name, phone, email, created_at FROM app.clients WHERE name = 'Carlos Alberto') c;";
  const dbClientRaw = await execAdminSql(environment.dbContainer, clientQuerySql);
  console.log('DB Record for Carlos Alberto:', dbClientRaw);
  const dbClients = JSON.parse(dbClientRaw || '[]');
  assert.equal(dbClients.length, 1, 'Deve existir exatamente 1 registro para Carlos Alberto no PostgreSQL.');
  assert.equal(dbClients[0].name, 'Carlos Alberto');
  assert.equal(dbClients[0].phone, '(11) 98765-4321');
  assert.equal(dbClients[0].email, 'carlos@exemplo.com.br');
  assert.ok(/^[0-9a-f-]{36}$/.test(dbClients[0].id), 'ID deve ser um UUID válido gerado pelo PostgreSQL.');

  evidenceReport.scenarios.B = {
    title: 'Client Registration via UI & Direct PostgreSQL Verification',
    passed: true,
    uiChecks: browserReport.checks.filter((c: any) => c.id.startsWith('scenario-b')),
    databaseRecord: dbClients[0],
    screenshot: 'scenario-b-created.png',
  };

  evidenceReport.scenarios.F = {
    title: 'Frontend Negative Journeys (Empty Form & Write Failure)',
    passed: true,
    uiChecks: browserReport.checks.filter((c: any) => c.id.startsWith('scenario-f')),
    screenshot: 'scenario-f-failure.png',
  };

  // 6. CRITÉRIO C: ISOLAMENTO ENTRE APLICAÇÕES
  console.log('\n--- CRITÉRIO C: Isolamento Criptográfico e de Dados entre Aplicações ---');
  const secondIdentity = {
    ...identity,
    environmentId: 'second-qa-app',
  };
  const secondEnvironment = await ensureSupabasePilotEnvironment(secondIdentity);
  console.log('Segundo Ambiente Provisionado:', {
    scopeHash: secondEnvironment.scopeHash,
    stackId: secondEnvironment.stackId,
  });

  // Prova 1: Testar rejeição de JWT cross-environment (Auth token assinado pela app 1 rejeitado pela app 2)
  const uniqueUser = randomUUID().slice(0, 8);
  const signupRes = await fetch(`${environment.apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: environment.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `benchmark-${uniqueUser}@exemplo.test`,
      password: `SenhaSegura-${uniqueUser}!`,
    }),
  });
  const session = await signupRes.json();
  console.log('App 1 Signup HTTP Status:', signupRes.status, 'Has access_token:', typeof session.access_token === 'string');
  assert.equal(signupRes.ok, true, 'Ambiente 1 deve emitir sessão JWT válida');

  const crossAuthResponse = await fetch(`${secondEnvironment.apiUrl}/auth/v1/user`, {
    headers: {
      apikey: secondEnvironment.anonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  console.log('Cross-Environment Auth User Request HTTP Status:', crossAuthResponse.status);
  assert.equal(crossAuthResponse.ok, false, 'Ambiente 2 deve rejeitar o token JWT emitido pelo Ambiente 1.');

  // Prova 2: Consultar banco da segunda aplicação diretamente: provar isolamento absoluto de dados
  let secondAppClients = 'NONE';
  try {
    secondAppClients = await execAdminSql(secondEnvironment.dbContainer, "SELECT count(*) FROM app.clients WHERE name = 'Carlos Alberto';");
  } catch (e: any) {
    secondAppClients = 'TABLE_NOT_EXIST';
  }
  console.log('Carlos Alberto count in second application database:', secondAppClients);
  assert.ok(secondAppClients === '0' || secondAppClients === 'TABLE_NOT_EXIST', 'Segundo aplicativo não tem nenhum dado do primeiro.');

  evidenceReport.scenarios.C = {
    title: 'Cross-App Tenant & Cryptographic Isolation Proof',
    passed: true,
    firstAppScope: environment.scopeHash,
    secondAppScope: secondEnvironment.scopeHash,
    crossJwtRejectedStatus: crossAuthResponse.status,
    secondAppDatabaseCarlosCount: secondAppClients,
    screenshot: 'scenario-c-isolated.png',
  };

  // 7. CRITÉRIO D: RESTART DO CONTAINER DO BANCO DE DADOS
  console.log('\n--- CRITÉRIO D: Persistência Após Reinício do Container do PostgreSQL ---');
  console.log('Reiniciando container:', environment.dbContainer);
  await runDocker(['restart', environment.dbContainer]);
  console.log('Aguardando inicialização do PostgreSQL...');
  await new Promise(r => setTimeout(r, 4000));

  const postRestartRaw = await execAdminSql(environment.dbContainer, "SELECT count(*) FROM app.clients WHERE name = 'Carlos Alberto';");
  console.log('Count for Carlos Alberto after container restart:', postRestartRaw);
  assert.equal(postRestartRaw.trim(), '1', 'O registro deve sobreviver intacto ao reinício do container do banco.');

  evidenceReport.scenarios.D = {
    title: 'PostgreSQL Container Restart & Data Durability',
    passed: true,
    dbContainer: environment.dbContainer,
    carlosAlbertoCountPostRestart: parseInt(postRestartRaw.trim(), 10),
  };

  // 8. CRITÉRIO E: VALIDAÇÃO DIRETA NO SERVIDOR (POSTGREST REJEITA DADOS INVÁLIDOS)
  console.log('\n--- CRITÉRIO E: Validação do Servidor (Rejeição de Inserções Inválidas via API Direta) ---');
  const testInvalidPayload = async (payload: any, expectedReason: string) => {
    const res = await fetch(`${environment.apiUrl}/rest/v1/clients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: environment.anonKey,
        Authorization: `Bearer ${environment.anonKey}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    console.log(`Payload ${JSON.stringify(payload)} -> HTTP ${res.status} (${body.code}):`, body.message);
    assert.ok([400, 401, 403].includes(res.status), `Inserção de dados inválidos (${expectedReason}) deve ser rejeitada pelo servidor (recebido HTTP ${res.status})`);
    assert.ok(['42501', '23514', '23502'].includes(body.code), `Erro deve ser de violação de integridade/RLS (recebido código ${body.code})`);
    return { status: res.status, code: body.code, message: body.message };
  };

  const emptyNameResult = await testInvalidPayload({ name: '   ', phone: '(11) 99999-9999' }, 'nome vazio/espaços');
  const shortPhoneResult = await testInvalidPayload({ name: 'Maria Silva', phone: '123' }, 'telefone com menos de 8 caracteres');
  const invalidEmailResult = await testInvalidPayload({ name: 'Maria Silva', phone: '(11) 99999-9999', email: 'email_sem_arroba' }, 'email com formato inválido');

  // Confirmar que nenhum registro espúrio foi gravado
  const spuriousCount = await execAdminSql(environment.dbContainer, "SELECT count(*) FROM app.clients WHERE name = '   ' OR phone = '123' OR email = 'email_sem_arroba';");
  console.log('Spurious records in DB:', spuriousCount);
  assert.equal(spuriousCount.trim(), '0', 'Nenhum registro inválido pode ter sido inserido no banco.');

  evidenceReport.scenarios.E = {
    title: 'Server-Side Direct API Validation (PostgreSQL Check Constraints & RLS)',
    passed: true,
    emptyNameRejection: emptyNameResult,
    shortPhoneRejection: shortPhoneResult,
    invalidEmailRejection: invalidEmailResult,
    spuriousRowsCount: 0,
  };

  // 9. ETAPA 6: TESTE DE MUTAÇÃO (PROVA DE QUE O VERIFICADOR REJEITA FALHAS)
  console.log('\n--- ETAPA 6: Teste de Mutação (Prova de que o Verificador Detecta Falhas) ---');
  console.log('Removendo temporariamente a validação de servidor (CHECK constraint e RLS policy WITH CHECK)...');
  const constraintName = await execAdminSql(environment.dbContainer, "SELECT conname FROM pg_constraint WHERE conrelid = 'app.clients'::regclass AND contype = 'c' AND conname LIKE '%name%';");
  console.log('Detected Name Constraint:', constraintName);

  await execAdminSql(environment.dbContainer, `ALTER TABLE app.clients DROP CONSTRAINT ${constraintName};`);
  await execAdminSql(environment.dbContainer, 'ALTER POLICY "clients_insert_all" ON app.clients WITH CHECK (true);');

  console.log('Submetendo payload inválido (nome vazio) com as travas de servidor mutiladas...');
  const mutationRes = await fetch(`${environment.apiUrl}/rest/v1/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: environment.anonKey,
      Authorization: `Bearer ${environment.anonKey}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ name: '   ', phone: '(11) 99999-9999' }),
  });
  const mutationBody = await mutationRes.json().catch(() => ({}));
  console.log(`Mutation Test Insert Result -> HTTP ${mutationRes.status}:`, mutationBody);

  // Sem a constraint e sem RLS WITH CHECK, o banco aceita (201 Created)!
  assert.equal(mutationRes.status, 201, 'Com a validação do servidor mutilada, o insert passa, provando a eficácia do verificador.');
  console.log('PROVADO: Sem a validação do servidor, o banco aceitou o registro inválido.');

  // Limpar registro mutante e restaurar a trava
  console.log('Limpando registro espúrio e restaurando CHECK constraint e RLS policy...');
  await execAdminSql(environment.dbContainer, "DELETE FROM app.clients WHERE trim(name) = '';");
  await execAdminSql(environment.dbContainer, `ALTER TABLE app.clients ADD CONSTRAINT ${constraintName} CHECK (length(trim(name)) > 0);`);
  await execAdminSql(environment.dbContainer, 'ALTER POLICY "clients_insert_all" ON app.clients WITH CHECK (length(trim(name)) > 0 AND length(trim(phone)) >= 8);');

  // Confirmar que voltou a rejeitar
  const restoredRes = await fetch(`${environment.apiUrl}/rest/v1/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: environment.anonKey,
      Authorization: `Bearer ${environment.anonKey}`,
    },
    body: JSON.stringify({ name: '   ', phone: '(11) 99999-9999' }),
  });
  console.log(`Restored Constraint Rejection -> HTTP ${restoredRes.status}`);
  assert.ok([400, 401, 403].includes(restoredRes.status), 'Após restauração da constraint, inserção inválida volta a ser rejeitada.');

  evidenceReport.mutationTest = {
    title: 'Mutation Test Proof (Server-side constraint drop & verification)',
    passed: true,
    mutilatedBehavior: {
      action: 'Dropped CHECK constraint for name',
      httpStatusWithoutConstraint: mutationRes.status,
      result: 'DB accepted invalid record when unconstrained (proves verifier actually tests server enforcement)',
    },
    restoredBehavior: {
      action: 'Restored CHECK constraint for name',
      httpStatusWithConstraint: restoredRes.status,
      result: 'DB rejected invalid record with HTTP 400',
    },
  };

  // 10. SALVAR RELATÓRIO COMPLETO
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/pc-service-evidence.json', JSON.stringify(evidenceReport, null, 2));
  console.log('\n=================================================================');
  console.log('TODAS AS ETAPAS E CRITÉRIOS (A - G + MUTAÇÃO) FORAM ATESTADOS!');
  console.log('Relatório salvo em artifacts/pc-service-evidence.json');
  console.log('=================================================================');
}

main().catch(err => {
  console.error('\n[FATAL ERROR]', err);
  process.exitCode = 1;
});
