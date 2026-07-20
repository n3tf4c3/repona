# Ledger de Achados de Auditoria

Fonte versionada para manter a numeracao continua dos achados. Relatorios completos ficam fora do repositorio em `C:\Codes\relatorios\repona`.

| # | Achado | Severidade | Status | Observacao |
|---|---|---|---|---|
| 1 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Bootstrap a partir de comentarios e commits de auditoria anteriores. |
| 2 | LWW unico mistura metadados/estoque e confia no relogio do device | Media | REABERTO | Um timestamp governa campos independentes e aceita data futura; risco confirmado estaticamente. Relatorio 2026-07-20. |
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
| 13 | Regeneracao do token causa lockout e nao entrega a nova credencial | Alta | REABERTO | credentialVersion revoga a sessao, mas Action retorna apenas ok e a pagina do novo token exige a sessao invalida. Relatorio 2026-07-20. |
| 14 | Integridade cross-casa via FKs compostas | Variavel | RESOLVIDO | Evidencias em schema e commits anteriores. |
| 15 | Finalizacao idempotente por claim com RETURNING | Variavel | RESOLVIDO | Evidencias em modulo de listas e commits anteriores. |
| 16 | Migrations mobile versionadas por user_version | Variavel | RESOLVIDO | Evidencias em storage/database e commits anteriores. |
| 17 | Compra preserva lista de origem no sync | Variavel | RESOLVIDO | Evidencias em schema/core/historico e commits anteriores. |
| 18 | Historico anterior identificado no codigo/git | Variavel | RESOLVIDO | Reservado no bootstrap para manter sequencia continua. |
| 19 | Normalizacao de barcode no sync | Variavel | RESOLVIDO | Evidencias em comentarios de sync web/mobile. |
| 20 | Login web por token nao tem rate limit | Alta | RESOLVIDO | rateLimited por IP e token no authorize (options.ts). Resolvido 2026-06-26. |
| 21 | Lock distribuido de sync nao tem dono e unlock pode apagar lock alheio | Alta | RESOLVIDO | tryLock devolve token; unlock faz compare-and-delete atomico (rateLimit.ts). Resolvido 2026-06-26. |
| 22 | Claim e efeitos em round-trips separados tem resultado ambiguo em timeout | Media | REABERTO | Compensacao nao distingue batch rejeitado de commit com resposta perdida; retry pode duplicar efeitos. Relatorio 2026-07-20. |
| 23 | Migrations/metadata divergem do schema atual | Alta | DOCUMENTADO | Drift persiste e inclui campos/tabelas novos; fluxo canonico segue db:push e 0000_* esta obsoleto. Revalidado 2026-07-20. |
| 24 | Web descarta brand em create/update de produto | Alta | RESOLVIDO | brand adicionado ao productInputSchema (produtos/actions.ts). Resolvido 2026-06-26. |
| 25 | Typecheck do monorepo falha por resolucao de @repona/core no mobile | Alta | RESOLVIDO | paths no tsconfig do mobile; typecheck dos 3 workspaces verde. Resolvido 2026-06-26. |
| 26 | Merge de sync persiste produtos novos antes do batch principal | Media | ABERTO (aceito) | Parcial auto-curavel por retry, mas sem garantia se nao houver nova sync; confirmado em sync.ts. Revalidado 2026-07-20. |
| 27 | Consumo de estoque sofre lost update em concorrencia | Media | RESOLVIDO | compare-and-set com retry no consumir (estoque.ts). Resolvido 2026-06-26. |
| 28 | Mobile deduplica eventos por nome do produto e pode duplicar apos renomeio | Media | RESOLVIDO | Dedupe por productId em sync.ts (compras/precos/consumos). Resolvido 2026-06-26. |
| 29 | Mobile aceita preco acima do limite do endpoint de sync | Media | RESOLVIDO | MAX_PRICE_CENTS no core, validado em web/mobile. Resolvido 2026-06-26. |
| 30 | Mobile pode gravar quantidade em notacao cientifica rejeitada pelo web | Media | RESOLVIDO | buildQuantityString no core usado nos modais; +2 testes. Resolvido 2026-06-26. |
| 31 | FKs de purchase_history.source_list_id tem politica de delete conflitante | Media | DOCUMENTADO | Listas continuam arquivadas, nunca deletadas isoladamente; fluxo atual nao dispara o conflito. Revalidado 2026-07-20. |
| 32 | Rate limit confia diretamente em x-forwarded-for | Media | RESOLVIDO | Helper ipDaRequest prioriza x-real-ip (sync/casa/login). Resolvido 2026-06-26. |
| 33 | Validacao inicial de finalizacao considera tombstones antigos | Baixa | RESOLVIDO | Filtro deleted=false na validacao inicial (listas.ts). Resolvido 2026-06-26. |
| 34 | CSP cobre somente frame-ancestors e nao restringe scripts/estilos/conexoes | Baixa | PARCIAL (reaberto) | Demais headers permanecem; CSP completa segue pendente como defesa em profundidade. Relatorio 2026-07-20. |
| 35 | npm audit reporta vulnerabilidades moderadas em dependencias | Media | ABERTO (aceito) | Revalidado online: 18 moderadas no total e 14 com --omit=dev; 0 altas/criticas; alcance direto nao demonstrado. 2026-07-20. |
| 36 | Script db:migrate continua exposto apesar de migration obsoleta | Media | RESOLVIDO | Script substituido por guard que falha orientando db:push (package.json). Resolvido 2026-06-26. |
| 37 | Sync nao normaliza nem protege colisao de barcode | Media | RESOLVIDO | Barcode normalizado no schema; merge preserva local em colisao (sync.ts). Resolvido 2026-06-26. |
| 38 | Scripts administrativos imprimem token da casa e usam token em nomes de backup | Baixa | RESOLVIDO | Token mascarado por padrao (flag --show-token) e casa.id nos backups. Resolvido 2026-06-26. |
| 39 | Controles mobile usam quantidade stale em acoes rapidas | Media | REABERTO | InventoryControls foi corrigido, mas o seletor da lista ainda permite toques concorrentes sobre o mesmo valor renderizado. Relatorio 2026-07-20. |
| 40 | Nova lista ativa no mobile nao propaga tombstones offline anteriores | Media | RESOLVIDO | createNewActiveShoppingList copia tombstones recentes preservando updated_at (shoppingLists.ts). Resolvido 2026-06-26. |
| 41 | Snapshot mobile pode enviar precos legados invalidos ou excessivos | Media | RESOLVIDO | buildLocalSnapshot filtra faixa valida e top 10/produto (sync.ts). Resolvido 2026-06-26. |
| 42 | Consumo web baixa estoque antes de registrar evento/status sem rollback | Media | RESOLVIDO | try/catch desfaz claim do estoque via compare-and-set (estoque.ts). Resolvido 2026-06-26. |
| 43 | Token de acesso reaparece em texto puro nas chaves persistidas de rate limit | Alta | REABERTO | casas.invite_code_enc segue cifrada, mas login/sync/delete gravam o bearer literal em rate_limits.chave. Relatorio 2026-07-20. |
| 44 | Rate limit e lock distribuido falham aberto quando KV nao esta configurado | Alta | RESOLVIDO | Rate limit e lock de sync migrados para o Neon Postgres (tabelas rate_limits/sync_locks, rateLimit.ts); @vercel/kv removido; sem servico externo/custo. Resolvido 2026-06-27. |
| 45 | Exclusao de conta pela aplicacao nao e atomica | Alta | RESOLVIDO | excluirCasa usa db.batch (uma transacao neon-http) em modules/casa.ts. Resolvido 2026-06-27. |
| 46 | README orienta fluxo de migration que o projeto desativou | Media | RESOLVIDO | README aponta db:push com aviso de db:migrate desativado. Resolvido 2026-06-27. |
| 47 | Exclusao de conta e sincronizacao rate-limitam so por IP, sem chave por token | Alta | RESOLVIDO | sync/casa (DELETE) aplicam rateLimited por token (sync:token:/casa-del:token:) alem do IP. Resolvido 2026-07-01. |
| 48 | Painel /admin sem rate limit no Basic Auth | Media | RESOLVIDO | middleware.ts limita admin:ip: antes do Basic Auth; rateLimit.ts edge-safe (crypto.randomUUID global). Resolvido 2026-07-01. |
| 49 | Tabela rate_limits nunca e podada | Media | RESOLVIDO | Poda oportunistica em rateLimited (2%/hit apaga expirados >1h); sem cron. Resolvido 2026-07-01. |
| 50 | Comentario desatualizado sobre Vercel KV em sync/route.ts | Baixa | RESOLVIDO | Comentario reescrito para o backing Postgres (sem KV/memoria). Resolvido 2026-07-01. |
| 51 | Dependencia bcryptjs sem uso no codigo | Baixa | RESOLVIDO | bcryptjs e @types/bcryptjs removidos de apps/web (npm uninstall); lockfile sincronizado. Resolvido 2026-07-01. |
| 52 | Segredos reais existem em .env.local no workspace local | Alta | ABERTO (aceito) | Nesta auditoria somente existencia, ignore, metadata/ACL e ausencia no historico foram verificados; conteudo nao foi relido. Manter fora de backups/compartilhamentos. 2026-07-20. |
| 53 | Migracao do token para SecureStore pode deixar copia legada no SQLite | Media | PARCIAL (reaberto) | Se set seguro concluir e delete legado falhar, o early return futuro nunca repete a limpeza. Relatorio 2026-07-20. |
| 54 | Rate limit por token usa header nao validado como chave persistida | Media | RESOLVIDO | CASA_CODE_REGEX valida x-casa-code; formato invalido cai em bucket fixo "invalido" (sync/route.ts, casa/route.ts). Resolvido 2026-07-01. |
| 55 | Sync nao e paginado e limite por Content-Length nao garante progresso | Media | REABERTO | Primeira sync >10k fica presa; resposta e historico sao ilimitados; 8 MB excede o limite documentado de 4,5 MB da Vercel. Relatorio 2026-07-20. |
| 56 | Eventos offline antigos podem nunca subir para a nuvem | Media | RESOLVIDO | Primeira sincronizacao (last_sync_at nulo) envia o historico inteiro sem a janela (sync.ts). Residual: >24 meses offline ENTRE syncs continua filtrado (aceito). Resolvido 2026-07-01. |
| 57 | Falhas locais no sync mobile podem escapar sem restaurar a UI | Media | RESOLVIDO | enviarSnapshot envolve buildLocalSnapshot/json/applySnapshot em try/catch tipado; PerfilScreen usa try/finally no busy. Resolvido 2026-07-01. |
| 58 | Criacao de conta salva token antes da primeira sincronizacao completar | Media | ABERTO (aceito) | Ordem continua necessaria enquanto o POST nao for idempotente; retry pode concluir, mas UI deveria indicar backup pendente. Revalidado 2026-07-20. |
| 59 | Aplicacao de snapshot no mobile nao protege colisao de barcode | Media | RESOLVIDO | applySnapshot preserva o barcode local quando o recebido ja pertence a outro produto, espelhando o backend (sync.ts). Indice unico no SQLite fica para migracao com saneamento previo. Resolvido 2026-07-01. |
| 60 | Categoria aceita pelo sync diverge do enum validado no web | Baixa | RESOLVIDO | sync usa z.enum(CATEGORIAS).catch("Mercearia"): normaliza categoria fora do enum sem rejeitar o snapshot inteiro (sync/route.ts). Resolvido 2026-07-01. |
| 61 | Basic Auth do admin aceita credencial sem separador dois-pontos | Baixa | RESOLVIDO | middleware exige indexOf(":") != -1 antes de comparar a senha (middleware.ts). Resolvido 2026-07-01. |
| 62 | Campo mobile de alerta de estoque nao limita caracteres na UI | Baixa | RESOLVIDO | TextInput de alertThreshold usa maxLength={FIELD_LIMITS.alertThreshold} (modals.tsx). Resolvido 2026-07-01. |
| 63 | Comentario do schema de rate_limits contradiz a poda ja implementada | Baixa | RESOLVIDO | Comentario reescrito: cardinalidade nao-limitada (IP/token), limpeza e a poda oportunistica em rateLimit.ts (schema.ts). Resolvido 2026-07-01. |
| 64 | Retry de criacao/regeneracao de casa trata qualquer erro como colisao | Baixa | RESOLVIDO | ehColisaoDeCodigo restringe o retry a unique_violation (23505); demais erros propagam de imediato (casa.ts). Resolvido 2026-07-01. |
| 65 | Re-adicao de item excluido e desfeita pelo proximo sync (revive local sem un-delete no protocolo) | Media | RESOLVIDO | LWW com carimbo updated_at em purchase_history: shouldApplyIncomingDeleted no core, usado pelo merge web e applySnapshot mobile; edicoes locais carimbam. +8 testes. Requer db:push (coluna updated_at) e novo build mobile (migracao v8). Resolvido 2026-07-07. |
| 66 | Excluir compra com mais de 24 meses nunca propaga a exclusao | Media | RESOLVIDO | Tombstones de compra ignoram a janela de 24 meses no buildLocalSnapshot (sync.ts mobile). Resolvido 2026-07-07. |
| 67 | Clientes mobile antigos re-inserem como vivas as compras tombstonadas | Baixa | DOCUMENTADO | Codigo atual 1.0.3 e regra da nuvem mitigam; rollout/dispositivos antigos nao verificaveis no repositorio. Revalidado 2026-07-20. |
| 68 | Troca de casa no mobile envia dados locais da conta anterior | Alta | ABERTO | SQLite nao tem namespace de casa; unpair preserva dados e pairAndSync envia o snapshot antes de salvar o novo token. 2026-07-20. |
| 69 | Pagina publica orienta enviar a unica credencial por e-mail | Alta | RESOLVIDO | Bloco de suporte reescrito: nao pede o token e alerta para nunca envia-lo por e-mail (excluir-conta/page.tsx). Resolvido 2026-07-20. |
| 70 | Action administrativa destrutiva nao revalida autorizacao internamente | Media | RESOLVIDO | excluirCasaAction chama requireAdmin() (revalida Basic Auth por dentro); logica extraida para adminAuth.ts (Edge-safe) usada por middleware+Action. RBAC/MFA/audit-log fora de escopo (app nao tem modelo de identidade). Resolvido 2026-07-20. |
| 71 | Token bearer permanente possui apenas 40 bits de entropia | Media | ABERTO | 8 chars base32; e a unica credencial e permite exclusao. 2026-07-20. |
| 72 | Estoque absoluto com LWW perde consumos concorrentes entre devices | Media | ABERTO | Dois devices podem registrar dois eventos e convergir para apenas um decremento no saldo. 2026-07-20. |
| 73 | Eventos distintos no mesmo segundo colidem na deduplicacao | Media | ABERTO | Chave usa produto, quantidade e timestamp truncado a segundos; falta UUID por evento. 2026-07-20. |
| 74 | Snapshot aceito amplifica recursos e pode ultrapassar lease de 60 s | Media | ABERTO | Dezenas de milhares de statements; lock sem heartbeat/fencing. Risco estatico potencial. 2026-07-20. |
| 75 | API de sync aceita quantidades invalidas rejeitadas por web/mobile | Media | ABERTO | Schema limita apenas comprimento; parser canonico nao e aplicado. 2026-07-20. |
| 76 | Normalizacao Unicode diverge entre SQLite e core de sync | Media | ABERTO | NOCASE/lower SQLite e toLocaleLowerCase pt-BR nao definem a mesma unicidade. 2026-07-20. |
| 77 | Inicializacao/migrations SQLite nao sao serializadas integralmente | Media | ABERTO | DDL reexecuta por operacao e migration v3 pode avancar sem restaurar indice unique. 2026-07-20. |
| 78 | Criacao web de produto insere produto e estoque em commits separados | Media | RESOLVIDO | createProduto virou insert unico; ausencia de inventory_items tratada por coalesce e upsert na 1a op de estoque (produtos.ts). Resolvido 2026-07-20. |
| 79 | Builds EAS de desenvolvimento/preview apontam para producao | Media | PARCIAL | API_BASE_URL agora vem de EXPO_PUBLIC_API_BASE_URL por perfil (config.ts/eas.json); dev->emulador, preview->staging. Pendencia operacional: provisionar o backend/banco de staging. 2026-07-20. |
| 80 | Perfil mobile permite criar conta antes de carregar token existente | Media | ABERTO | null representa loading e unpaired; botao fica ativo durante leitura do SecureStore. 2026-07-20. |
| 81 | Decremento de quantidade fracionaria pode aumentar o valor | Media | ABERTO | Helper local transforma 0,8 kg - 1 em 1 kg e diverge do core/web. 2026-07-20. |
| 82 | Falha no bootstrap mobile e exibida como lista vazia | Media | ABERTO | catch apenas loga e finally marca todas as telas como prontas. 2026-07-20. |
| 83 | Tratamento de transporte, timeout e observabilidade e incompleto | Media | ABERTO | Sync sem timeout/validacao runtime; clientes web sem catch/finally; Actions sem logs estruturados. 2026-07-20. |
| 84 | Dados SQLite/fotos podem entrar no backup padrao do Android | Media | RESOLVIDO | android.allowBackup=false no app.json; verificar AndroidManifest gerado no proximo build EAS. Resolvido 2026-07-20. |
| 85 | Scripts gravam dumps completos em JSON sem protecao explicita | Media | PARCIAL | casas.mjs cria dir 0700/arquivo 0600 e avisa o operador (best-effort no Windows). Criptografia em repouso e retencao/expiracao automatica ficam como decisao operacional. 2026-07-20. |
| 86 | merge-produtos nao preserva/converge todo o estado | Media | ABERTO | Nao deduplica consumos, perde lista/estoque B, conta tombstones e nao cria alias/tombstone de identidade. 2026-07-20. |
| 87 | Consultas e indices nao acompanham historico/rate limit em crescimento | Media | ABERTO | Sem paginacao; indices por casa/data/reset ausentes; agregado varre todos tenants. Confirmar com EXPLAIN real. 2026-07-20. |
| 88 | Web e mobile nao possuem testes de fluxos criticos | Media | ABERTO | 46 testes apenas no core; CI usa if-present e mede nenhuma cobertura de aplicacao. 2026-07-20. |
| 89 | Variaveis criticas nao possuem schema central de ambiente | Media | RESOLVIDO | server/env.ts centraliza schema/validacao (lazy por campo) de DATABASE_URL, AUTH_SECRET/NEXTAUTH_SECRET e INVITE_TOKEN_SECRET; consumidores importam de la. ADMIN_SECRET validado em adminAuth.ts (Edge-safe). Resolvido 2026-07-20. |
| 90 | POST/DELETE de conta nao sao idempotentes perante resposta perdida | Media | ABERTO | Retry pode criar casa orfa ou deixar aparelho pareado com conta ja excluida. Risco potencial. 2026-07-20. |
| 91 | Criacao de casa aceita disparo cross-origin sem preflight | Baixa | RESOLVIDO | POST /api/casa exige content-type application/json e valida Origin contra NEXTAUTH_URL quando presente; mobile (application/json, sem Origin) nao afetado. Resolvido 2026-07-20. |
| 92 | Controles/modais falham em semantica, foco, alvo de toque e contraste | Baixa | ABERTO | Falhas estaticas web/mobile; requer leitor de tela/dispositivo para validacao final. 2026-07-20. |
| 93 | Metadados simulados aparecem como dados reais na lista mobile | Baixa | RESOLVIDO | productMeta hardcoded removido; meta derivado de categoria/quantidade reais (shoppingListPresentation.ts). Resolvido 2026-07-20. |
| 94 | Fotos persistentes ficam orfas apos edicao/exclusao | Baixa | ABERTO | persistPhoto so copia; nao ha delete/garbage collection rastreado. 2026-07-20. |
| 95 | Politica de privacidade omite Open Food Facts | Baixa | RESOLVIDO | Secao dedicada divulga a consulta ao Open Food Facts (codigo+IP, sem dados da conta) na politica. Resolvido 2026-07-20. |
| 96 | Pipeline build/CI tem fragilidades de reprodutibilidade e hardening | Baixa | ABERTO | Expo patch/Metro falham doctor; fonte exige rede; middleware deprecated; CI sem permissions minimo/pin SHA/scans. 2026-07-20. |
| 97 | Nomes podem injetar sequencias de controle no terminal dos CLIs | Baixa | PARCIAL | casas.mjs sanitiza C0/C1/ANSI/bidi (por code point) na saida; falta aplicar em merge-produtos.mjs (lote de scripts). 2026-07-20. |
| 98 | Documentacao diverge da arquitetura/configuracao atual | Baixa | RESOLVIDO | README (raiz) documenta ADMIN_SECRET no deploy; README/ROADMAP/decisions mobile refletem sync via API Next/Neon (nao Firebase). Resolvido 2026-07-20. |
