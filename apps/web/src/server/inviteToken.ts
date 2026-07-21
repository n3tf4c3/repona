import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync } from "crypto";
import { inviteTokenSecret } from "@/server/env";

// Cifragem do token (invite_code) em repouso (auditoria #43). O token de 12 chars
// é a única credencial da casa; guardá-lo em claro deixava qualquer dump do
// banco, log de query ou endpoint admin com acesso direto a web/sync/exclusão.
//
// Usamos AES-256-GCM DETERMINÍSTICO: o IV é derivado do próprio token (HMAC),
// então cifrar o mesmo token sempre produz o mesmo blob. Isso permite, com uma
// só coluna: (a) lookup por igualdade no banco, preservando o índice único, e
// (b) decifrar para reexibir o token na tela de perfil. Tokens são únicos, então
// blobs idênticos só aparecem para o mesmo token — sem reuso inseguro de IV.
//
// A chave deriva de INVITE_TOKEN_SECRET. NÃO rotacione esse segredo sem
// re-migrar os tokens existentes (ver scripts/migrar-invite-code.mjs) — senão os
// logins/sync param de bater e o perfil não decifra. A leitura do segredo é
// preguiçosa (só ao cifrar/decifrar) para não quebrar o build sem env.

const VERSAO = "v1";

function segredo(): Buffer {
  return Buffer.from(inviteTokenSecret(), "utf8");
}

function derivar(info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", segredo(), Buffer.alloc(0), info, 32));
}

export function cifrarCodigo(codigo: string): string {
  const iv = createHmac("sha256", derivar("repona-invite-iv-v1")).update(codigo).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", derivar("repona-invite-aes-v1"), iv);
  const ct = Buffer.concat([cipher.update(codigo, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSAO}:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

export function decifrarCodigo(blob: string): string {
  const [versao, dados] = blob.split(":");
  if (versao !== VERSAO || !dados) throw new Error("INVITE_BLOB_INVALIDO");
  const buf = Buffer.from(dados, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", derivar("repona-invite-aes-v1"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
