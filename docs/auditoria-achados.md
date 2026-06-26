# Ledger de Achados de Auditoria

Fonte versionada para manter a numeracao continua dos achados. Relatorios completos ficam fora do repositorio em `C:\Codes\relatorios\repona`.

| # | Achado | Severidade | Status | Observacao |
|---|---|---|---|---|
| 1 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 2 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 3 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 4 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 5 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 6 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 7 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 8 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 9 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 10 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 11 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 12 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. Inclui subitens 12.1, 12.2 e 12.3 citados no historico. |
| 13 | Regenerar token revoga sessoes web ativas | Variavel | RESOLVIDO | Evidencias em schema/auth/session e commits anteriores. |
| 14 | Integridade cross-casa via FKs compostas | Variavel | RESOLVIDO | Evidencias em schema e commits anteriores. |
| 15 | Finalizacao idempotente por claim com RETURNING | Variavel | RESOLVIDO | Evidencias em modulo de listas e commits anteriores. |
| 16 | Migrations mobile versionadas por user_version | Variavel | RESOLVIDO | Evidencias em storage/database e commits anteriores. |
| 17 | Compra preserva lista de origem no sync | Variavel | RESOLVIDO | Evidencias em schema/core/historico e commits anteriores. |
| 18 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Reservado no bootstrap para manter sequencia continua. |
| 19 | Normalizacao de barcode no sync | Variavel | RESOLVIDO | Evidencias em comentarios de sync web/mobile. |
| 20 | Login web por token nao tem rate limit | Alta | RESOLVIDO | rateLimited por IP e token no authorize (options.ts). Resolvido 2026-06-26. |
| 21 | Lock distribuido de sync nao tem dono e unlock pode apagar lock alheio | Alta | RESOLVIDO | tryLock devolve token; unlock faz compare-and-delete atomico (rateLimit.ts). Resolvido 2026-06-26. |
| 22 | Finalizacao de compra marca itens antes dos efeitos transacionais | Alta | ABERTO | Auditoria 2026-06-26. Onda dedicada (transacao/neon-http). |
| 23 | Migrations/metadata divergem do schema atual: coluna products.brand ausente | Alta | DOCUMENTADO | Fluxo canonico e db:push (schema.ts tem brand); 0000_* marcado obsoleto. 2026-06-26. |
| 24 | Web descarta brand em create/update de produto | Alta | RESOLVIDO | brand adicionado ao productInputSchema (produtos/actions.ts). Resolvido 2026-06-26. |
| 25 | Typecheck do monorepo falha por resolucao de @repona/core no mobile | Alta | RESOLVIDO | paths no tsconfig do mobile; typecheck dos 3 workspaces verde. Resolvido 2026-06-26. |
| 26 | Merge de sync persiste produtos novos antes do batch principal | Media | ABERTO | Auditoria 2026-06-26. Onda dedicada (transacao/neon-http). |
| 27 | Consumo de estoque sofre lost update em concorrencia | Media | RESOLVIDO | compare-and-set com retry no consumir (estoque.ts). Resolvido 2026-06-26. |
| 28 | Mobile deduplica eventos por nome do produto e pode duplicar apos renomeio | Media | RESOLVIDO | Dedupe por productId em sync.ts (compras/precos/consumos). Resolvido 2026-06-26. |
| 29 | Mobile aceita preco acima do limite do endpoint de sync | Media | RESOLVIDO | MAX_PRICE_CENTS no core, validado em web/mobile. Resolvido 2026-06-26. |
| 30 | Mobile pode gravar quantidade em notacao cientifica rejeitada pelo web | Media | RESOLVIDO | buildQuantityString no core usado nos modais; +2 testes. Resolvido 2026-06-26. |
| 31 | FKs de purchase_history.source_list_id tem politica de delete conflitante | Media | DOCUMENTADO | Listas sao arquivadas, nunca deletadas; conflito nao dispara. Comentario no schema.ts. 2026-06-26. |
| 32 | Rate limit confia diretamente em x-forwarded-for | Media | RESOLVIDO | Helper ipDaRequest prioriza x-real-ip (sync/casa/login). Resolvido 2026-06-26. |
| 33 | Validacao inicial de finalizacao considera tombstones antigos | Baixa | RESOLVIDO | Filtro deleted=false na validacao inicial (listas.ts). Resolvido 2026-06-26. |
| 34 | Headers de seguranca HTTP nao estao configurados explicitamente | Baixa | RESOLVIDO | HSTS/X-Frame/nosniff/Referrer/Permissions/CSP frame-ancestors (next.config.ts). Resolvido 2026-06-26. |
| 35 | npm audit reporta vulnerabilidades moderadas em dependencias | Media | ABERTO | Auditoria 2026-06-26. |
