// Garante node_modules/@repona/core apontando para packages/core.
//
// Por quê: o npm às vezes hoista o pacote de workspace para o node_modules da
// raiz (symlink unix). O Turbopack no Windows não atravessa esse symlink, e o
// `next dev`/`next build` falham com "Can't resolve '@repona/core'". Um link
// local nativo no node_modules do app resolve. Roda em predev/prebuild, então
// sobrevive a um `npm install` que tenha removido o link.
import { lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const dirRepona = resolve(aqui, "../node_modules/@repona");
const link = resolve(dirRepona, "core");
const alvo = resolve(aqui, "../../../packages/core");

function existe(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

if (existe(link)) process.exit(0);

mkdirSync(dirRepona, { recursive: true });
// 'junction' no Windows não exige admin; nos demais SO criamos um symlink de dir.
symlinkSync(alvo, link, process.platform === "win32" ? "junction" : "dir");
console.log("[ensure-core-link] criado node_modules/@repona/core ->", alvo);
