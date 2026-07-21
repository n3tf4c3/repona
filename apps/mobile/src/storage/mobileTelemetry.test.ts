import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMobileRemoteFailureEvent,
  buildMobileUnexpectedFailureEvent,
  reportMobileRemoteFailure,
  reportMobileUnexpectedFailure,
  requestIdFromResponse,
  type MobileRemoteFailureEvent,
  type MobileUnexpectedFailureEvent,
} from './mobileTelemetry';

function responseWithRequestId(value: string | null): Pick<Response, 'headers'> {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'x-request-id' ? value : null),
    } as Headers,
  };
}

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
  const operations = [
    'sync',
    'create-account',
    'pair-account',
    'delete-account',
    'migrate-token',
  ] as const;
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

test('requestId remoto seguro e preservado exatamente, sem UUID local', () => {
  const serverRequestId = '00000000-0000-4000-8000-000000000123';
  const response = responseWithRequestId(serverRequestId);

  assert.equal(requestIdFromResponse(response), serverRequestId);
  assert.deepEqual(buildMobileRemoteFailureEvent('sync', response), {
    event: 'mobile_remote_failure',
    operation: 'sync',
    code: 'REMOTE_FAILURE',
    requestId: serverRequestId,
  });
});

test('requestId remoto ausente ou invalido permanece ausente', () => {
  const invalidValues = [
    null,
    '',
    'curto',
    ' request-id-valido ',
    'request\nid-injetado',
    'x'.repeat(129),
    'request,id,duplicado',
    '2'.repeat(8),
    '3'.repeat(12),
    'A'.repeat(26),
  ];

  for (const value of invalidValues) {
    const response = responseWithRequestId(value);
    assert.equal(requestIdFromResponse(response), undefined);
    const event = buildMobileRemoteFailureEvent('sync', response);
    assert.deepEqual(event, {
      event: 'mobile_remote_failure',
      operation: 'sync',
      code: 'REMOTE_FAILURE',
    });
    assert.equal('requestId' in event, false);
  }
});

test('falha remota registra somente campos controlados, sem dados da requisicao', () => {
  const serverRequestId = '00000000-0000-4000-8000-000000000123';
  const response = {
    ...responseWithRequestId(serverRequestId),
    token: 'TOKEN-NAO-PODE-VAZAR',
    payload: { produto: 'NAO-PODE-VAZAR' },
    casaId: 987654,
  };
  const events: MobileRemoteFailureEvent[] = [];

  reportMobileRemoteFailure('pair-account', response, (event) => events.push(event));

  assert.deepEqual(events, [
    {
      event: 'mobile_remote_failure',
      operation: 'pair-account',
      code: 'REMOTE_FAILURE',
      requestId: serverRequestId,
    },
  ]);
  assert.deepEqual(Object.keys(events[0]).sort(), ['code', 'event', 'operation', 'requestId']);
  const serialized = JSON.stringify(events[0]);
  for (const forbidden of [
    'TOKEN-NAO-PODE-VAZAR',
    'NAO-PODE-VAZAR',
    '987654',
    'token',
    'payload',
    'casaId',
    'stack',
    'message',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
