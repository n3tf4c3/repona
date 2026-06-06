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
