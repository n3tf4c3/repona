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
