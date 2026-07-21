# Migrations do web (Drizzle)

**Este projeto aplica o schema com `db:push`, não com `db:migrate`.**

O banco (Neon) foi sempre gerenciado por `drizzle-kit push`, que compara o
`schema.ts` com o banco e aplica a diferença direto pelo driver HTTP. Por isso a
tabela de bookkeeping `drizzle.__drizzle_migrations` está vazia, e
`drizzle-kit migrate` **não funciona**: sem o journal populado ele tenta
reaplicar a `0000` (tabelas que já existem) e falha.

## Fluxo

```bash
# depois de mudar schema.ts:
npm run db:push        # aplica a diferença no banco
```

## Cadeia reproduzível (auditoria #23/#88)

A fonte de verdade continua sendo o `schema.ts` (aplicado por `db:push`). Mas o
baseline `drizzle/0000_*` foi regenerado e as mudanças posteriores ficam nas
migrations numeradas seguintes. Em conjunto, `drizzle/*.sql` reproduz o schema
atual e seus backfills num banco vazio.

O CI (job `db-schema`) garante que a cadeia não fica defasada:

1. aplica, em ordem, todos os arquivos `drizzle/*.sql` num Postgres efêmero;
2. executa os testes transacionais/idempotentes contra esse banco; e
3. roda `drizzle-kit generate` e falha se aparecer migration nova — ou seja, se
   alguém mudou `schema.ts` sem rodar `npm run db:generate`.

Sempre que mudar o `schema.ts`: rode `npm run db:push -w web` (aplica no banco) e
`npm run db:generate -w web` (gera a próxima migration). Não rode `db:migrate`
contra o banco existente, cujo journal histórico não foi retroalimentado.

## Limite do `db:push`: CHECK de tabela pré-existente

`drizzle-kit push` cria tabelas novas já com os CHECK corretos e derruba
constraints removidas do `schema.ts`, mas **não altera um CHECK existente numa
tabela que já existe** — ele não faz o diff de `pg_get_constraintdef`. Se você
mudar os valores permitidos de um CHECK (ex.: `inventory_events.event_type` de
`('consumed')` para `('consumed', 'set')`, migration `0002`), o `db:push`
silenciosamente deixa a constraint antiga de pé e o primeiro INSERT com o valor
novo falha com `23514 check_violation` — foi o que travou o `sync-v2:backfill` no
rollout de 2026-07-21.

A troca precisa ser aplicada por SQL manual (o baseline/migrations já têm o DDL
certo; só o `push` não o executa). Exemplo, seguro por só ampliar o conjunto:

```sql
ALTER TABLE inventory_events DROP CONSTRAINT IF EXISTS inventory_events_event_type_check;
ALTER TABLE inventory_events ADD CONSTRAINT inventory_events_event_type_check
  CHECK (event_type IN ('consumed', 'set'));
```

Ao mudar um CHECK de tabela existente, aplique o DDL correspondente no banco
**antes** de publicar o runtime que grava o valor novo.

## Upgrade de dados do sync v2

Em um banco existente, `db:push` cria colunas/indices/tabelas, mas nao executa os
backfills de dados escritos em `0002_early_doorman.sql`. Depois do `db:push` e
antes de publicar o runtime novo, execute primeiro o dry-run e depois a aplicacao:

```bash
npm run sync-v2:backfill -w web
npm run sync-v2:backfill -w web -- --yes
```

O script e idempotente, imprime somente contagens, usa advisory lock transacional
e reverifica zero antes do commit. Ele preenche `sync_id` legado e cria o baseline
de estoque com a identidade estavel do produto, igual em todos os aparelhos.
