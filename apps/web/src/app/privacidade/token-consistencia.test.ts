import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CASA_CODE_LENGTH } from "@repona/core";

// Consistência doc↔fonte (auditoria #98): a política pública não pode divulgar
// um comprimento de token diferente do gerado de fato. Lê os arquivos como texto
// (casa.ts tem "server-only" e não pode ser importado num teste tsx puro) e
// cruza o contrato compartilhado com o "token de N caracteres" da página.
const dir = fileURLToPath(new URL(".", import.meta.url));

test("política divulga o mesmo comprimento seguro do contrato compartilhado", () => {
  const pageSrc = readFileSync(`${dir}page.tsx`, "utf8");
  assert.match(
    pageSrc,
    new RegExp(`token de ${CASA_CODE_LENGTH}\\s*\\n?\\s*caracteres`),
    `A política de privacidade deve dizer "token de ${CASA_CODE_LENGTH} caracteres"`
  );
});
