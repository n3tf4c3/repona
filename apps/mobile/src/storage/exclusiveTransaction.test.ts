import assert from 'node:assert/strict';
import test from 'node:test';
import { withExclusiveTransaction } from './exclusiveTransaction';

test('sync executa queries somente pelo handle da transação exclusiva', async () => {
  const calls: string[] = [];
  const transaction = { run: () => calls.push('transaction') };
  const host = {
    run: () => calls.push('root'),
    withTransactionAsync: async (operation: () => Promise<void>) => operation(),
    withExclusiveTransactionAsync: async (
      operation: (value: typeof transaction) => Promise<void>,
    ) => operation(transaction),
  };

  await withExclusiveTransaction(host, false, async (handle) => {
    handle.run();
  });
  assert.deepEqual(calls, ['transaction']);
});

test('web usa fallback explícito porque expo-sqlite não oferece modo exclusivo', async () => {
  const calls: string[] = [];
  const host = {
    run: () => calls.push('root'),
    withExclusiveTransactionAsync: async () => {
      throw new Error('exclusive indisponível');
    },
    withTransactionAsync: async (operation: () => Promise<void>) => operation(),
  };
  await withExclusiveTransaction(host, true, async (handle: typeof host) => {
    handle.run();
  });
  assert.deepEqual(calls, ['root']);
});
