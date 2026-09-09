# DK Create: suporte a Linux

A inspeção de redes do perfil com banco de dados dependia do Windows/Docker Desktop.
Agora hosts Linux consultam as rotas IPv4 de todas as tabelas e os endereços das
interfaces antes de alocar sub-redes isoladas para os aplicativos.

Inventários ausentes, inválidos ou excessivos continuam bloqueando a geração.
As redes existentes do host e do Docker permanecem excluídas da alocação.

Validação: nove testes aprovados no Windows e no Linux, checagem TypeScript
aprovada e inspeção real de capacidade de redes no servidor Linux.

Essa adaptação não conclui a publicação do gerador. Ainda são necessários banco
remoto, configuração protegida de IA, API e worker persistentes, gateway HTTPS
para previews e testes ponta a ponta com persistência e isolamento entre usuários.
