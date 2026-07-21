import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Consistência doc↔fonte (auditoria #98): a política pública não pode divulgar
// um comprimento de token diferente do gerado de fato. Lê os arquivos como texto
// (casa.ts tem "server-only" e não pode ser importado num teste tsx puro) e
// cruza CASA_CODE_LEN com o "token de N caracteres" da página.
const dir = fileURLToPath(new URL(".", import.meta.url));

test("política divulga o mesmo comprimento de token que casa.ts gera", () => {
  const casaSrc = readFileSync(`${dir}../../server/modules/casa.ts`, "utf8");
  const m = casaSrc.match(/CASA_CODE_LEN\s*=\s*(\d+)/);
  assert.ok(m, "CASA_CODE_LEN não encontrado em casa.ts");
  const len = m![1];

  const pageSrc = readFileSync(`${dir}page.tsx`, "utf8");
  assert.match(
    pageSrc,
    new RegExp(`token de ${len}\\s*\\n?\\s*caracteres`),
    `A política de privacidade deve dizer "token de ${len} caracteres"`
  );
});
