# Runbook de rollout das correcoes da auditoria

Este documento separa as correcoes verificadas no repositorio das etapas que
dependem de banco, build EAS e aparelhos reais. Nao registrar URLs com senha,
tokens, dumps ou conteudo de `.env.local` nas evidencias.

## Estado observado em 2026-07-21

- A cadeia `apps/web/drizzle/0000_*.sql` ate a migration mais recente aplicou em
  Postgres 16 efemero.
- O banco apontado pela configuracao local ainda nao possuia as tabelas de
  recibos/aliases nem os novos `sync_id`/indices consultados. Nenhuma alteracao
  de schema foi feita nele durante a validacao.
- A limpeza operacional do achado #43 removeu quatro chaves legadas de rate
  limit (duas de login e duas de sync) e a reverificacao retornou zero.
- O perfil EAS `preview` e intencionalmente local-only: usa o dominio reservado
  `repona-preview.invalid` e nao pode cair em producao.

## 1. Preparar o deploy

1. Criar snapshot/branch do banco e registrar o identificador do backup.
2. Confirmar a janela de manutencao e pausar merges administrativos de produtos.
3. Validar as variaveis sem exibir valores:

   ```bash
   npm run env:check:production
   ```

4. Executar a validacao integral do commit que sera publicado:

   ```bash
   npm ci
   npm audit --audit-level=high
   npm run lint
   npm run typecheck
   npm test
   npm run web:build
   ```

## 2. Aplicar o schema antes do novo runtime

O fluxo canonico do banco existente e `db:push`; nao usar `db:migrate`, pois o
journal historico nao foi retroalimentado.

```bash
npm run db:push --workspace apps/web
npm run sync-v2:backfill -w web
npm run sync-v2:backfill -w web -- --yes
```

O primeiro comando de backfill e somente dry-run. O modo `--yes` atribui os
`sync_id` legados e cria os baselines de estoque que `db:push` (DDL) nao executa;
ele usa lock transacional e so confirma o commit depois de reverificar zero.

Depois, confirmar sem selecionar dados de dominio:

- tabelas `account_operations`, `domain_operations` e
  `product_sync_aliases` presentes;
- `purchase_history.sync_id`, `inventory_events.sync_id` e relogios separados
  presentes;
- indices de identidade de eventos e de paginacao do historico presentes;
- FKs e CHECKs sem estado `NOT VALID`.

Se `db:push` propuser drop, rename ambiguo ou perda de dados, cancelar e revisar
o diff; nao aceitar interativamente por aproximacao de nomes.

## 3. Publicar o web

1. Publicar o mesmo commit validado no passo 1.
2. Fazer smoke test de login, criacao de produto, consumo, finalizacao de lista,
   historico paginado e sync.
3. Repetir consumo/finalizacao com a mesma chave de operacao e confirmar que o
   efeito ocorre uma unica vez.
4. Confirmar que CSP, `/admin` e rotas sem credencial falham de forma fechada.

## 4. Gerar e validar o mobile

O build precisa conter as migrations SQLite novas e o protocolo de sync atual.

```bash
npm run build:android:prod --workspace mobile
```

Antes de publicar:

1. Inspecionar o AndroidManifest do APK/AAB efetivo e confirmar
   `android:allowBackup="false"`.
2. Instalar como upgrade sobre a versao 1.0.3 e confirmar que todas as migrations
   SQLite terminam e preservam dados.
3. Em dois aparelhos, testar:
   - pareamento e primeira carga com varias paginas;
   - dois consumos offline concorrentes a partir do mesmo saldo;
   - dois eventos diferentes no mesmo segundo;
   - exclusao e re-inclusao de compra;
   - troca entre duas casas sem envio de dados da casa anterior;
   - perda simulada da resposta de criar/excluir conta e retry da mesma operacao;
   - interrupcao/reinicio no meio de uma sincronizacao paginada.
4. Confirmar convergencia no web e nos dois aparelhos apos novo sync.

## 5. Compatibilidade e rollout

- Manter o endpoint/protocolo legado enquanto houver clientes antigos ativos.
- Registrar somente versao/protocolo e resultado tecnico, sem token nem dados de
  compras, para medir adocao.
- Nao distribuir o perfil `preview` atual como ambiente conectado. Para um
  staging real, provisionar banco e backend isolados e substituir a URL
  `.invalid` somente nesse perfil.
- Remover a compatibilidade legada apenas depois de um criterio objetivo de
  adocao ou versao minima obrigatoria.

## 6. Evidencias de encerramento

Anexar ao registro de deploy:

- commit/tag publicados;
- identificador do backup e horario do `db:push`;
- saida resumida dos gates (sem variaveis ou URLs sensiveis);
- versao/build number do mobile e hash do APK/AAB;
- resultado da inspecao de `allowBackup`;
- matriz dos testes em dois aparelhos;
- contagem zero da limpeza #43;
- plano de rollback do web e do banco.
