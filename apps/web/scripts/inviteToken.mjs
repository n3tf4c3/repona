// Espelho em JS de src/server/inviteToken.ts (auditoria #43): cifra/decifra o
// token da casa com AES-256-GCM determinístico. Mantém EXATAMENTE a mesma
// construção (versão, infos de HKDF, derivação do IV) para interoperar com a
// app — os scripts admin e a migração de backfill precisam casar byte-a-byte.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync } from "node:crypto";

const VERSAO = "v1";

function segredo() {
  const s = process.env.INVITE_TOKEN_SECRET;
  if (!s || s.length < 16) {
    throw new Error("INVITE_TOKEN_SECRET ausente ou curto (>= 16 chars).");
  }
  return Buffer.from(s, "utf8");
}

function derivar(info) {
  return Buffer.from(hkdfSync("sha256", segredo(), Buffer.alloc(0), info, 32));
}

export function cifrarCodigo(codigo) {
  const iv = createHmac("sha256", derivar("repona-invite-iv-v1")).update(codigo).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", derivar("repona-invite-aes-v1"), iv);
  const ct = Buffer.concat([cipher.update(codigo, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSAO}:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

export function decifrarCodigo(blob) {
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
