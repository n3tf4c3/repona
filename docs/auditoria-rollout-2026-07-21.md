# Runbook de rollout das correções da auditoria

Este runbook separa o que foi validado no repositório das etapas que dependem
do banco publicado, GitHub Actions, EAS e aparelhos reais. Nunca registrar em
evidências URLs com senha, tokens, dumps, nomes de produtos ou conteúdo de
`.env.local`.

## Estado observado em 2026-07-21

- A cadeia versionada de migrations foi exercitada em PostgreSQL 16 descartável.
- O banco configurado localmente estava anterior às novas tabelas/colunas. Ele
  **não recebeu alteração de schema nem backfill** durante esta auditoria.
- A limpeza do #43 removeu exatamente quatro chaves legadas de rate limit (duas
  de login e duas de sync); a reverificação agregada retornou zero.
- `apps/web/.env.local` continua ignorado e sem histórico Git conhecido. Sua ACL
  local foi restringida ao proprietário, SYSTEM e Administradores sem leitura do
  conteúdo.
- A ACL de `apps/web/backups` recebeu a mesma restrição. Não havia arquivo regular
  diretamente no diretório e nenhum conteúdo foi enumerado ou lido.
- O perfil EAS `preview` usa `repona-preview.invalid` e não pode cair em produção.
- O navegador integrado não estava disponível nesta sessão; o fluxo das APIs é
  coberto pelo smoke HTTP. Validação visual e em dispositivo permanece gate do
  artefato publicado.

## 1. Congelar e validar o commit

1. Criar branch/snapshot recuperável do banco e registrar apenas seu identificador.
2. Publicar web, migrations e mobile a partir do mesmo SHA revisado.
3. Pausar temporariamente merges administrativos de produtos durante o backfill.
4. Validar o contrato de ambiente, sem imprimir valores:

   ```bash
   npm run env:check:production
   ```

5. Executar os gates do SHA:

   ```bash
   npm ci
   npm audit --audit-level=moderate
   npm audit --omit=dev --audit-level=moderate
   npm run lint
   npm run typecheck
   npm test
   npm run web:build
   cd apps/mobile && npx expo install --check
   ```

O workflow também exporta o bundle Android, executa Expo Doctor e gera um
prebuild efêmero que falha se o manifest efetivo não tiver exatamente um
`android:allowBackup="false"`.

## 2. Preparar `products.name_key` antes do `db:push` (#76)

O PostgreSQL passa a persistir a mesma chave NFC/case-fold calculada pelo core;
isso evita depender da collation de `lower()` do servidor. Em banco existente,
o preflight/backfill deve vir **antes** do `db:push`, pois ele cria a coluna,
calcula os valores no runtime JavaScript e instala o índice sem janela de escrita.

```bash
npm run db:product-name-key -w web
npm run db:product-name-key -w web -- --yes
```

O dry-run imprime somente contagens. Se houver colisão, o modo confirmado faz
rollback integral e não imprime nome, chave, ID ou URL. Reconciliar cada grupo
com `merge-produtos` sob o mesmo lock de casa e repetir até obter:

- zero grupos/linhas em colisão;
- zero chaves a corrigir;
- coluna `name_key` pronta;
- índice único persistido pronto.

Não executar `db:push` enquanto o preflight estiver bloqueado.

## 3. Aplicar schema e backfills

O fluxo canônico de banco existente é `db:push`; `db:migrate` permanece
deliberadamente bloqueado. Depois do preflight do passo 2:

```bash
npm run db:push -w web
# CHECK de tabela existente: db:push NÃO altera CHECK pré-existente. Antes do
# backfill, aplicar por SQL a mudança da migration 0002 (senão o INSERT do
# baseline 'set' falha com 23514). Idempotente e seguro (só amplia o conjunto):
#   ALTER TABLE inventory_events DROP CONSTRAINT IF EXISTS inventory_events_event_type_check;
#   ALTER TABLE inventory_events ADD CONSTRAINT inventory_events_event_type_check
#     CHECK (event_type IN ('consumed', 'set'));
npm run sync-v2:backfill -w web
npm run sync-v2:backfill -w web -- --yes
npm run token-legado:status -w web
```

O primeiro comando de sync-v2 é dry-run. O `--yes` atribui identidades UUID e
baselines legados sob lock e só confirma após reverificação. O status de tokens
imprime apenas totais de credenciais atuais, legadas e inválidas.

Confirmar por metadados, sem selecionar dados de domínio:

- `account_operations`, `casa_token_migration_aliases`, `domain_operations` e
  `product_sync_aliases` presentes;
- `products.name_key NOT NULL` e índice único `(casa_id, name_key)` válidos;
- `sync_id`, relógios separados e índices de eventos/paginação presentes;
- constraints/FKs válidas, sem estado `NOT VALID`;
- `inventory_events_event_type_check` permite `'set'` (não só `'consumed'`);
- backfills idempotentes retornam zero na segunda execução.

Se `db:push` propuser drop, rename ambíguo ou perda de dados, cancelar e revisar
o diff. Não aceitar a sugestão interativa por aproximação de nomes.

## 4. Migração das credenciais (#71)

O contrato do rollout é deliberadamente finito:

- credenciais novas: 26 caracteres base32, 130 bits;
- credenciais legadas: 8 ou 12 caracteres;
- cutoff padrão para login/sync/exclusão legado:
  `2027-01-01T00:00:00.000Z` (`LEGACY_TOKEN_ACCEPT_UNTIL` pode antecipar, nunca
  ultrapassar o hard end);
- hard end imutável para migração: `2027-04-01T00:00:00.000Z`;
- aliases legados servem **somente** ao `PATCH /api/casa` de migração; nunca
  autenticam login, sync ou exclusão;
