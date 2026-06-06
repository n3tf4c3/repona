# Architecture

Arquitetura atual do Repona apos a migracao para Expo/React Native.

## Visao Geral

O projeto contem um app Expo com React Native e TypeScript. A implementacao atual e uma camada visual mockada baseada no handoff `Repona-handoff.zip`.

Nao ha pastas nativas `android/` ou `ios/` geradas. A intencao e manter o projeto no fluxo managed do Expo enquanto o MVP estiver sendo validado.

A persistencia local inicial ja existe para produtos e lista ativa com Expo SQLite. O historico ainda usa dados mockados e entra na proxima etapa do MVP funcional.

## Estrutura

- `App.tsx`: entrada do app, navegacao local por estado, telas e componentes visuais.
- `src/theme.ts`: tokens visuais, cores, tipografia, raios e sombras.
- `src/data.ts`: dados mockados usados para validar o design.
- `src/types.ts`: tipos compartilhados da UI.
- `src/storage/database.ts`: abertura do SQLite e criacao das tabelas iniciais.
- `src/storage/products.ts`: seed, listagem e cadastro de produtos.
- `src/storage/shoppingLists.ts`: lista ativa, seed de itens, adicao de produto e marcacao de comprado.
- `src/productPresentation.ts`: conversao de registros do banco para cards visuais.
- `src/shoppingListPresentation.ts`: conversao dos itens salvos para linhas visuais da lista.
- `package.json`: scripts e dependencias Expo.
- `app.json`: configuracao do projeto Expo.
- `babel.config.js`: preset do Expo.
- `tsconfig.json`: configuracao TypeScript.

## Camada Visual Atual

A UI atual implementa:

- Tela inicial com lista ativa, acoes rapidas, sugestao de recompra e produtos recorrentes.
- Tela de lista de compras com dados do SQLite, progresso, agrupamento por categoria, item comprado e item em falta.
- Tela de produtos com busca visual, chips de categoria e cards vindos do SQLite.
- Tela de historico com compras anteriores e resumo de itens.
- Tela de perfil/futuro com recursos planejados.
- Bottom sheet de novo produto.
- Bottom navigation com botao central de acao.

## Tokens Visuais

As cores do handoff foram convertidas para tokens React Native em `src/theme.ts`:

- `primary`: verde folha principal.
- `amber`: acento domestico quente.
- `coral`: estado em falta/alerta.
- `indigo`: sugestoes inteligentes.
- `bg`, `surface`, `ink`: base neutra, superficie e texto.

## Decisao de Escopo Atual

A implementacao atual usa SQLite para produtos e lista ativa. O historico continua mockado. Isso permite validar a persistencia gradualmente sem reescrever todo o fluxo de uma vez.

Para completar o MVP funcional com SQLite, a recomendacao e mover gradualmente:

- dados mockados restantes do historico para modelos de UI;
- regras de produto/lista para hooks ou stores;
- persistencia de historico para Expo SQLite;
- acesso a dados para repositorios locais.

## Proxima Arquitetura do MVP

Para a proxima etapa, a estrutura sugerida e:

- `src/storage`: conexao SQLite, migrations e queries.
- `src/repositories`: repositorios locais.
- `src/screens`: telas separadas por fluxo.
- `src/components`: componentes reutilizaveis.
- `src/theme`: tokens de cor, tipografia e tema, caso o tema cresca.
- `src/state`: hooks e modelos de estado de tela.

Essa separacao deve ser feita de forma incremental, conforme os fluxos deixarem de ser mockados.
