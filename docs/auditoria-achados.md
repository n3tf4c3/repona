# Ledger de Achados de Auditoria

Fonte versionada para manter a numeracao continua dos achados. Relatorios completos ficam fora do repositorio em `C:\Codes\relatorios\repona`.

> Numeracao **reiniciada em 1** em 2026-07-22 por decisao explicita do usuario (auditoria refeita do zero; ledger e relatorios anteriores apagados). O git log ainda cita "achado N" de ciclos antigos — esses numeros NAO correspondem a esta tabela.

| # | Achado | Severidade | Status | Observacao |
|---|---|---|---|---|
| 1 | Criacao de conta na nuvem nao e mais idempotente no servidor; resposta perdida gera casa orfa e duplica no retry | Media | RESOLVIDO (risco residual aceito/documentado) | Resolvido 2026-07-22 pelo caminho (a): mobile nao promete mais idempotencia que o servidor nao honra (removidos headers `Idempotency-Key`/`x-operation-verifier` e a maquina de `verifier`/`operationId` de create). O risco de casa orfa em resposta perdida (inerente a create nao-idempotente, barrado pelo rate limit, sem dado do usuario) fica ACEITO e documentado em `syncClient.ts:criarContaUnsafe`. `syncClient.ts`, `accountFlowState.ts`, `accountOperations.ts`. |
| 2 | Variavel nao usada quebra o passo Lint do CI | Media | RESOLVIDO | Removida a linha `const backupLists` (nunca lida) em `restore-backup.mjs`; `npm run lint` verde -> gate Lint do CI de volta. Resolvido 2026-07-22. |
| 3 | Codigo morto residual da simplificacao da credencial no mobile | Baixa | RESOLVIDO | Removida a maquinaria inerte de verifier/idempotencia de conta (funcoes em `accountOperations`, chave `CREATE_ACCOUNT_OPERATION_KEY`, estado `pending-create-request`, headers mortos) + testes. Net -229 linhas no mobile. Resolvido 2026-07-22. |
