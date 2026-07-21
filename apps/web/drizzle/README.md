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

## Baseline reproduzível (auditoria #23)

A fonte de verdade continua sendo o `schema.ts` (aplicado por `db:push`). Mas o
baseline `drizzle/0000_*` foi **regenerado para reproduzir exatamente o schema
atual** (`npm run db:generate -w web`), em vez do `0000` histórico defasado. Ele
serve para bootstrap/restore (a skill `restaurar-neon` recria o schema por SQL) e
como retrato versionado do schema.

O CI (job `db-schema`) garante que o baseline não fica defasado:

1. aplica `drizzle/0000_*.sql` num Postgres efêmero (prova que é DDL válida); e
2. roda `drizzle-kit generate` e falha se aparecer migration nova — ou seja, se
   alguém mudou `schema.ts` sem rodar `npm run db:generate`.

Sempre que mudar o `schema.ts`: rode `npm run db:push -w web` (aplica no banco) e
`npm run db:generate -w web` (atualiza o baseline). Não rode `db:migrate` aqui.
