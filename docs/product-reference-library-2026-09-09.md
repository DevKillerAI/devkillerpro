# Biblioteca de produto e referências visuais — DK Create

Atualização: 9 de setembro de 2026. Versão da base: `2026-09-09.1`.

## O que esta base resolve

Um aplicativo útil precisa fechar um ciclo: receber informações, relacioná-las, permitir uma ação e mostrar um resultado que continue disponível depois. Uma página inicial e alguns formulários isolados não bastam.

A biblioteca reúne **12 famílias**, **60 variações de nicho**, **48 fluxos candidatos**, **seis padrões reutilizáveis** e **12 referências visuais inspecionadas**. É uma seleção de ampla utilidade, não um ranking de popularidade medido. Os recursos recomendados são uma síntese de produto, não uma promessa de reproduzir todos os recursos dos produtos pesquisados.

Usar conhecimento de domínio e informações extraídas de imagens é compatível com RAG. A [documentação da Microsoft sobre RAG multimodal](https://learn.microsoft.com/en-us/azure/search/multimodal-search-overview) descreve tanto a representação textual de imagens quanto abordagens com embeddings multimodais. Isso não torna a qualidade automática: seleção, coerência dos fluxos e revisão do resultado continuam necessárias.

## As 12 famílias

| Família | Núcleo funcional de uma primeira versão útil | Nichos atendidos | Referência |
|---|---|---|---|
| Tarefas e produtividade | Captura rápida, projetos, datas e prioridades, subtarefas, busca, filtros, conclusão/reabertura e histórico persistente | Pessoal/doméstico, estudos, freelancers, software, hábitos | [Todoist](https://www.todoist.com/features), [dependências no Notion](https://www.notion.com/help/tasks-and-dependencies) |
| CRM e clientes | Cadastro e detalhe do cliente, oportunidades relacionadas, funil, notas, próxima ação, filtros e totais reais | Agências, consultorias, imobiliárias, serviços, vendas B2B | [HubSpot](https://www.hubspot.com/products/sales/deal-pipeline) |
| ERP e gestão empresarial | Cadastros relacionados, orçamento/pedido com itens e totais, confirmação/cancelamento, movimentação de estoque e registro financeiro quando suportados | Comércio, distribuição, serviços, oficinas, produção sob encomenda | [Odoo](https://www.odoo.com/documentation/19.0/applications.html) |
| Finanças e orçamento | Contas, receitas/despesas, categorias, orçamento mensal, transferências sem dupla contagem, extrato e correção de lançamentos | Pessoal, família, freelancer, pequenos negócios, metas de economia | [Actual Budget](https://actualbudget.org/docs/tour/budget/) |
| Loja e pedidos | Catálogo, detalhe e variantes, carrinho, totais, criação e acompanhamento de pedido, gestão de produtos e cancelamentos | Moda, artesanato, digitais, alimentos, B2B | [Shopify: pedidos](https://help.shopify.com/en/manual/fulfillment/managing-orders) |
| Agenda e reservas | Serviços e duração, disponibilidade, escolha de horário, confirmação, lista/calendário, reagendamento e cancelamento | Salões, consultorias, aulas, salas/equipamentos, clínicas | [Calendly](https://calendly.com/scheduling) |
| Alimentação e diário nutricional | Alimentos com unidades e fonte, porções por refeição, diário por data, edição, totais e receitas reutilizáveis | Diário alimentar, planejamento de refeições, receitas, hábitos, acompanhamento profissional | [Cronometer](https://cronometer.com/features/) |
| Treinos | Rotinas, exercícios e séries, sessão ativa, registro de carga/repetições, conclusão, histórico e comparação com sessão anterior | Musculação, casa, personal, mobilidade, condicionamento | [Hevy](https://www.hevyapp.com/features/track-workouts/) |
| Cursos e aprendizagem | Curso/seções/aulas, leitura e navegação, progresso salvo, continuar de onde parou, questionário e resultado verificável | Cursos livres, treinamento interno, idiomas, provas, estudo individual | [Moodle](https://docs.moodle.org/500/en/Features), [Odoo eLearning](https://www.odoo.com/documentation/19.0/applications/websites/elearning.html) |
| Atendimento e chamados | Fila pesquisável, solicitante, prioridade, detalhe, histórico, notas, resolução e reabertura | Software, TI interno, pós-venda, manutenção, solicitações administrativas | [Zendesk](https://www.zendesk.com/service/ticketing-system/) |
| Conhecimento e conteúdo | Coleções, páginas editáveis, busca, etiquetas, leitura, estado de salvamento, organização e arquivo recuperável | Wiki pessoal, documentação, procedimentos, pesquisa, conteúdo editorial | [Notion](https://www.notion.com/help/wikis-and-verified-pages) |
| Estoque e logística | Produtos/SKU/unidade, entradas e saídas justificadas, saldo derivado, histórico, contagem física e reposição | Varejo, oficina, materiais escolares, restaurante, almoxarifado | [Zoho Inventory](https://www.zoho.com/us/inventory/features/), [Odoo: contagem](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html) |

O núcleo acima é uma **proposta ajustável**. Se o usuário pedir apenas uma lista com título e conclusão, não acrescentamos um gerenciador de projetos inteiro. Se pedir um app de tarefas sem detalhar mais, a base ajuda a propor algo utilizável e conectado.

## Exemplos de profundidade que fazem diferença

**To-do:** criar “Preparar proposta”, colocar no projeto do cliente, definir prazo, adicionar subtarefas, encontrar em “Hoje”, concluir e recuperar no histórico. Editar o prazo precisa atualizar as visualizações. Recorrência, colaboração e notificações são evoluções opcionais.

**ERP:** cadastrar cliente e produtos, montar um pedido e acompanhar suas consequências nos registros relacionados. Uma coleção de páginas “Clientes”, “Pedidos” e “Estoque” sem ligação não fecha esse ciclo. Impostos, emissão fiscal, folha de pagamento e conciliação bancária precisam de integrações próprias. Não devem aparecer como botões que fingem funcionar.

**Dieta:** registrar porções com unidades e origem dos valores, organizar refeições por dia, corrigir um lançamento e recalcular os totais. Receitas precisam calcular porções de forma consistente. A base não prescreve dietas nem inventa valores nutricionais ou metas médicas.

## Seis padrões coringa

1. **Lista e detalhe:** clientes, ativos, processos, documentos e cadastros. Busca/filtro, registro selecionado, edição contextual e resultado salvo.
2. **Fluxo por estados:** tarefas, vendas, pedidos e chamados. Estados permitidos, transições compreensíveis, histórico e próxima ação.
3. **Diário por data:** alimentação, treino, despesas e hábitos. Data, registro com unidade, edição e totais coerentes.
4. **Disponibilidade e confirmação:** agenda, salas, equipamentos e reservas. Restrições, opções válidas, resumo e alteração/cancelamento.
5. **Índice e conteúdo:** cursos, wikis, catálogos e portfólios. Encontrar, consumir e editar têm superfícies adequadas.
6. **Visão operacional:** indicadores derivados de registros reais, com caminho até os dados e uma ação útil. Sem métricas decorativas inventadas.

Login, estados de carregamento/erro/vazio, validação, persistência e navegação são capacidades transversais. Entram quando o prompt e o ambiente pedem; não transformam todo app em SaaS com cobrança.

## Curadoria visual

Foram baixadas e inspecionadas imagens de páginas oficiais de Todoist, HubSpot, Odoo, Actual Budget, Shopify, Calendly, Cronometer, Hevy, Zendesk e Notion. A ficha de cada referência registra página de origem, URL da imagem, data de revisão, hash do exemplar local e observações sobre a composição.

Algumas referências são recortes de uma função ou ilustrações promocionais. Isso está identificado nas observações: por exemplo, o recorte de disponibilidade do Calendly serve para estudar controles de horário, não para copiar um cartão com gradiente. As telas de Odoo consultadas para cursos e estoque complementam a pesquisa funcional de Moodle e Zoho.

O gerador recebe **descrições das imagens revisadas**, selecionadas pela família do app. **Não recebe os pixels das imagens nesta versão**, nem executa uma pesquisa no Google a cada geração. Os arquivos visuais ficam no acervo local de pesquisa, fora dos assets públicos dos apps e fora do commit. O código mantém a proveniência e as observações. Isso evita acrescentar dependência de download de terceiros ou uma nova chamada de IA ao caminho de entrega.

Uma evolução possível é comparar automaticamente o preview com uma referência selecionada usando visão. Isso deve ser uma melhoria consultiva, com orçamento próprio e fallback; nunca uma nova barreira cosmética para liberar o app.

## Integração implementada

- `productBlueprints.ts`: taxonomia, entidades, fluxos, variações de nicho, limites e seleção por evidências explícitas em português/inglês.
- `productVisualReferences.ts`: as 12 referências revisadas, suas fontes e a análise visual correspondente.
- `workbenchQuality.ts`: injeta a família selecionada e suas referências no plano já enviado ao modelo para geração e edição. Termos genéricos como “SaaS”, “dashboard” ou “menu” não bastam para escolher um nicho.
- `workbenchInstructions.ts`: estabelece que o prompt e as capacidades executáveis prevalecem; recursos avançados não viram exigências automáticas. Edições não expandem silenciosamente o app.
- `productBlueprintKnowledge.ts` e `seed.ts`: 13 documentos preparados para importação na base RAG, preservando fonte e versão.
- `workbenchGrounding.ts`: usa a família selecionada para contextualizar a busca existente.

A seleção da ficha é determinística e não depende de acertar a busca lexical. O plano de qualidade registrado na execução conserva a ficha e as referências enviadas. A recuperação do restante do RAG continua com a implementação existente; esta mudança não a converte silenciosamente em busca semântica.

## Limites de entrega e operação

O ambiente fullstack atual atende React com Supabase, autenticação por e-mail/senha e registros privados por proprietário. Compartilhamento público, equipes/permissões, pagamentos, uploads, jobs e transações empresariais complexas precisam das capacidades correspondentes. Um blueprint não cria essas capacidades por si só.

Nada nesta mudança altera os testes de aceitação ou adiciona uma nota mínima de design. A prioridade continua sendo entregar o preview utilizável; diferenças cosméticas permanecem consultivas. Autenticação quebrada, acesso indevido, perda de dados e falha do fluxo principal são problemas graves.

Validação local: 27 testes passaram, incluindo seleção das 12 famílias, exclusões no prompt, contexto limitado, proveniência, RAG existente e regressões de entrega do TDL. TypeScript passou. O executador `tsx` encontrou um erro de identificação de usuário no Windows antes de carregar os testes; a suíte foi executada usando a mesma fonte TypeScript com transpilação CommonJS pelo compilador TypeScript. Nenhuma chamada paga de geração foi feita nesta validação.

Ativação online: depende de distribuir estes arquivos ao worker e importar a seed revisada no PostgreSQL. Nesta sessão, a chave SSH configurada retornou `Permission denied` ao ser lida; portanto, **não houve ativação verificada no worker nem importação online**. Publicar no GitHub/Vercel, isoladamente, não atualiza esse worker.
