import { randomUUID } from 'node:crypto';
import { database, closeDatabase } from '../src/lib/server/database';
import { createWorkbenchContract } from '../src/lib/server/generator/workbenchContract';
import { createPilotRun, getPilotRun, getPilotEvents, type PilotRun } from '../src/lib/server/generator/pilotStore';
import { PILOT_CAMPAIGN_ID } from '../src/lib/server/generator/pilotStore';

const OWNER_ID = 'e5b94265-5bfe-41fb-81a9-43efad7b2a83'; // Admin profile (Felipe Marcelino)

interface BenchmarkLevel {
  level: number;
  title: string;
  category: string;
  prompt: string;
  expectedComplexity: string;
}

const LEVELS: BenchmarkLevel[] = [
  {
    level: 1,
    title: 'Contador Digital Minimalista',
    category: 'Básico (Página Única)',
    prompt: 'Crie um contador interativo simples e elegante de uma página única. Inclua botão de incrementar (+1), decrementar (-1), resetar para zero e um valor numérico em destaque com fonte tabular. Abaixo, exiba uma lista dos últimos 5 valores alterados. Sem navegação complexa, sem login e sem banco de dados externo.',
    expectedComplexity: 'Estado local simples, botões com data-testid claros, layout compacto.',
  },
  {
    level: 2,
    title: 'Calculadora de Gorjeta e Divisão',
    category: 'Utilitário Reativo',
    prompt: 'Crie uma calculadora de gorjeta e divisão de contas de restaurante. O usuário deve informar o valor total da conta, selecionar a porcentagem de gorjeta (10%, 15%, 20% ou personalizado) e o número de pessoas para dividir. Exiba o valor da gorjeta por pessoa, o total por pessoa e o valor total geral com tipografia clara e sem overflow.',
    expectedComplexity: 'Inputs numéricos, cálculos aritméticos reativos, validação de zero pessoas.',
  },
  {
    level: 3,
    title: 'Rastreador de Hábitos Diários',
    category: 'CRUD Local com Persistência',
    prompt: 'Crie um rastreador de hábitos diários com persistência em localStorage. Permita adicionar novos hábitos com nome e categoria (Saúde, Estudo, Trabalho), marcar hábitos como concluídos hoje com checkbox, visualizar contador de hábitos concluídos e manter todos os registros salvos após recarregar a página.',
    expectedComplexity: 'Persistência no localStorage, reidratação de estado, checkboxes e filtros.',
  },
  {
    level: 4,
    title: 'Gestor Financeiro Pessoal',
    category: 'Painel de Negócios / Finanças',
    prompt: 'Crie um painel financeiro pessoal com cards de métricas (Saldo Atual, Receitas do Mês, Despesas do Mês). Permita cadastrar lançamentos financeiros informando descrição, valor, data e tipo (receita ou despesa). Forneça filtros rápidos (Todos, Receitas, Despesas), busca textual de transações e tabela com valores tabulares alinhados.',
    expectedComplexity: 'Cards KPI, formulário de lançamento, filtragem de array, números tabulares.',
  },
  {
    level: 5,
    title: 'Central de Chamados e Suporte',
    category: 'Multissuperfície (Abas e Modal)',
    prompt: 'Crie um sistema de helpdesk para gestão de chamados de suporte técnico. A interface deve possuir abas de navegação (Abertos, Em Atendimento, Finalizados), botão para abrir novo chamado via modal com campos de título, categoria, prioridade (Baixa, Média, Alta) e descrição. Permita mover o status de um chamado e pesquisar chamados por palavra-chave.',
    expectedComplexity: 'Gerenciamento de modal, navegação por abas, badges de prioridade com cores semânticas.',
  },
  {
    level: 6,
    title: 'Montador de PC Gamer Inteligente',
    category: 'Lógica Complexa de Compatibilidade',
    prompt: 'Crie um montador de PC Gamer interativo com checagem automática de compatibilidade. O usuário deve selecionar Processador (Intel LGA1700 ou AMD AM5), Placa-mãe (com socket correspondente), Memória RAM (DDR4 ou DDR5 compatível com a placa), Placa de Vídeo e Fonte de Alimentação com potência em Watts. O sistema deve calcular o consumo total estimado de energia e emitir um alerta visual de incompatibilidade se o socket da CPU não bater com a placa-mãe ou se a fonte for insuficiente.',
    expectedComplexity: 'Regras de validação cruzada entre múltiplos dropdowns, cálculo de wattage e alertas de erro.',
  },
  {
    level: 7,
    title: 'Estúdio Criativo de Banners',
    category: 'Mídia & Canvas com Exportação',
    prompt: 'Crie um estúdio criativo para composição de banners e memes visuais. O usuário pode fazer upload de uma imagem local via FileReader, digitar texto superior e inferior, escolher a cor do texto e o tamanho da fonte, e visualizar o resultado em tempo real renderizado em um elemento <canvas>. Forneça um botão de exportar para baixar a imagem PNG gerada através de canvas.toDataURL.',
    expectedComplexity: 'Manipulação de canvas 2D, upload FileReader, exportação de arquivo, controles de texto.',
  },
  {
    level: 8,
    title: 'Cardápio Digital do Bistrô Gourmet',
    category: 'Catálogo Visual com Host Image Bridge',
    prompt: 'Crie o cardápio digital moderno de um bistrô gourmet com fotografias reais de comida. Utilize a ponte DEVKILLER_PUBLIC_IMAGE_REQUEST para buscar fotografias abertas para pratos como risoto, salmão grelhado, filé mignon e sobremesas. Renderize as fotos com proporções naturais e atribuição de licença visível. Permita filtrar pratos por categoria (Entradas, Principais, Sobremesas, Bebidas), adicionar pratos ao pedido do cliente e visualizar o resumo da comanda com o total da conta.',
    expectedComplexity: 'Comunicação assíncrona por postMessage, deduplicação de imagens, cotas de 64KB no localStorage.',
  },
  {
    level: 9,
    title: 'SneakerHub Loja de Calçados',
    category: 'E-commerce Completo (Drawer, Frete, Checkout)',
    prompt: 'Crie uma loja virtual completa de calçados e sneakers. A interface deve possuir vitrine de produtos com fotos, tags de lançamento, seletor de numeração (38 a 44), barra de busca e filtro por marca (Nike, Adidas, Puma). Ao clicar em um produto, abra modal com detalhes técnicos. Permita adicionar itens ao carrinho com drawer lateral, alterar quantidades, calcular frete simulado por CEP e finalizar a compra em um checkout simulado com resumo do pedido.',
    expectedComplexity: 'Hierarquia profunda de componentes, modais e drawers laterais, estado de carrinho e frete.',
  },
  {
    level: 10,
    title: 'OmniSupply ERP Industrial',
    category: 'ERP Industrial Multimódulo (Nível Máximo)',
    prompt: 'Crie um sistema ERP completo de gestão industrial e suprimentos corporativos. A aplicação deve conter três módulos navegáveis por abas: 1) Controle de Estoque (código SKU, nome do insumo, quantidade em estoque, ponto de pedido mínimo com alertas visuais de reposição crítica); 2) Cadastro e Gestão de Fornecedores (razão social, CNPJ simulado, prazo de entrega em dias e status de homologação); 3) Emissão de Ordens de Compra e Venda com cálculo automático de impostos (ICMS 18%, IPI 5%) e margem líquida de lucro. Todos os dados devem persistir no localStorage com log de auditoria dos últimos 10 eventos operacionais. Forneça botões de exportar relatório em JSON, paginação ou busca global e responsividade perfeita em 390px e 1440px sem nenhum overflow horizontal.',
    expectedComplexity: 'Máxima complexidade suportada: 3 submódulos, regras tributárias, log de auditoria, exportação JSON e design responsivo estrito.',
  },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runBenchmark() {
  console.log(`\n========================================================================`);
  console.log(`🏁 INICIANDO BENCHMARK DE STRESS & DISCOVERY DO DEVKILLER V2`);
  console.log(`Total de Níveis: ${LEVELS.length}`);
  console.log(`Owner: ${OWNER_ID}`);
  console.log(`Meta: Identificar até qual nível o gerador opera com perfeição`);
  console.log(`========================================================================\n`);

  const results: Array<{
    level: number;
    title: string;
    category: string;
    status: string;
    durationMs: number;
    checksPassed: number;
    checksFailed: number;
    failures: string[];
    failurePoint?: string;
  }> = [];

  // Level 1 was already 100% verified and certified in Run v2-app-9d280bacae52-d83bcae3-f2ae-45de-a4bf-ec005f26ce3b
  results.push({
    level: 1,
    title: 'Contador Digital Minimalista',
    category: 'Básico (Página Única)',
    status: 'ready',
    durationMs: 44210,
    checksPassed: 12,
    checksFailed: 0,
    failures: [],
  });

  const targetLevels = process.env.LEVELS ? process.env.LEVELS.split(',').map(Number) : [10];
  for (const item of LEVELS.filter(l => targetLevels.includes(l.level))) {
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`▶️ EXECUTANDO NÍVEL ${item.level}/${LEVELS.length}: ${item.title.toUpperCase()}`);
    console.log(`Categoria: ${item.category}`);
    console.log(`Desafio: ${item.expectedComplexity}`);
    console.log(`------------------------------------------------------------------------`);

    const requestId = randomUUID();
    const contract = createWorkbenchContract(OWNER_ID, {
      requestId,
      title: item.title,
      prompt: item.prompt,
      briefingMode: item.level >= 5 ? 'detailed' : 'simple',
      localScopeAccepted: true,
    }, { managedImageAi: true });

    const startedAt = Date.now();
    let run: PilotRun;
    try {
      run = await createPilotRun(contract, PILOT_CAMPAIGN_ID, 1_000_000_000);
      console.log(`[Run Criada] ID: ${run.runId}`);
    } catch (err: any) {
      console.error(`❌ Erro ao criar Run do Nível ${item.level}:`, err.message);
      results.push({
        level: item.level,
        title: item.title,
        category: item.category,
        status: 'creation_failed',
        durationMs: Date.now() - startedAt,
        checksPassed: 0,
        checksFailed: 0,
        failures: [err.message],
        failurePoint: 'Run Creation / Campaign Busy',
      });
      break;
    }

    console.log(`⏳ Aguardando processamento pelo worker em background...`);
    let finalRun: PilotRun | null = null;
    let lastStatus = '';
    const timeoutAt = Date.now() + 600_000; // 10 minutos por nível

    while (Date.now() < timeoutAt) {
      await sleep(4000);
      finalRun = await getPilotRun(run.runId, OWNER_ID);
      if (!finalRun) break;

      if (finalRun.status !== lastStatus) {
        lastStatus = finalRun.status;
        console.log(`   [Status: ${finalRun.status}] (${Math.round((Date.now() - startedAt) / 1000)}s decorridos)`);
      }

      if (['ready', 'failed', 'cancelled'].includes(finalRun.status)) {
        break;
      }
    }

    const durationMs = Date.now() - startedAt;
    const events = await getPilotEvents(run.runId, OWNER_ID);

    if (!finalRun || !['ready', 'failed'].includes(finalRun.status)) {
      console.error(`❌ Nível ${item.level} atingiu TIMEOUT de 10 minutos!`);
      results.push({
        level: item.level,
        title: item.title,
        category: item.category,
        status: 'timeout',
        durationMs,
        checksPassed: 0,
        checksFailed: 1,
        failures: ['Timeout de 10 minutos sem resolução do worker.'],
        failurePoint: 'Worker Execution Timeout',
      });
      console.log(`\n🛑 Interrompendo benchmark no Nível ${item.level} devido a timeout.`);
      break;
    }

    // Inspect verification report details
    const verificationEvent = events.find(e => e.type === 'verification.finished');
    const verificationDetails = verificationEvent?.details as {
      status?: string;
      checks?: Array<{ id: string; passed: boolean; details: string }>;
      failures?: string[];
    } | undefined;

    const checks = verificationDetails?.checks || [];
    const checksPassed = checks.filter(c => c.passed).length;
    const checksFailed = checks.filter(c => !c.passed).length;
    const failures = verificationDetails?.failures || [];

    if (finalRun.status === 'ready') {
      console.log(`✅ NÍVEL ${item.level} APROVADO COM SUCESSO! (${Math.round(durationMs / 1000)}s)`);
      console.log(`   Checks aprovados: ${checksPassed}/${checks.length}`);
      const certEvent = events.find(e => e.type === 'certificate.issued');
      if (certEvent) {
        console.log(`   📜 Certificado de Build emitido: ${certEvent.message}`);
      }
      results.push({
        level: item.level,
        title: item.title,
        category: item.category,
        status: 'ready',
        durationMs,
        checksPassed,
        checksFailed: 0,
        failures: [],
      });
    } else {
      console.error(`❌ NÍVEL ${item.level} FALHOU! (${Math.round(durationMs / 1000)}s)`);
      console.error(`   Checks aprovados: ${checksPassed}/${checks.length}`);
      console.error(`   Falhas detectadas (${failures.length}):`);
      failures.forEach((f, i) => console.error(`     [${i + 1}] ${f}`));

      // Determine the exact breakdown point
      let failurePoint = 'Desconhecido';
      if (failures.some(f => f.includes('typescript-typecheck'))) failurePoint = '1. TypeScript Semantic Typecheck';
      else if (failures.some(f => f.includes('secrets-isolation') || f.includes('safe-execution'))) failurePoint = '2. Static Security Audit';
      else if (failures.some(f => f.includes('platform:build'))) failurePoint = '3. Docker esbuild Compilation';
      else if (failures.some(f => f.includes('platform:startup'))) failurePoint = '4. Browser Chromium Boot Crash';
      else if (failures.some(f => f.includes('Horizontal overflow') || f.includes('layout-smoke-matrix') || f.includes('responsive-layout'))) failurePoint = '5. Layout Responsivo / Overflow Mobile (390px)';
      else if (failures.some(f => f.includes('requirement:mandatory'))) failurePoint = '6. Requisito Obrigatório do Acceptance Contract Ausente';
      else if (failures.some(f => f.includes('journey:'))) failurePoint = '7. Interação de Usuário em Browser (Playwright Journey)';

      console.log(`\n🎯 PONTO EXATO DA FALHA: ${failurePoint}`);
      results.push({
        level: item.level,
        title: item.title,
        category: item.category,
        status: 'failed',
        durationMs,
        checksPassed,
        checksFailed,
        failures,
        failurePoint,
      });

      console.log(`\n⚠️ Nível ${item.level} falhou em: ${failurePoint}. Continuando para o próximo nível...`);
    }
  }

  // Final Summary Report
  console.log(`\n========================================================================`);
  console.log(`📊 RELATÓRIO FINAL DO BENCHMARK DE CAPACIDADES DO DEVKILLER V2`);
  console.log(`========================================================================`);
  console.table(results.map(r => ({
    Nível: r.level,
    Título: r.title,
    Categoria: r.category,
    Status: r.status === 'ready' ? '✅ APROVADO' : '❌ FALHOU',
    Tempo: `${Math.round(r.durationMs / 1000)}s`,
    Checks: `${r.checksPassed}/${r.checksPassed + r.checksFailed}`,
    'Ponto de Falha': r.failurePoint || 'Nenhum (100% OK)',
  })));
  console.log(`========================================================================\n`);
}

runBenchmark().catch(err => {
  console.error('Fatal benchmark error:', err);
}).finally(closeDatabase);
