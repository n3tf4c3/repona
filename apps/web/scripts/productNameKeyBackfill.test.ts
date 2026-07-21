import assert from "node:assert/strict";
import test from "node:test";
import { productNameKey } from "@repona/core";
import {
  analyzeProductNameKeys,
  formatProductNameKeyPreflight,
  toProductNameKeyPreflightSummary,
} from "./productNameKeyBackfill";

test("preflight preserva a diferenca que o locale pt-BR faz entre I e I-com-ponto", () => {
  const latinI = "I";
  const dottedCapitalI = String.fromCodePoint(0x0130);
  const analysis = analyzeProductNameKeys([
    { id: 1, casaId: 10, name: latinI, storedNameKey: null },
    { id: 2, casaId: 10, name: dottedCapitalI, storedNameKey: null },
  ]);

  assert.notEqual(productNameKey(latinI), productNameKey(dottedCapitalI));
  assert.equal(analysis.collisionGroups, 0);
  assert.equal(analysis.collidingRows, 0);
  assert.deepEqual(
    analysis.targetRows.map((row) => row.nameKey),
    [productNameKey(latinI), productNameKey(dottedCapitalI)]
  );
});

test("preflight detecta colisao NFC apenas dentro da mesma casa", () => {
  const composed = "Caf" + String.fromCodePoint(0x00e9);
  const decomposed = "Cafe" + String.fromCodePoint(0x0301);
  const analysis = analyzeProductNameKeys([
    { id: 1, casaId: 10, name: composed, storedNameKey: productNameKey(composed) },
    { id: 2, casaId: 10, name: decomposed, storedNameKey: null },
    { id: 3, casaId: 11, name: decomposed, storedNameKey: null },
  ]);

  assert.equal(analysis.totalRows, 3);
  assert.equal(analysis.rowsNeedingUpdate, 2);
  assert.equal(analysis.collisionGroups, 1);
  assert.equal(analysis.collidingRows, 2);
});

test("resumo operacional nao inclui nomes, chaves ou identificadores", () => {
  const sensitiveName = "Produto confidencial";
  const analysis = analyzeProductNameKeys([
    { id: 99123, casaId: 88776, name: sensitiveName, storedNameKey: null },
  ]);
  const output = formatProductNameKeyPreflight(
    toProductNameKeyPreflightSummary(analysis, {
      columnExists: false,
      columnReady: false,
      indexReady: false,
      legacyIndexExists: false,
    })
  );

  assert.doesNotMatch(output, /Produto confidencial/i);
  assert.doesNotMatch(output, /produto confidencial/i);
  assert.doesNotMatch(output, /99123|88776/);
  assert.match(output, /Produtos analisados: 1/);
  assert.match(output, /Grupos em colisao: 0/);
});
