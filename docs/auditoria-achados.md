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
| 22 | Finalizacao de compra marca itens antes dos efeitos transacionais | Alta | RESOLVIDO | try/catch desfaz o claim se os efeitos falham (listas.ts). Resolvido 2026-06-26. |
| 23 | Migrations/metadata divergem do schema atual: coluna products.brand ausente | Alta | DOCUMENTADO | Fluxo canonico e db:push (schema.ts tem brand); 0000_* marcado obsoleto. 2026-06-26. |
| 24 | Web descarta brand em create/update de produto | Alta | RESOLVIDO | brand adicionado ao productInputSchema (produtos/actions.ts). Resolvido 2026-06-26. |
| 25 | Typecheck do monorepo falha por resolucao de @repona/core no mobile | Alta | RESOLVIDO | paths no tsconfig do mobile; typecheck dos 3 workspaces verde. Resolvido 2026-06-26. |
| 26 | Merge de sync persiste produtos novos antes do batch principal | Media | ABERTO (aceito) | Parcial auto-curavel por retry idempotente (syncId); fix exige transacao interativa. Justificado em sync.ts. 2026-06-26. |
| 27 | Consumo de estoque sofre lost update em concorrencia | Media | RESOLVIDO | compare-and-set com retry no consumir (estoque.ts). Resolvido 2026-06-26. |
| 28 | Mobile deduplica eventos por nome do produto e pode duplicar apos renomeio | Media | RESOLVIDO | Dedupe por productId em sync.ts (compras/precos/consumos). Resolvido 2026-06-26. |
| 29 | Mobile aceita preco acima do limite do endpoint de sync | Media | RESOLVIDO | MAX_PRICE_CENTS no core, validado em web/mobile. Resolvido 2026-06-26. |
| 30 | Mobile pode gravar quantidade em notacao cientifica rejeitada pelo web | Media | RESOLVIDO | buildQuantityString no core usado nos modais; +2 testes. Resolvido 2026-06-26. |
| 31 | FKs de purchase_history.source_list_id tem politica de delete conflitante | Media | DOCUMENTADO | Listas sao arquivadas, nunca deletadas; conflito nao dispara. Comentario no schema.ts. 2026-06-26. |
| 32 | Rate limit confia diretamente em x-forwarded-for | Media | RESOLVIDO | Helper ipDaRequest prioriza x-real-ip (sync/casa/login). Resolvido 2026-06-26. |
| 33 | Validacao inicial de finalizacao considera tombstones antigos | Baixa | RESOLVIDO | Filtro deleted=false na validacao inicial (listas.ts). Resolvido 2026-06-26. |
| 34 | Headers de seguranca HTTP nao estao configurados explicitamente | Baixa | RESOLVIDO | HSTS/X-Frame/nosniff/Referrer/Permissions/CSP frame-ancestors (next.config.ts). Resolvido 2026-06-26. |
| 35 | npm audit reporta vulnerabilidades moderadas em dependencias | Media | ABERTO (aceito) | 23 moderadas em tooling de build/prebuild e uuid transitivo nao-alcancavel; unico fix e downgrade breaking do next-auth. Revisitar. 2026-06-26. |
| 36 | Script db:migrate continua exposto apesar de migration obsoleta | Media | RESOLVIDO | Script substituido por guard que falha orientando db:push (package.json). Resolvido 2026-06-26. |
| 37 | Sync nao normaliza nem protege colisao de barcode | Media | RESOLVIDO | Barcode normalizado no schema; merge preserva local em colisao (sync.ts). Resolvido 2026-06-26. |
| 38 | Scripts administrativos imprimem token da casa e usam token em nomes de backup | Baixa | RESOLVIDO | Token mascarado por padrao (flag --show-token) e casa.id nos backups. Resolvido 2026-06-26. |
| 39 | Estoque mobile usa quantidade stale em acoes rapidas | Media | RESOLVIDO | InventoryControls trava botoes do produto enquanto a acao esta pendente (products.tsx). Resolvido 2026-06-26. |
| 40 | Nova lista ativa no mobile nao propaga tombstones offline anteriores | Media | RESOLVIDO | createNewActiveShoppingList copia tombstones recentes preservando updated_at (shoppingLists.ts). Resolvido 2026-06-26. |
| 41 | Snapshot mobile pode enviar precos legados invalidos ou excessivos | Media | RESOLVIDO | buildLocalSnapshot filtra faixa valida e top 10/produto (sync.ts). Resolvido 2026-06-26. |
| 42 | Consumo web baixa estoque antes de registrar evento/status sem rollback | Media | RESOLVIDO | try/catch desfaz claim do estoque via compare-and-set (estoque.ts). Resolvido 2026-06-26. |
| 43 | Token de acesso da casa armazenado em texto puro | Alta | RESOLVIDO | Token cifrado em repouso (AES-256-GCM deterministico, inviteToken.ts); coluna invite_code_enc; migracao scripts/migrar-invite-code.mjs. Resolvido 2026-06-27. |
| 44 | Rate limit e lock distribuido falham aberto quando KV nao esta configurado | Alta | RESOLVIDO | Rate limit e lock de sync migrados para o Neon Postgres (tabelas rate_limits/sync_locks, rateLimit.ts); @vercel/kv removido; sem servico externo/custo. Resolvido 2026-06-27. |
| 45 | Exclusao de conta pela aplicacao nao e atomica | Alta | RESOLVIDO | excluirCasa usa db.batch (uma transacao neon-http) em modules/casa.ts. Resolvido 2026-06-27. |
| 46 | README orienta fluxo de migration que o projeto desativou | Media | RESOLVIDO | README aponta db:push com aviso de db:migrate desativado. Resolvido 2026-06-27. |
| 47 | Exclusao de conta e sincronizacao rate-limitam so por IP, sem chave por token | Alta | RESOLVIDO | sync/casa (DELETE) aplicam rateLimited por token (sync:token:/casa-del:token:) alem do IP. Resolvido 2026-07-01. |
| 48 | Painel /admin sem rate limit no Basic Auth | Media | RESOLVIDO | middleware.ts limita admin:ip: antes do Basic Auth; rateLimit.ts edge-safe (crypto.randomUUID global). Resolvido 2026-07-01. |
| 49 | Tabela rate_limits nunca e podada | Media | RESOLVIDO | Poda oportunistica em rateLimited (2%/hit apaga expirados >1h); sem cron. Resolvido 2026-07-01. |
| 50 | Comentario desatualizado sobre Vercel KV em sync/route.ts | Baixa | RESOLVIDO | Comentario reescrito para o backing Postgres (sem KV/memoria). Resolvido 2026-07-01. |
| 51 | Dependencia bcryptjs sem uso no codigo | Baixa | RESOLVIDO | bcryptjs e @types/bcryptjs removidos de apps/web (npm uninstall); lockfile sincronizado. Resolvido 2026-07-01. |
| 52 | Segredos reais existem em .env.local no workspace local | Alta | ABERTO (aceito) | Operacional, sem correcao de codigo: .env.local ja e gitignored. Acao do dono: rotacionar segredos se houver risco de exposicao e manter o arquivo fora de backups/compartilhamentos. 2026-07-01. |
| 53 | Token da casa e salvo em SQLite comum no mobile | Alta | RESOLVIDO | Token movido para expo-secure-store (Keychain/Keystore) com migracao do SQLite legado; last_sync_at continua no SQLite (syncClient.ts). Requer novo build EAS. Resolvido 2026-07-01. |
| 54 | Rate limit por token usa header nao validado como chave persistida | Media | RESOLVIDO | CASA_CODE_REGEX valida x-casa-code; formato invalido cai em bucket fixo "invalido" (sync/route.ts, casa/route.ts). Resolvido 2026-07-01. |
| 55 | Endpoint de sync nao limita bytes antes de req.json nem pagina retorno | Media | RESOLVIDO | Teto de 8 MB por Content-Length antes do parse (413 PAYLOAD_TOO_LARGE, sync/route.ts). Sync incremental/paginado do retorno segue como refactor futuro. Resolvido 2026-07-01. |
| 56 | Eventos offline antigos podem nunca subir para a nuvem | Media | RESOLVIDO | Primeira sincronizacao (last_sync_at nulo) envia o historico inteiro sem a janela (sync.ts). Residual: >24 meses offline ENTRE syncs continua filtrado (aceito). Resolvido 2026-07-01. |
| 57 | Falhas locais no sync mobile podem escapar sem restaurar a UI | Media | RESOLVIDO | enviarSnapshot envolve buildLocalSnapshot/json/applySnapshot em try/catch tipado; PerfilScreen usa try/finally no busy. Resolvido 2026-07-01. |
| 58 | Criacao de conta salva token antes da primeira sincronizacao completar | Media | ABERTO (aceito) | O token e gerado no servidor e devolvido uma unica vez: descarta-lo em falha de sync orfanaria a casa. Salvar de imediato e necessario; o backup inicial incompleto nao e perda de dado e se auto-cura no proximo sync (dados locais permanecem). 2026-07-01. |
| 59 | Aplicacao de snapshot no mobile nao protege colisao de barcode | Media | RESOLVIDO | applySnapshot preserva o barcode local quando o recebido ja pertence a outro produto, espelhando o backend (sync.ts). Indice unico no SQLite fica para migracao com saneamento previo. Resolvido 2026-07-01. |
| 60 | Categoria aceita pelo sync diverge do enum validado no web | Baixa | RESOLVIDO | sync usa z.enum(CATEGORIAS).catch("Mercearia"): normaliza categoria fora do enum sem rejeitar o snapshot inteiro (sync/route.ts). Resolvido 2026-07-01. |
| 61 | Basic Auth do admin aceita credencial sem separador dois-pontos | Baixa | RESOLVIDO | middleware exige indexOf(":") != -1 antes de comparar a senha (middleware.ts). Resolvido 2026-07-01. |
| 62 | Campo mobile de alerta de estoque nao limita caracteres na UI | Baixa | RESOLVIDO | TextInput de alertThreshold usa maxLength={FIELD_LIMITS.alertThreshold} (modals.tsx). Resolvido 2026-07-01. |
| 63 | Comentario do schema de rate_limits contradiz a poda ja implementada | Baixa | RESOLVIDO | Comentario reescrito: cardinalidade nao-limitada (IP/token), limpeza e a poda oportunistica em rateLimit.ts (schema.ts). Resolvido 2026-07-01. |
| 64 | Retry de criacao/regeneracao de casa trata qualquer erro como colisao | Baixa | RESOLVIDO | ehColisaoDeCodigo restringe o retry a unique_violation (23505); demais erros propagam de imediato (casa.ts). Resolvido 2026-07-01. |
| 65 | Re-adicao de item excluido e desfeita pelo proximo sync (revive local sem un-delete no protocolo) | Media | ABERTO | Potencial. addPurchaseHistoryRecord revive tombstone local, mas merge web e applySnapshot mobile nunca fazem un-delete: item re-incluido some no sync seguinte se o tombstone ja subiu. Auditoria 2026-07-07. |
| 66 | Excluir compra com mais de 24 meses nunca propaga a exclusao | Media | ABERTO | Potencial. Janela EVENT_WINDOW_MS filtra tombstones pelo purchased_at do evento (sync.ts mobile); tombstone de compra antiga fica fora do snapshot para sempre. Auditoria 2026-07-07. |
| 67 | Clientes mobile antigos re-inserem como vivas as compras tombstonadas | Baixa | ABERTO | Potencial/transitorio. construirSnapshot sempre devolve tombstones; app <=1.0.2 ignora o campo deleted e insere vivo. Auto-cura apos update do app; nuvem nao ressuscita. Auditoria 2026-07-07. |
