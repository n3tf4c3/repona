# Backlog

Backlog inicial do Repona com foco no MVP e na evolucao planejada do produto.

## Concluido Nesta Atualizacao

- Remover scaffold tecnico anterior.
- Criar estrutura Expo/React Native com TypeScript.
- Implementar tema visual Repona em React Native.
- Implementar tela inicial/resumo com lista ativa, acoes rapidas e sugestao.
- Implementar tela visual de lista de compras com itens marcaveis.
- Implementar tela visual de produtos cadastrados com busca e filtros.
- Implementar tela visual de historico de compras.
- Implementar bottom sheet visual de cadastro manual de produto.
- Implementar navegacao inferior com acao central.
- Atualizar `.gitignore` para ambiente Expo.
- Instalar Expo SQLite.
- Criar tabelas locais iniciais para produtos, listas, itens e historico.
- Criar seed inicial de produtos.
- Persistir cadastro manual de produto.
- Listar produtos reais salvos no SQLite.
- Validar duplicidade de produto por nome.
- Criar lista ativa padrao no SQLite.
- Persistir itens da lista de compras.
- Adicionar produto a lista ativa pelo botao `+` do card.
- Persistir marcacao de item comprado.
- Persistir edicao de quantidade dos itens da lista.
- Remover itens da lista ativa.
- Finalizar lista e registrar compras no historico real.
- Incrementar contagem de compra do produto ao finalizar.
- Conectar tela de historico ao SQLite com dados reais.
- Editar produto cadastrado.
- Remover produto cadastrado (bloqueado quando ha historico).
- Integrar `expo-camera` com permissoes.
- Cadastrar produto por codigo de barras.
- Capturar foto do produto no cadastro.
- Buscar produtos por nome e filtrar por categoria.
- Criar entidade local de estoque domestico no SQLite.
- Exibir e atualizar quantidade em casa na tela de produtos.
- Marcar produto como em falta pelo estoque.
- Atualizar estoque ao finalizar compra.
- Registrar consumo local de estoque pela tela de produtos.
- Exibir alertas simples de estoque baixo ou em falta na tela inicial.
- Priorizar e descrever alertas com base no ultimo consumo local.
- Configurar limiar de alerta por produto.
- Validar o app com Expo Go ou emulador.

## MVP Funcional

- Concluido para o MVP local.

## Produto

- Definir fluxo principal de uso familiar.
- Definir categorias iniciais de produtos.
- Definir estados de um item: planejado, comprado, consumido e em falta.
- Preparar sugestoes de recompra com base em estoque e historico.
- Avaliar modelo de organizacao por casa ou familia.

## Integracoes Futuras

- Autenticacao com Firebase Auth.
- Sincronizacao com Firestore.
- Notificacoes com Expo Notifications.

## Inteligencia

- Calcular frequencia de compra por produto.
- Sugerir recompra de itens recorrentes.
- Detectar possivel ruptura de estoque domestico.
- Priorizar sugestoes por historico e categoria.
