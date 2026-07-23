# Repona — Monorepo

Monorepo (npm workspaces) com o app mobile (Expo) e a versão web (Next.js), no
mesmo formato do `tizerguide`.

## Estrutura

```
apps/
  mobile/   App Expo (React Native) — lista de compras e estoque (local/SQLite)
  web/      App Next.js (Vercel) — backend Neon Postgres + Drizzle + NextAuth
packages/
  core/     @repona/core — tipos/contratos de domínio puros, compartilhados
```

## Recursos e Funcionalidades

- **Scanner de Código de Barras**: cadastro e busca rápida de produtos.
- **Cadastro por Foto (photoUri)**: suporte a fotos dos produtos no Web e Mobile.
- **Sugestões Inteligentes de Recompra**: recomendações automáticas calculadas pelo `@repona/core` com base em falta, estoque baixo e hábitos de consumo.
- **Histórico e Preço Médio**: gráficos de evolução de preços, preço mínimo, máximo, preço médio e variação percentual.
- **Backup e Exportação**: exportação dos dados da casa em formato **JSON** (backup completo) e **CSV** (para Excel / Google Sheets), com suporte a importação.
- **Sincronização Local-First (Sync V2)**: protocolo idempotente com suporte offline, tombstones, LWW e reconciliação de aliases de produtos.

## Comandos (na raiz)

```bash
npm install        # instala e linka todos os workspaces
npm run mobile     # inicia o Expo (apps/mobile)
npm run web        # inicia o Next.js em http://localhost:3000 (apps/web)
npm run web:build  # build de produção do web
npm run typecheck  # typecheck de todos os workspaces
```

## Web — variáveis de ambiente

Copie `apps/web/.env.example` para `apps/web/.env.local` e preencha:

- `DATABASE_URL` — conexão Neon/PostgreSQL
- `AUTH_SECRET` (e `NEXTAUTH_SECRET`, se definido, com o mesmo valor) — segredo
  do NextAuth com no mínimo 32 caracteres
- `NEXTAUTH_URL` — `http://localhost:3000` em dev e obrigatoriamente HTTPS em produção
- `INVITE_TOKEN_SECRET` — segredo de no mínimo 32 caracteres para cifrar o token
  da casa em repouso
- `ADMIN_SECRET` — senha de no mínimo 32 caracteres do Basic Auth do painel `/admin`; sem ela o painel
  responde 503 (fail-closed)
- `RATE_LIMIT_PEPPER` — opcional, com no mínimo 32 caracteres; quando ausente é
  derivado de `INVITE_TOKEN_SECRET` via HKDF

Valide o conjunto completo sem abrir conexão nem exibir valores sensíveis:

```bash
npm run env:check                 # ambiente local/teste
npm run env:check:production      # exige NEXTAUTH_URL com HTTPS
```

Com o banco configurado, aplique o schema com `db:push` (fluxo canônico do
projeto). **Não use `db:migrate`** — o script está desativado. O baseline
`drizzle/0000_*` foi regenerado para reproduzir exatamente o `schema.ts` atual
(auditoria #23) e serve de retrato versionado/bootstrap, não é obsoleto; veja
`apps/web/drizzle/README.md`:

```bash
npm run db:push --workspace apps/web
```

Ao atualizar um banco que ja possui dados para a versao com sync v2, rode tambem
o backfill idempotente (primeiro apenas conta, depois aplica):

```bash
npm run sync-v2:backfill -w web
npm run sync-v2:backfill -w web -- --yes
```

O `db:push` aplica DDL, mas nao executa os backfills de eventos escritos nas
migrations SQL. Veja o procedimento completo em
`docs/auditoria-rollout-2026-07-21.md`.

## Merge administrativo de produtos

O merge sempre começa em modo de simulação e imprime o plano completo. Ele usa
o mesmo lock distribuído do sync da casa, preserva eventos por `sync_id`,
reconcilia lista/estoque e mantém um alias permanente da identidade aposentada
para o produto canônico. A aplicação grava antes um backup local restrito.

```bash
# dry-run (casa aceita id/token; produtos aceitam id/nome)
npm run merge-produtos -w web -- <casa> <duplicado> <canonico>

# aplicar exatamente o merge apresentado, com nova validação sob lock
npm run merge-produtos -w web -- <casa> <duplicado> <canonico> --yes
```

Antes da primeira execução após esta versão, aplique o schema para criar
`product_sync_aliases`. Em colisões, itens de lista usam LWW (tombstone vence
empate), o estoque mais recente vence (canônico vence empate) e um evento `set`
registra explicitamente o saldo reconciliado.

## Deploy na Vercel

O projeto da Vercel deve apontar para o app web dentro do monorepo:

1. **Settings → General → Root Directory** = `apps/web`.
2. **Settings → Environment Variables**: defina `DATABASE_URL`, `AUTH_SECRET`,
   `NEXTAUTH_SECRET` (mesmo valor de `AUTH_SECRET`), `NEXTAUTH_URL` (HTTPS do
   deploy), `INVITE_TOKEN_SECRET`, `ADMIN_SECRET` e, opcionalmente,
   `RATE_LIMIT_PEPPER`.
3. Build/Install commands: padrão — a Vercel detecta os workspaces, instala na raiz
   e builda em `apps/web`.
