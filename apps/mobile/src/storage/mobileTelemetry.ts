import { uuidv4 } from '@repona/core';

export type MobileOperation =
  | 'sync'
  | 'create-account'
  | 'pair-account'
  | 'delete-account'
  | 'migrate-token';

export type MobileUnexpectedFailureEvent = {
  event: 'mobile_operation_failure';
  operation: MobileOperation;
  code: 'UNEXPECTED_LOCAL_FAILURE';
  requestId: string;
};

export function buildMobileUnexpectedFailureEvent(
  operation: MobileOperation,
  requestId = uuidv4(),
): MobileUnexpectedFailureEvent {
  return {
    event: 'mobile_operation_failure',
    operation,
    code: 'UNEXPECTED_LOCAL_FAILURE',
    requestId,
  };
}

// Deliberadamente não recebe a exceção: mensagem/stack podem conter token,
// payload ou identificadores. O evento mínimo permite contar e correlacionar a
// falha local sem transportar conteúdo sensível.
export function reportMobileUnexpectedFailure(
  operation: MobileOperation,
  sink: (event: MobileUnexpectedFailureEvent) => void = (event) => {
    console.error('[repona-mobile]', JSON.stringify(event));
  },
): void {
  sink(buildMobileUnexpectedFailureEvent(operation));
}

const SAFE_REMOTE_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MobileRemoteFailureEvent = {
  event: 'mobile_remote_failure';
  operation: MobileOperation;
  code: 'REMOTE_FAILURE';
  requestId?: string;
};

// Preserva o valor seguro exatamente como chegou no header. Nao gera fallback:
// um UUID local pareceria correlacionavel, mas nao existiria nos logs do servidor.
export function requestIdFromResponse(response: Pick<Response, 'headers'>): string | undefined {
  try {
    const candidate = response.headers.get('x-request-id');
    return candidate !== null && SAFE_REMOTE_REQUEST_ID.test(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function buildMobileRemoteFailureEvent(
  operation: MobileOperation,
  response: Pick<Response, 'headers'>,
): MobileRemoteFailureEvent {
  const requestId = requestIdFromResponse(response);
  const event: MobileRemoteFailureEvent = {
    event: 'mobile_remote_failure',
    operation,
    code: 'REMOTE_FAILURE',
  };
  return requestId === undefined ? event : { ...event, requestId };
}

// Recebe somente operacao + Response. Corpo, erro, token e casaId nao fazem
// parte da API e, portanto, nao podem ser serializados acidentalmente no sink.
export function reportMobileRemoteFailure(
  operation: MobileOperation,
  response: Pick<Response, 'headers'>,
  sink: (event: MobileRemoteFailureEvent) => void = (event) => {
    console.error('[repona-mobile]', JSON.stringify(event));
  },
): void {
  sink(buildMobileRemoteFailureEvent(operation, response));
}
