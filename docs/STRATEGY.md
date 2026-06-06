# Strategy

Estrategia inicial do Repona para transformar uma necessidade domestica recorrente em um aplicativo simples, util e evolutivo.

## Problema

Familias fazem compras de supermercado de forma recorrente, mas frequentemente esquecem itens, compram produtos duplicados ou nao sabem exatamente o que ja existe em casa.

## Publico-Alvo

- Familias que compartilham responsabilidades de compra.
- Pessoas que fazem compras recorrentes no supermercado.
- Casas que querem reduzir desperdicio e melhorar organizacao.

## Proposta de Valor

O Repona centraliza produtos, listas, historico e futuramente estoque domestico para facilitar decisoes de compra e antecipar necessidades com base em habitos reais.

## Estrategia de MVP

O MVP deve evitar complexidade de sincronizacao e inteligencia no inicio. A prioridade e validar o fluxo basico:

- Cadastrar produtos manualmente.
- Criar e usar uma lista de compras.
- Registrar historico de compras.
- Persistir dados localmente com SQLite.

## Estado de Implementacao

O app usa Expo/React Native em TypeScript, com telas baseadas no handoff de design e os fluxos principais conectados ao Expo SQLite local.

Ja estao implementados o cadastro de produtos, lista ativa, historico real de compras, edicao/remocao de produtos, busca/filtro por categoria, captura rapida por codigo de barras ou foto e estoque domestico local com consumo registrado.

O proximo passo estrategico e continuar a Fase 3 com alertas simples de estoque baixo ou ruptura, ainda sem adicionar nuvem ou inteligencia neste momento.

## Diferenciais Futuros

- Controle de estoque domestico.
- Compartilhamento familiar.
- Sugestoes inteligentes de recompra.
- Alertas de falta com base no historico e no estoque.

## Principios de Desenvolvimento

- Entregar valor incremental.
- Priorizar simplicidade no MVP.
- Separar claramente dados locais e sincronizacao futura.
- Validar experiencia antes de adicionar automacoes.
