import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromiseMutex } from './promiseMutex';

test('fluxos de conta não trocam escopo/credencial em paralelo', async () => {
  const run = createPromiseMutex();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = run(async () => {
    order.push('sync:start');
    await firstGate;
    order.push('sync:end');
  });
  const second = run(async () => {
    order.push('unpair:start');
  });
  await Promise.resolve();
  assert.deepEqual(order, ['sync:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['sync:start', 'sync:end', 'unpair:start']);
});
