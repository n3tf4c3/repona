import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MOBILE_ENVIRONMENTS, PRODUCTION_API_BASE_URL } from "./configValidation";

// Guarda de configuração (auditoria #79): impede que um perfil de build que não é
// produção aponte para o backend de produção. Um build dev/preview que envie
// token/snapshot para https://repona.vercel.app contaminaria os dados reais.
// Lê eas.json e cruza os EXPO_PUBLIC_API_BASE_URL por perfil.
const dir = path.dirname(fileURLToPath(import.meta.url));
const easPath = path.join(dir, "..", "eas.json");
const eas = JSON.parse(readFileSync(easPath, "utf8")) as {
  build: Record<
    string,
    { env?: { EXPO_PUBLIC_APP_ENV?: string; EXPO_PUBLIC_API_BASE_URL?: string } }
  >;
};

function envDoPerfil(perfil: string) {
  return eas.build[perfil]?.env;
}

test("cada perfil define um marcador de ambiente correspondente", () => {
  for (const perfil of MOBILE_ENVIRONMENTS) {
    assert.equal(
      envDoPerfil(perfil)?.EXPO_PUBLIC_APP_ENV,
      perfil,
      `${perfil} deve definir EXPO_PUBLIC_APP_ENV=${perfil}`,
    );
  }
});

test("dev e preview não apontam para a URL de produção", () => {
  const prod = envDoPerfil("production")?.EXPO_PUBLIC_API_BASE_URL;
  assert.ok(prod, "production deve definir EXPO_PUBLIC_API_BASE_URL explicitamente");
  assert.equal(prod, PRODUCTION_API_BASE_URL);
  for (const perfil of ["development", "preview"]) {
    const url = envDoPerfil(perfil)?.EXPO_PUBLIC_API_BASE_URL;
    assert.ok(url, `${perfil} deve definir EXPO_PUBLIC_API_BASE_URL explicitamente`);
    assert.notEqual(new URL(url).origin, new URL(prod).origin);
  }
});

test("preview fica sem sync remoto enquanto staging não existe", () => {
  const url = envDoPerfil("preview")?.EXPO_PUBLIC_API_BASE_URL;
  assert.ok(url);
  assert.equal(
    new URL(url).hostname.endsWith(".invalid"),
    true,
    "preview deve usar domínio reservado .invalid até existir staging real",
  );
});
