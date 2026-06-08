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

Os arquivos `0000_*`/`0001_*` são histórico e não são a fonte de verdade — a
fonte de verdade é o `schema.ts`. Não rode `db:migrate` aqui.
