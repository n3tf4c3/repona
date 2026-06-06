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
- `AUTH_SECRET` (e `NEXTAUTH_SECRET` com o mesmo valor) — segredo do NextAuth
- `NEXTAUTH_URL` — `http://localhost:3000` em dev

Com o banco configurado, aplique as migrations:

```bash
npm run db:migrate --workspace apps/web
```

## Deploy na Vercel

O projeto da Vercel deve apontar para o app web dentro do monorepo:

1. **Settings → General → Root Directory** = `apps/web`.
2. **Settings → Environment Variables**: defina `DATABASE_URL`, `AUTH_SECRET`,
   `NEXTAUTH_SECRET` e `NEXTAUTH_URL` (a URL do deploy).
3. Build/Install commands: padrão — a Vercel detecta os workspaces, instala na raiz
   e builda em `apps/web`.
