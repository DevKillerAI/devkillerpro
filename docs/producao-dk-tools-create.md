# DK Tools + Create: preparação de produção

## Arquitetura escolhida

Endereço pretendido: https://devkiller.vercel.app (disponibilidade ainda não verificada).
Vercel hospeda a aplicação Next completa: `/`, `/tools`, `/login`, `/projects`, `/create`.
Supabase fornece autenticação e banco. As duas áreas usam o mesmo projeto Supabase,
a mesma identidade e os cookies da mesma origem. O Sites continua sendo apenas a prévia estática.

## Implementado e verificado localmente

- Login retorna ao caminho solicitado, incluindo o projeto, e bloqueia retornos externos.
- Cabeçalho das duas áreas reconhece a sessão, oferece conta e logout.
- API de sessão verifica o usuário no Supabase e o acesso do perfil; respostas privadas sem cache.
- Conta sem autorização/crédito de geração recebe explicação em Create, em vez de um 404.
- Create usa o cabeçalho DK e tema claro/coral. Apps gerados continuam com o visual de seus prompts.
- Build da aplicação separado de arquivos de pesquisa, experimentos e cópias da prévia.
- Teste HTTP local: login real com conta piloto, sessão, acesso a Create, logout,
  retorno de visitante anônimo, JSON inválido e bloqueio de logout de outra origem.

## Configuração de publicação

1. Importar este repositório raiz como projeto Next.js na Vercel, não `sites/dk-ecosystem`.
2. Configurar os valores de `.env.production.example`. Não publicar esse arquivo com segredos.
   Usar conexão pooler do Supabase adequada ao ambiente web e executar as migrações existentes
   em staging antes de produção, com backup. Esta tarefa não executou migrações remotas.
3. No Supabase Auth, configurar Site URL como `https://devkiller.vercel.app`.
   O login atual usa email/senha com contas por convite; não foi liberado cadastro público
   nem acesso gratuito automático à geração. OAuth e recuperação de senha continuam pendentes.
4. Servidor de geração: executar API Next + worker durável existentes, Docker runners e
   armazenamento persistente de `.devkiller`, com o mesmo Supabase. Manter OPENAI_API_KEY
   e tokens internos somente nesse servidor. Expor a API por HTTPS e configurar
   `DEVKILLER_TRUSTED_ORIGINS=https://devkiller.vercel.app`.
5. Na Vercel, definir `DK_GENERATOR_ORIGIN` com a origem HTTPS desse servidor e reconstruir.
   O rewrite `/api/generator/*` conserva a autenticação do usuário; não injeta token de worker
   nem substitui autorização. Não configurar essa variável no upstream. Validar encaminhamento
   dos cookies, renovação da sessão e origem no proxy real antes de liberar usuários.

## Bloqueios de lançamento ainda abertos

- Faltam projeto/credenciais remotos e host de execução; nenhuma publicação Vercel foi realizada.
- Previews de apps com banco ainda usam containers e URLs loopback. Precisam de gateway HTTPS
  autenticado e isolamento por usuário antes de acesso remoto; não expor portas Docker diretamente.
- Validar geração real ponta a ponta, exportação, persistência, dois usuários isolados,
  limites de uso, recuperação de senha, backups e logout no domínio final.
- O supervisor existente tem modo de entrega parcial que promove verificações reprovadas
  a avisos. Foi preservado nesta integração; revisar esse critério antes de declarar apps prontos.
- Projetos do Tools continuam salvos neste navegador. Login único não significa sincronização:
  persistência de projetos Tools por conta ainda precisa de esquema, RLS e migração próprios.
- Recursos “Em breve”, pagamentos, doações e cadastro público não foram ativados.

## Referências verificadas

- Supabase Auth URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Limites das funções Vercel: https://vercel.com/docs/functions/limitations

O build e o teste de autenticação locais não equivalem a uma homologação de produção.

## Destinos informados em 08/09/2026
- Repositório: https://github.com/DevKillerAI/devkillerpro
- Supabase: https://ocfdbuslxrbliyvvwylf.supabase.co
- O conector GitHub desta sessão confirmou acesso somente de leitura (push: false); o repositório informa tamanho zero.
- Ainda faltam acesso de escrita ao repositório, projeto Vercel e configuração protegida de autenticação/banco e host persistente do gerador. A URL Supabase não substitui essas configurações.
