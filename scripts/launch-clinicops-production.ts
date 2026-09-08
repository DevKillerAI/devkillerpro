import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createWorkbenchContract } from '../src/lib/server/generator/workbenchContract';
import { createPilotRun } from '../src/lib/server/generator/pilotStore';
import { PILOT_CAMPAIGN } from '../src/lib/server/generator/pilotContract';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');

const prompt = `
# MISSÃO: ClinicOps — Plataforma de Gestão de Incidentes Hospitalares e Segurança do Paciente

Projete e implemente uma aplicação completa, robusta e de altíssimo nível visual chamada ClinicOps para hospitais e clínicas gerenciarem notificações de segurança do paciente, eventos adversos e quase-falhas (near-misses).

## 1. DESIGN & IDENTIDADE VISUAL (Padrão Enterprise SaaS / Linear / Apple)
- Paleta visual: Tema Dark Slate clínico de alta precisão (canvas #0B0F17, cards de superfície #121826, bordas sutis 1px solid rgba(255,255,255,0.08), acentos em carmesim para eventos críticos #F43F5E, âmbar para moderados #F59E0B, esmeralda para controlados #10B981, e ciano cirúrgico #06B6D4).
- Tipografia: Escala com fonte Plus Jakarta Sans, pesos 600-800 em títulos com letter-spacing -0.02em, labels uppercase compactos, e números tabulares (font-variant-numeric: tabular-nums) em todos os contadores e métricas.
- Cards e Elevação: Sombras em camadas (box-shadow: 0 4px 20px -2px rgba(0,0,0,0.25)), cantos arredondados (border-radius: 14px), micro-interações suaves ao passar o mouse.
- Responsividade estrita: Layout fluido desktop (sidebar de navegação) e mobile (390px) sem nenhum overflow horizontal.

## 2. RECURSOS FUNCIONAIS & WORKFLOWS
1. Dashboard de Métricas Clínicas (KPIs):
   - Total de Notificações no Mês, Eventos Sentinela (críticos), Quase-Falhas interceptadas, e Taxa de Resolução de Causa-Raiz (com variação percentual vs mês anterior).
2. Central de Incidentes & Filtros:
   - Filtro por Setor (UTI Adulto, Centro Cirúrgico, Pronto-Socorro, Farmácia Clínica, Enfermarias).
   - Busca textual instantânea por número de protocolo ou identificador do paciente (anonimizado LGPD, ex: PAC-8921).
   - Tabela de ocorrências rica com status, prioridade com dots semânticos, medicamento/dispositivo relacionado e botão de inspecionar.
3. Modal de Registro de Evento ("Novo Incidente"):
   - Formulário completo com validação de campos obrigatórios: Setor, Tipo de Evento, Classificação de Risco, Descrição dos Fatos e Ações Imediatas.
4. Gaveta de Investigação (Slide-over Drawer):
   - Ao clicar em um incidente, abre gaveta lateral para análise detalhada: plano de ação corretivo, equipe responsável, linha do tempo dos desfechos e trilha de auditoria para conformidade e rastreabilidade hospitalar.
5. Persistência & Supabase:
   - Script SQL sob supabase/migrations/001_init.sql com tabelas \`incidents\` e \`audit_logs\`, chaves, constraints e dados semente realistas.
   - Integração com cliente Supabase com fallback seguro em localStorage.

## 3. IDENTIFICADORES DE TESTE (data-testid)
- data-testid="nav-incidents", data-testid="nav-analytics", data-testid="nav-audits"
- data-testid="search-incidents", data-testid="filter-department", data-testid="new-incident"
- data-testid="incident-row-101", data-testid="incident-drawer", data-testid="input-protocol", data-testid="btn-save-incident"
`;

async function main() {
  const ownerId = 'e5b94265-5bfe-41fb-81a9-43efad7b2a83';
  const requestId = randomUUID();

  console.log(`Launching Production-Grade ClinicOps Run (Request ID: ${requestId})`);

  const contract = createWorkbenchContract(ownerId, {
    requestId,
    title: 'ClinicOps — Gestão de Incidentes Hospitalares',
    prompt,
    briefingMode: 'detailed',
    localScopeAccepted: true,
  });

  const run = await createPilotRun(contract, PILOT_CAMPAIGN, 100_000_000);
  console.log('\n>>> RUN CREATED SUCCESSFULLY! <<<');
  console.log('Run ID:', run.runId);
  console.log('Status:', run.status);
  console.log('Mission ID:', contract.identity.missionId);

  await sql.end();
}

main().catch(err => {
  console.error('Failed to launch ClinicOps run:', err);
  process.exit(1);
});
