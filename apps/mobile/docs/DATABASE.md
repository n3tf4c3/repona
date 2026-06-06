# Database

Planejamento inicial do banco de dados do Repona. O MVP deve usar Expo SQLite como banco local, mantendo a estrutura preparada para sincronizacao futura com Firestore.

## Entidades Iniciais

### Product

Representa um produto cadastrado pela familia.

- `id`
- `name`
- `barcode`
- `category`
- `photoUri`
- `purchaseCount`
- `status`
- `alertThreshold`
- `createdAt`
- `updatedAt`

### ShoppingList

Representa uma lista de compras.

- `id`
- `name`
- `status`
- `createdAt`
- `updatedAt`

### ShoppingListItem

Representa um item dentro de uma lista de compras.

- `id`
- `shoppingListId`
- `productId`
- `quantity`
- `checked`
- `createdAt`
- `updatedAt`

### PurchaseHistory

Representa um registro de compra realizada.

- `id`
- `productId`
- `quantity`
- `purchasedAt`
- `sourceListId`

### InventoryItem

Representa a quantidade atual de um produto em casa.

- `id`
- `productId`
- `quantity`
- `status`
- `createdAt`
- `updatedAt`

### InventoryEvent

Representa um evento local de mudanca no estoque domestico.

- `id`
- `productId`
- `eventType`
- `quantity`
- `occurredAt`

## Evolucao Futura

- Entidade de familia ou casa.
- Vinculo entre usuarios e familia.
- Metadados de sincronizacao para Firestore.
- Eventos de consumo para sugestoes futuras.

## Diretrizes

- Comecar simples com SQLite local.
- Evitar dependencia de nuvem no MVP.
- Manter identificadores estaveis para facilitar sincronizacao futura.
- Registrar datas importantes para permitir analise de habitos de consumo.

## Estado Atual

Implementado:

- Criacao das tabelas iniciais com Expo SQLite.
- Persistencia real de `Product`.
- Edicao e remocao de `Product`, com bloqueio de remocao quando ha historico associado.
- Persistencia real da lista ativa em `ShoppingList`.
- Persistencia real de itens em `ShoppingListItem`.
- Atualizacao de quantidade em `ShoppingListItem`.
- Remocao de `ShoppingListItem`.
- Persistencia real de `PurchaseHistory` ao finalizar a lista.
- Listagem do historico com dados reais do SQLite.
- Incremento de `purchaseCount` do produto ao registrar compra.
- Persistencia local de `InventoryItem` por produto.
- Atualizacao manual de estoque pela tela de produtos.
- Atualizacao de estoque ao finalizar compras marcadas.
- Registro local de consumo em `InventoryEvent`.
- Alertas simples derivados de `InventoryItem` na UI.
- Priorizacao e descricao de alertas com base em `InventoryEvent`.
- Limiar de alerta por produto em `Product`.
- Sugestao local de recompra derivada de estoque, historico, consumo e lista ativa.
- Seed inicial de produtos recorrentes.
- Seed inicial da lista ativa.
- Validacao simples de duplicidade por nome.
- Validacao do app em Expo Go, emulador ou dispositivo Android feita pelo usuario.

Ainda pendente:

- Melhorar explicacao e configuracao das sugestoes de recompra.
