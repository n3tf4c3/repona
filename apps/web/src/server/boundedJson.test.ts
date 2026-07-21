import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedJson, RequestBodyTooLargeError } from "./boundedJson";

test("readBoundedJson aceita JSON dentro do teto", async () => {
  const parsed = await readBoundedJson(
    new Request("https://example.test", { method: "POST", body: '{"ok":true}' }),
    32
  );
  assert.deepEqual(parsed, { ok: true });
});

test("readBoundedJson interrompe stream sem Content-Length acima do teto", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"value":"'));
      controller.enqueue(encoder.encode("x".repeat(64)));
      controller.enqueue(encoder.encode('"}'));
      controller.close();
    },
  });
  const request = new Request("https://example.test", {
    method: "POST",
    body: stream,
    // Necessário no Node para um corpo ReadableStream; ignorado no runtime web.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await assert.rejects(() => readBoundedJson(request, 32), RequestBodyTooLargeError);
});
