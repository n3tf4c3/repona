# Architecture

Arquitetura atual do Repona apos a migracao para Expo/React Native e conclusao do MVP local.

## Visao Geral

O projeto contem um app Expo com React Native e TypeScript. A interface foi baseada no handoff `Repona-handoff.zip` e hoje ja conecta os fluxos principais ao SQLite local.

Nao ha pastas nativas `android/` ou `ios/` geradas. A intencao e manter o projeto no fluxo managed do Expo enquanto o MVP estiver sendo validado.

A persistencia local existe para produtos, lista ativa, itens da lista, historico de compras e estoque domestico com Expo SQLite.

## Estrutura

- `App.tsx`: entrada do app, navegacao local por estado, telas e componentes visuais.
- `src/theme.ts`: tokens visuais, cores, tipografia, raios e sombras.
- `src/data.ts`: dados auxiliares de UI e copia de recursos futuros; parte dos mocks antigos permanece sem uso nos fluxos principais.
- `src/types.ts`: tipos compartilhados da UI.
- `src/storage/database.ts`: abertura do SQLite e criacao das tabelas iniciais.
- `src/storage/products.ts`: seed, listagem, cadastro, edicao e remocao de produtos.
- `src/storage/shoppingLists.ts`: lista ativa, seed de itens, adicao de produto, marcacao de comprado, quantidade, remocao e finalizacao da compra.
- `src/storage/purchaseHistory.ts`: listagem do historico registrado no SQLite.
- `src/storage/inventory.ts`: atualizacao local de quantidade, estado de estoque e eventos de consumo por produto.
- `src/productPresentation.ts`: conversao de registros do banco para cards visuais.
- `src/shoppingListPresentation.ts`: conversao dos itens salvos para linhas visuais da lista.
- `package.json`: scripts e dependencias Expo.
- `app.json`: configuracao do projeto Expo.
- `babel.config.js`: preset do Expo.
- `tsconfig.json`: configuracao TypeScript.

## Camada Visual Atual

A UI atual implementa:

- Tela inicial com lista ativa, acoes rapidas, alertas simples de estoque, sugestao de recompra e produtos recorrentes.
- Tela de lista de compras com dados do SQLite, progresso, agrupamento por categoria, item comprado, item em falta, quantidade editavel e remocao.
- Tela de produtos com busca visual, chips de categoria, cards vindos do SQLite e controles compactos de estoque/consumo.
- Tela de historico com compras anteriores registradas no SQLite e estado vazio.
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

A implementacao atual usa SQLite para produtos, lista ativa, itens da lista, historico e estoque domestico. A finalizacao da lista registra os itens comprados em `purchase_history`, incrementa a contagem de compra do produto, atualiza `inventory_items` e remove os itens comprados da lista ativa. O consumo manual registra eventos em `inventory_events`, reduz a quantidade local e alimenta a priorizacao dos alertas.

Com o MVP local concluido, a recomendacao e evoluir gradualmente:

- limiares de alerta configuraveis por produto;
- regras de produto/lista/estoque para hooks ou stores quando a tela crescer;
- acesso a dados para repositorios locais.

## Evolucao Arquitetural Recomendada

Para as proximas etapas, a estrutura sugerida continua sendo uma separacao incremental:

- `src/storage`: conexao SQLite, migrations e queries.
- `src/repositories`: repositorios locais.
- `src/screens`: telas separadas por fluxo.
- `src/components`: componentes reutilizaveis.
- `src/theme`: tokens de cor, tipografia e tema, caso o tema cresca.
- `src/state`: hooks e modelos de estado de tela.

Essa separacao deve ser feita de forma incremental, conforme os fluxos de estoque, sincronizacao e inteligencia aumentarem de tamanho.
