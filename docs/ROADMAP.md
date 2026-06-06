# Roadmap

Roadmap inicial do Repona, organizado para entregar valor cedo e evoluir gradualmente para recursos inteligentes e colaborativos.

## Fase 0: Design React Native e Scaffold Expo

Status: implementado visualmente.

- Criar estrutura Expo/React Native com TypeScript.
- Remover artefatos da base tecnica anterior.
- Portar o handoff visual para React Native.
- Implementar telas mockadas de inicio, lista, produtos, historico e perfil/futuro.
- Implementar bottom sheet de novo produto e navegacao inferior.
- Implementar persistencia inicial de produtos com Expo SQLite.
- Implementar persistencia da lista ativa e marcacao de itens comprados.
- Implementar edicao de quantidade e remocao de itens da lista ativa.

## Fase 1: MVP Local Funcional

Status: implementado e validado pelo usuario.

- Completar repositorio local de historico.
- Registrar historico de compras ao finalizar lista.
- Conectar tela de historico aos dados reais.
- Editar e remover produtos cadastrados.
- Validar fluxo em Expo Go e emulador/dispositivo Android.

## Fase 2: Captura Rapida de Produtos

Status: implementado.

- Integrar Expo Camera.
- Permitir cadastro por codigo de barras.
- Explorar cadastro por foto.
- Buscar e filtrar produtos por categoria.

## Fase 3: Estoque Domestico

Status: iniciado.

- Controlar quantidade de itens em casa. (implementado inicial)
- Marcar produtos como em falta. (implementado inicial)
- Relacionar historico de compras com estoque atual. (parcial: finalizacao da lista atualiza estoque)
- Registrar consumo de itens em casa. (implementado inicial)
- Alertar estoque baixo ou ruptura na tela inicial. (implementado inicial)
- Refinar regras de alerta com historico de consumo. (implementado inicial)
- Definir limiares de alerta por produto. (implementado inicial)
- Preparar sugestoes de recompra com base em estoque e historico. (pendente)

## Fase 4: Compartilhamento Familiar

- Integrar Firebase Auth.
- Sincronizar dados familiares com Firestore.
- Permitir multiplos usuarios em uma mesma familia.
- Notificar atualizacoes relevantes com Expo Notifications.

## Fase 5: Inteligencia e Sugestoes

- Identificar padroes de consumo.
- Sugerir itens recorrentes para a lista.
- Alertar possiveis faltas antes da proxima compra.
- Melhorar recomendacoes com base no historico.
