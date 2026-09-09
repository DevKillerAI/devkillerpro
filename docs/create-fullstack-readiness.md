# Create full-stack: escopo verificado

O perfil existente `fullstack-private` combina React, PostgreSQL e Supabase Auth.
O frontend usa a API do Supabase; não há geração de um servidor arbitrário NestJS,
FastAPI ou Next.js. Isso permite aplicações full-stack dentro de um escopo privado.

## Recursos implementados no código

- Migração inicial com 1–16 tabelas, relações e validações de domínio.
- Cadastro, login por e-mail/senha, sessão e logout reais.
- Registros vinculados ao dono da conta, com políticas de acesso no banco.
- Operações no banco com proteção contra duplicação por repetição de pedidos.
- Ambiente Docker isolado e validação de SQL antes da aplicação.
- Verificações de persistência, acesso entre contas, acesso anônimo e sessão.
- Exportação do código e migrações.

O esquema de banco fica congelado após a aprovação. Equipes, permissões por papel,
dados públicos compartilhados, armazenamento de arquivos, tempo real, pagamentos
e funções de servidor personalizadas ainda não fazem parte desse perfil.

## Correção desta revisão

Apps com banco não podem converter falhas de verificação em aprovação parcial.
O resultado real de cada teste permanece intacto. O catálogo de capacidades agora
informa isolamento por proprietário, sem anunciar RBAC de equipes inexistente.

## Pendências para comprovar funcionamento online

1. Instalar o esquema da plataforma no Supabase remoto e configurar acesso do dono.
2. Ativar API e worker persistentes no servidor com HTTPS.
3. Substituir o endereço localhost dos previews por acesso remoto isolado.
4. Gerar um app privado real e testar cadastro, criação, edição, recarga, exclusão
   e isolamento entre duas contas pelo navegador online.

Testes locais de código não substituem esse teste completo em produção.
