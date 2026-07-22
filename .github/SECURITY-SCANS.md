# Scans de segurança

O workflow `security.yml` separa os controles que funcionam em qualquer
repositório daqueles que dependem de recursos habilitados no GitHub.

## Ativo sem configuração adicional

- **Gitleaks:** examina todo o histórico Git em pushes, pull requests, execução
  semanal e disparo manual. O workflow baixa a versão fixa `8.30.1` do binário
  MIT e confere seu SHA-256 antes de executá-lo.
- Todas as actions usam o SHA completo do commit, não tags móveis.

## Dependente das configurações do repositório

CodeQL e dependency review rodam automaticamente em repositórios públicos. Em
repositórios privados ou internos, um administrador precisa:

1. habilitar **GitHub Code Security** em **Settings > Security > Advanced
   Security**; e
2. definir a variável de Actions `CODE_SECURITY_ENABLED` com valor `true` (o
   prefixo `GITHUB_` é reservado pelo GitHub e não pode ser usado em variáveis).

Sem esses dois passos os jobs ficam ignorados deliberadamente, pois o upload do
CodeQL e a API de dependency review falhariam sem a licença/permissão. Este
workflow usa a configuração avançada do CodeQL; não habilite simultaneamente a
configuração padrão para evitar análises duplicadas.

O **secret scanning nativo** e o **push protection** também são configurações do
GitHub: em repositórios públicos o secret scanning é habilitado automaticamente;
em privados/internos eles exigem GitHub Secret Protection e permissão de
administrador. O Gitleaks acima permanece como controle independente, mas não
substitui o bloqueio preventivo do push protection.

Essas configurações remotas precisam ser confirmadas por um administrador do
repositório; não podem ser inferidas ou ativadas somente por este commit.
