import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Guarda de configuração (auditoria #79): impede que um perfil de build que não é
// produção aponte para o backend de produção. Um build dev/preview que envie
// token/snapshot para https://repona.vercel.app contaminaria os dados reais.
// Lê eas.json e cruza os EXPO_PUBLIC_API_BASE_URL por perfil.
const dir = path.dirname(fileURLToPath(import.meta.url));
const easPath = path.join(dir, "..", "eas.json");
const eas = JSON.parse(readFileSync(easPath, "utf8")) as {
  build: Record<string, { env?: { EXPO_PUBLIC_API_BASE_URL?: string } }>;
};

function urlDoPerfil(perfil: string): string | undefined {
  return eas.build[perfil]?.env?.EXPO_PUBLIC_API_BASE_URL;
}

test("production define uma URL de API", () => {
  assert.ok(urlDoPerfil("production"), "production deve definir EXPO_PUBLIC_API_BASE_URL");
});

test("dev e preview não apontam para a URL de produção", () => {
  const prod = urlDoPerfil("production");
  for (const perfil of ["development", "preview"]) {
    const url = urlDoPerfil(perfil);
    assert.ok(url, `${perfil} deve definir EXPO_PUBLIC_API_BASE_URL explicitamente`);
    assert.notEqual(url, prod, `${perfil} não pode apontar para o backend de produção (${prod})`);
  }
});
