# Repona

Repona e um aplicativo Android para ajudar familias a gerenciar compras recorrentes de supermercado, reduzindo esquecimentos, compras duplicadas e falta de controle sobre itens usados no dia a dia.

## Objetivo

Criar uma experiencia simples para cadastrar produtos, montar listas de compras, registrar historico e evoluir para um controle inteligente de estoque domestico com apoio de scanner, fotos e sugestoes baseadas em habitos de consumo.

## Proposta

- Cadastro de produtos
- Scanner de codigo de barras
- Cadastro por foto
- Historico de compras
- Lista inteligente
- Controle de estoque domestico
- Compartilhamento familiar
- Sugestoes futuras baseadas em habitos de consumo

## Tecnologias Previstas

- Expo
- React Native
- TypeScript
- Expo SQLite
- Expo Camera
- Firebase Auth
- Firestore
- Expo Notifications

## MVP

O primeiro marco do Repona deve focar em uso local e funcionalidades essenciais:

- Cadastro manual de produtos
- Lista de compras
- Historico de compras
- Banco local com SQLite

## Estado Atual

O projeto agora possui um app Expo/React Native em TypeScript, com a primeira implementacao visual baseada no handoff `Repona-handoff.zip`.

Implementado nesta etapa:

- Estrutura Expo limpa, sem pastas nativas `android/` ou `ios/` geradas.
- Tema visual Repona com paleta quente de supermercado/domestica.
- Telas React Native mockadas para inicio, lista de compras, produtos, historico e perfil/futuro.
- Bottom navigation com acao central de novo produto.
- Bottom sheet de cadastro manual de produto.
- Componentes visuais para cards, chips, busca, itens comprados, estado "em falta" e sugestao de recompra.
- Persistencia local inicial com Expo SQLite para produtos.
- Seed inicial de produtos recorrentes no primeiro uso.
- Cadastro real de produto com validacao de nome obrigatorio e duplicidade.
- Lista de compras ativa persistida no SQLite.
- Botao `+` do produto adicionando item a lista ativa.
- Marcacao de item comprado persistida localmente.
- Edicao de quantidade dos itens da lista.
- Remocao de itens da lista.
- Finalizacao da lista registrando as compras no historico real.
- Tela de historico conectada ao SQLite com dados reais.
- Edicao e remocao de produtos cadastrados.
- Cadastro de produto por codigo de barras e por foto com Expo Camera.
- Busca de produtos por nome e filtro por categoria.
- Estoque domestico local com quantidade e estado por produto.
- Controles de estoque na tela de produtos para aumentar, reduzir e marcar item em falta.
- Finalizacao da lista atualizando o estoque dos itens comprados.
- Registro local de consumo de estoque pela tela de produtos.
- Alertas simples de estoque baixo ou em falta na tela inicial.
- Alertas priorizados e descritos com base no ultimo consumo local.
- Limiar de alerta configuravel por produto.
- Sugestao local de recompra com base em estoque, consumo, compras e lista ativa.
- Validacao do app em Expo Go, emulador ou build Android feita pelo usuario.

Com isso a Fase 1 (MVP local) e a Fase 2 (captura rapida) do roadmap estao implementadas, e a Fase 3 (estoque domestico) foi iniciada.

Ainda pendente:

- Fase 3: melhoria das sugestoes de recompra e preparacao para compartilhamento familiar.

## Estrutura Inicial

- `App.tsx`: entrada do aplicativo Expo/React Native.
- `src/`: tema, dados mockados e tipos do app.
- `package.json`: scripts e dependencias Expo.
- `app.json`: configuracao do projeto Expo.
- `docs/`: documentacao de apoio, ideias, decisoes, arquitetura e releases.
- `.opencode/skills/karpathy-guidelines/SKILL.md`: skill compartilhada para agentes OpenCode.
- `CLAUDE.md`: diretrizes persistentes para assistentes de codigo no projeto.

## Executar

Instale as dependencias e rode com Expo.

Requisitos esperados:

- Node.js LTS.
- npm.
- Expo Go ou emulador Android/iOS.

Comandos:

```bash
npm install
npm run start
```

Para abrir direto no Android:

```bash
npm run android
```

## Documentacao

- [Backlog](docs/BACKLOG.md): lista de funcionalidades e tarefas.
- [Database](docs/DATABASE.md): planejamento do modelo de dados local e futuro.
- [Roadmap](docs/ROADMAP.md): fases de evolucao do produto.
- [Strategy](docs/STRATEGY.md): estrategia de produto e desenvolvimento.
- [Architecture](docs/architecture.md): arquitetura atual e proxima arquitetura do MVP.
- [Decisions](docs/decisions.md): decisoes tecnicas e de produto registradas.
- [Releases](docs/releases.md): historico de entregas do projeto.

## Padronizacao de Assistentes

O arquivo `CLAUDE.md` deve ficar na raiz para ser encontrado por ferramentas compativeis com instrucoes de projeto. O arquivo `SKILL.md` nao deve ficar solto na raiz; para OpenCode, a estrutura padrao e `.opencode/skills/<nome-da-skill>/SKILL.md`.
