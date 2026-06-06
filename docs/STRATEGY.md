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

A primeira entrega tecnica priorizou a experiencia visual antes da persistencia. O app agora usa Expo/React Native em TypeScript, com telas baseadas no handoff de design e dados mockados para validar hierarquia, fluxo e componentes.

O proximo passo estrategico e transformar essa experiencia visual em MVP funcional local, conectando as telas ao Expo SQLite sem adicionar nuvem, scanner ou inteligencia neste momento.

## Diferenciais Futuros

- Cadastro rapido por codigo de barras.
- Cadastro por foto.
- Compartilhamento familiar.
- Sugestoes inteligentes de recompra.
- Controle de estoque domestico.

## Principios de Desenvolvimento

- Entregar valor incremental.
- Priorizar simplicidade no MVP.
- Separar claramente dados locais e sincronizacao futura.
- Validar experiencia antes de adicionar automacoes.
