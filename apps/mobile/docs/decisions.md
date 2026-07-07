# Decisions

Decisoes tecnicas e de produto registradas durante a evolucao do Repona.

## 2026-06-05 - Usar Expo/React Native

Decisao: seguir com Expo/React Native em TypeScript como base principal do app.

Motivo:

- O projeto ainda esta no inicio, entao o custo de trocar a base tecnica e baixo.
- O desenvolvedor tem mais familiaridade com Expo.
- Expo acelera a validacao do MVP e reduz atrito para camera, scanner, notificacoes e Firebase no futuro.
- O design do handoff pode ser implementado sem gerar pastas nativas `android/` ou `ios/` neste momento.

Consequencias:

- A trilha nativa anterior deixa de ser o caminho principal.
- A persistencia local prevista passa a ser Expo SQLite.
- Camera e scanner devem usar Expo Camera na fase futura.
- Builds nativos devem ser feitos via Expo/EAS quando necessario.

## 2026-06-05 - Manter MVP Offline

Decisao: manter o foco inicial em app local/offline, sem Firebase, Firestore, scanner ou sugestoes reais.

Motivo:

- A estrategia do projeto prioriza simplicidade no MVP.
- Sincronizacao familiar e inteligencia exigem modelo de dados mais maduro.
- O valor principal inicial e cadastrar produtos, montar lista e registrar historico localmente.

Consequencias:

- Firebase e sincronizacao permanecem como integracoes futuras.
- Expo SQLite sera a proxima dependencia funcional importante.

## 2026-07-07 - Aceitar janela de compatibilidade dos tombstones de compra em clientes antigos (auditoria #67)

Decisao: aceitar que apps mobile <=1.0.2 re-insiram localmente, como vivas, compras tombstonadas que o servidor devolve no snapshot, sem mitigacao no servidor.

Motivo:

- O servidor precisa devolver tombstones no snapshot para a exclusao propagar entre devices; clientes antigos ignoram o campo `deleted` e tratam o evento como compra normal.
- O efeito e transitorio e se auto-cura: apos atualizar o app, o proximo sync re-marca as copias locais como excluidas (regra "tombstone/LWW" do merge). A nuvem nunca e corrompida - o merge nao ressuscita tombstones a partir de compras vivas sem carimbo.
- O app esta em teste fechado na Play Store; a populacao de clientes antigos e pequena e controlada.
- A alternativa (omitir tombstones para clientes que nao enviaram `deleted` no request) adiciona heuristica de versao no servidor por um problema temporario.

Consequencias:

- Coordenar o rollout: publicar o mobile 1.0.3 junto com (ou logo apos) o deploy do web que passou a devolver tombstones.
- Num device com app antigo, compras excluidas em outro device podem reaparecer ate o update - comportamento conhecido e aceito.
