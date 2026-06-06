# Releases

Registro de entregas e marcos do Repona.

## 2026-06-05 - Scaffold Expo e Design React Native

Primeira implementacao visual do app baseada no handoff `Repona-handoff.zip`, agora em Expo/React Native.

Entregue:

- Remocao dos arquivos da base tecnica anterior.
- Scaffold Expo com React Native e TypeScript.
- Tema visual Repona com paleta do handoff.
- Tela inicial/resumo.
- Tela de lista de compras.
- Tela de produtos cadastrados.
- Tela de historico.
- Tela de perfil/futuro.
- Bottom navigation com acao central.
- Bottom sheet de cadastro de produto.
- Componentes visuais para produtos, lista, estados, chips, busca e sugestoes.

Observacoes:

- As telas usam dados mockados.
- SQLite ainda nao foi implementado.
- Dependencias instaladas com `npm install`.
- TypeScript validado com `npx tsc --noEmit`.
- Compatibilidade Expo validada com `npx expo install --check`.
- Configuracao Expo validada com `npx expo config --type public`.

## 2026-06-06 - Atualizacao para Expo SDK 54

Atualizacao feita para compatibilidade com a versao atual do Expo Go instalada no aparelho.

Entregue:

- Expo atualizado para SDK 54.
- Dependencias React Native/Expo alinhadas com `npx expo install --check`.
- `babel-preset-expo` adicionado e alinhado ao SDK 54.
- Reinstalacao limpa de `node_modules` e `package-lock.json`.
- TypeScript validado com `npx tsc --noEmit`.
- Configuracao Expo validada com `npx expo config --type public`.
- Bundle Android de desenvolvimento validado com `npx expo export --platform android --no-bytecode --clear`.

Observacoes:

- `npm audit` ainda reporta vulnerabilidades transitivas moderadas em dependencias do ecossistema Expo; corrigir com `--force` pode atualizar para outro SDK e quebrar compatibilidade com o Expo Go instalado.

## 2026-06-06 - Persistencia Inicial de Produtos

Primeira etapa do MVP funcional local.

Entregue:

- `expo-sqlite` instalado.
- Tabelas locais iniciais criadas para produtos, listas, itens de lista e historico.
- Seed inicial de produtos recorrentes.
- Listagem de produtos conectada ao SQLite.
- Cadastro manual de produto salvando no SQLite.
- Validacao de nome obrigatorio e produto duplicado.
- TypeScript validado com `npx tsc --noEmit`.
- Compatibilidade Expo validada com `npx expo install --check`.
- Bundle Android de desenvolvimento validado com `npx expo export --platform android --no-bytecode --clear`.

Ainda pendente:

- Persistir lista de compras.
- Persistir historico.
- Editar/remover produtos.

## 2026-06-06 - Persistencia da Lista Ativa

Segunda etapa do MVP funcional local.

Entregue:

- Repositorio SQLite para lista ativa.
- Criacao automatica da lista `Compra da Semana`.
- Seed inicial de itens da lista.
- Tela de lista de compras conectada ao SQLite.
- Botao `+` do card de produto adicionando o produto a lista ativa.
- Marcacao/desmarcacao de item comprado persistida no SQLite.
- Contador e progresso da lista ativa calculados a partir dos dados reais.
- TypeScript validado com `npx tsc --noEmit`.
- Compatibilidade Expo validada com `npx expo install --check`.

Ainda pendente:

- Editar quantidade dos itens.
- Remover itens da lista.
- Finalizar compra e registrar historico real.
