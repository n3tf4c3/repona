import { uuidv4 } from '@repona/core';

export type MobileOperation =
  | 'sync'
  | 'create-account'
  | 'pair-account'
  | 'delete-account';

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