- rotação voluntária revoga a credencial anterior imediatamente;
- recibos v2 exigem o verifier secreto do cliente; um `operation_id` obtido de
  dump não recupera uma credencial.

Antes de distribuir o mobile, executar `token-legado:status`. Investigar qualquer
contagem inválida e migrar todas as credenciais legadas antes do cutoff. Entre o
cutoff e o hard end, clientes antigos deixam de autenticar, mas o app 1.2+ ainda
consegue migrar. Depois do hard end, a API falha fechada para migração e o CLI
retorna código não zero enquanto existir credencial legada atual.

Após confirmar zero legadas e encerrar a janela, contar e excluir aliases
expirados sob change control; registrar apenas a contagem. Não estender a data
para contornar clientes desatualizados.

## 5. Publicar e verificar o web

1. Publicar exatamente o SHA validado.
2. Executar o smoke HTTP com PostgreSQL isolado ou de staging:

   ```bash
   SMOKE_BASE_URL=https://staging-controlado.example \
     npm run smoke:account-api -w web
   ```

   O script cria e remove sua própria casa e não imprime credenciais. Ele cobre
   create/replay/verifier, sync v1/v2, rotate/recover, revogação e delete/replay.
3. Fazer smoke autenticado de produto, consumo, lista e histórico paginado.
4. Repetir consumo/finalização com a mesma operação e confirmar efeito único.
5. Confirmar CSP, `/admin` e rotas sem credencial em modo fail-closed.
6. Confirmar `x-request-id` igual no cliente, resposta e log estruturado, sem
   token, payload, casaId, stack ou mensagem de exceção.

## 6. Gerar e validar o mobile 1.2+

```bash
npm run build:android:prod --workspace mobile
```

Antes da publicação:

1. Inspecionar o AndroidManifest **do APK/AAB efetivo** e confirmar
   `android:allowBackup="false"`.
2. Instalar como upgrade sobre a versão publicada e confirmar todas as migrations
   SQLite, inclusive reparo Unicode, sem perda de dados.
3. Em dois aparelhos, testar:
   - pareamento e primeira carga com várias páginas;
   - migração de tokens de 8 e 12 caracteres e recovery após resposta perdida;
   - dois consumos offline concorrentes a partir do mesmo saldo;
   - eventos distintos no mesmo segundo e replay do mesmo UUID;
   - exclusão/reinclusão de compra;
   - troca A → B sem upload de dados da casa anterior;
   - interrupções após receipt, binding, abertura de SQLite e ACK de página;
   - create/delete repetidos com a mesma operação;
   - tentativa com verifier incorreto e com token aposentado.
4. Confirmar convergência no web e nos dois aparelhos.

O app deve medir somente versão, protocolo, fase, resultado e request ID seguro.
Manter v1 enquanto houver adoção observável; retirar apenas após versão mínima
obrigatória ou critério objetivo registrado.

## 7. Backups administrativos (#85)

Os CLIs falham se não conseguirem impor ACL privada, mas o JSON continua
plaintext. A autorização para gerar um dump exige:

- destino aprovado, privado e preferencialmente cifrado em repouso;
- responsável nominal e prazo mínimo necessário de retenção;
- proibição de e-mail, mensageria, pasta sincronizada ou backup pessoal;
- reverificação da ACL depois de qualquer cópia;
- descarte seguro ao fim da tarefa e registro apenas do identificador/horário;
- preferência por não gerar o dump quando uma consulta agregada resolver.

Se o operador não puder cumprir todos os itens, não executar o export. A ACL não
protege contra exfiltração pelo próprio usuário autorizado nem substitui cifra.

## 8. Gates externos e proteção do repositório (#23/#88/#96)

O código local não prova execução no GitHub. Após push/PR:

1. exigir os jobs `build`, `db-schema`, `secret-scan` e, quando disponíveis,
   `codeql`/`dependency-review` no ruleset de `main`;
2. impedir merge com checks pendentes/falhos e exigir branch atualizada;
3. confirmar no SHA publicado o smoke HTTP, cadeia PostgreSQL, anti-drift,
   auditoria MODERATE+, build web e bundle/manifest Android;
4. habilitar GitHub Code Security quando o plano/repositório exigir para que os
   jobs condicionais não sejam pulados;
5. guardar links dos runs, sem copiar secrets ou logs com dados.

Nenhum push, ruleset, deploy web, `db:push` externo ou build EAS foi iniciado por
esta auditoria; essas ações exigem a janela e autorização do responsável.

## 9. Rollback e evidências de encerramento

- Não rebaixar o servidor para uma versão que desconheça credenciais de 26
  caracteres depois de iniciar a migração.
- Rollback do web deve manter leitura do schema aditivo; rollback de banco usa o
  snapshot/branch, nunca DDL manual improvisado.
- Se uma rotação tiver commitado, recuperar pelo mesmo operation ID + verifier;
  não gerar outra credencial por tentativa.
- Se a publicação mobile falhar, manter endpoints v1/v2 e a janela de migração;
  não ampliar o hard end sem nova análise de risco.

Anexar ao registro de deploy:

- SHA/tag e links dos checks obrigatórios;
- identificador do snapshot e horário de cada passo;
- saídas agregadas dos preflights/backfills e status de tokens;
- versão/build e hash do APK/AAB, manifest verificado e matriz de dois aparelhos;
- smoke web/API e `EXPLAIN (ANALYZE, BUFFERS)` no volume real do #87;
- contagem zero do #43 e dos aliases/legados ao fim da janela;
- plano de rollback testado.
