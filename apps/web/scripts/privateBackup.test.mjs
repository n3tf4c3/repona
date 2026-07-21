import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  ensurePrivateDirectorySync,
  verifyPrivatePathSync,
  writePrivateFileSync,
} from "./privateBackup.mjs";

test("backup privado corrige permissao existente e protege arquivo novo", (context) => {
  const root = mkdtempSync(join(tmpdir(), "repona-private-backup-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const directory = resolve(root, "backups");
  // A primeira chamada cria; a segunda prova idempotencia sobre caminho existente.
  ensurePrivateDirectorySync(directory);
  ensurePrivateDirectorySync(directory);

  const file = resolve(directory, "safe.json");
  writePrivateFileSync(file, '{"ok":true}');
  assert.equal(verifyPrivatePathSync(directory, "directory"), true);
  assert.equal(verifyPrivatePathSync(file, "file"), true);
});

test("backup privado nunca sobrescreve arquivo existente", (context) => {
  const root = mkdtempSync(join(tmpdir(), "repona-private-backup-existing-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  ensurePrivateDirectorySync(root);

  const file = resolve(root, "existing.json");
  writeFileSync(file, "original", { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);

  assert.throws(() => writePrivateFileSync(file, "replacement"), (error) => {
    return error && typeof error === "object" && error.code === "EEXIST";
  });
  assert.equal(readFileSync(file, "utf8"), "original");
});

test("helper rejeita caminho relativo e symlink", (context) => {
  assert.throws(
    () => ensurePrivateDirectorySync("relative/backups"),
    /PRIVATE_BACKUP_PATH_MUST_BE_ABSOLUTE/,
  );

  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "repona-private-backup-link-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const target = resolve(root, "target");
  const link = resolve(root, "link");
  ensurePrivateDirectorySync(target);
  // Dynamic import keeps the main fixture imports minimal on Windows, where
  // creating symlinks may require a developer-mode privilege.
  return import("node:fs").then(({ symlinkSync }) => {
    symlinkSync(target, link, "dir");
    assert.throws(() => ensurePrivateDirectorySync(link), /PRIVATE_BACKUP_SYMLINK_REJECTED/);
  });
});
