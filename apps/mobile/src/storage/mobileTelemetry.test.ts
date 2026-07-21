import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMobileUnexpectedFailureEvent,
  reportMobileUnexpectedFailure,
  type MobileUnexpectedFailureEvent,
} from './mobileTelemetry';

test('telemetria de falha local contém só operação, código fixo e requestId', () => {
  const event = buildMobileUnexpectedFailureEvent(
    'sync',
    '00000000-0000-4000-8000-000000000123',
  );
  assert.deepEqual(event, {
    event: 'mobile_operation_failure',
    operation: 'sync',
    code: 'UNEXPECTED_LOCAL_FAILURE',
    requestId: '00000000-0000-4000-8000-000000000123',
  });
  assert.deepEqual(Object.keys(event).sort(), ['code', 'event', 'operation', 'requestId']);
  const serialized = JSON.stringify(event);
  for (const forbidden of ['token', 'payload', 'casaId', 'stack', 'message']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('report encaminha um evento sanitizado ao sink observável', () => {
  const events: MobileUnexpectedFailureEvent[] = [];
  const operations = ['sync', 'create-account', 'pair-account', 'delete-account'] as const;
  for (const operation of operations) {
    reportMobileUnexpectedFailure(operation, (event) => events.push(event));
  }
  assert.deepEqual(events.map((event) => event.operation), operations);
  for (const event of events) {
    assert.match(
      event.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  }
});
