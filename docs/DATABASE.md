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

## Evolucao Futura

- Entidade de estoque domestico.
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
- Persistencia real da lista ativa em `ShoppingList`.
- Persistencia real de itens em `ShoppingListItem`.
- Seed inicial de produtos recorrentes.
- Seed inicial da lista ativa.
- Validacao simples de duplicidade por nome.

Ainda pendente:

- Persistencia real de `PurchaseHistory`.
