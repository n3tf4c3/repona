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

## Fase 1: MVP Local Funcional

- Completar repositorio local de historico.
- Permitir editar quantidade e remover itens da lista.
- Registrar historico de compras ao finalizar lista.
- Validar fluxo em Expo Go e emulador/dispositivo Android.

## Fase 2: Captura Rapida de Produtos

- Integrar Expo Camera.
- Permitir cadastro por codigo de barras.
- Explorar cadastro por foto.

## Fase 3: Estoque Domestico

- Controlar quantidade de itens em casa.
- Marcar produtos como comprados, consumidos ou em falta.
- Relacionar historico de compras com estoque atual.

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
