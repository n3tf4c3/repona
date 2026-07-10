# CLAUDE.md — Repona

> Diretrizes comportamentais gerais vêm de `C:\Codes\CLAUDE.md` (carregado junto).
> Este arquivo traz só o contexto específico do projeto.

## O que é

Lista de compras e estoque doméstico — app mobile (Expo, dados locais em
SQLite) + versão web (Next.js), com compartilhamento por "casa" via convite.

## Stack

- **Monorepo npm workspaces**: `apps/web`, `apps/mobile`, `packages/core`
  (`@repona/core` — tipos/contratos de domínio puros).
- **Web** (`apps/web`): Next.js + Drizzle ORM + Neon + NextAuth. Deploy na
  Vercel (Root Directory = `apps/web`).
- **Mobile** (`apps/mobile`): Expo/React Native com armazenamento local SQLite.
- Env vars do web: `DATABASE_URL`, `AUTH_SECRET`/`NEXTAUTH_SECRET`,
  `NEXTAUTH_URL`, `INVITE_TOKEN_SECRET` (cifra o token da casa em repouso).

## Comandos (da raiz)

```bash
npm run typecheck && npm run lint && npm test
npm run web            # dev web (:3000)
npm run web:build      # build de produção
npm run mobile         # Expo
npm run db:push --workspace apps/web   # aplicar schema (ver abaixo)
```

## Convenções e invariantes

- **Fluxo de schema canônico é `db:push`, NÃO `db:migrate`**: o script de
  migrate está desativado e as migrations `drizzle/0000_*` são
  históricas/obsoletas (ver `apps/web/drizzle/README.md`) — o inverso dos
  outros projetos da casa.
- Sincronização mobile↔web: o mobile é local-first (SQLite); mudanças de
  contrato de sync exigem atenção às classes de bug de sync do checklist da
  skill `/auditoria-tecnica` (identidade estável, tombstones, LWW).
- Numeração de achados de auditoria é contínua — ledger em
  `docs/auditoria-achados.md`.
- Relatórios de auditoria ficam em `relatorios/` (gitignored); skills
  `/auditoria-tecnica` e `/resolver-auditoria` definem o processo.
