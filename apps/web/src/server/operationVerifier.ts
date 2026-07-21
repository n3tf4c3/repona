import "server-only";
import { inviteTokenSecret } from "@/server/env";
import {
  accountOperationRequestHashWithSecret,
  operationVerifierHashWithSecret,
  type AccountOperationType,
  type VerifierOperationType,
} from "./operationVerifierHash";

export { OPERATION_VERIFIER_REGEX, operationVerifierMatches } from "./operationVerifierHash";

export function hashOperationVerifier(
  verifier: string,
  operationType: VerifierOperationType
): string {
  return operationVerifierHashWithSecret(verifier, operationType, inviteTokenSecret());
}

export function hashAccountOperationRequest(
  payload: string,
  operationType: AccountOperationType
): string {
  return accountOperationRequestHashWithSecret(
    payload,
    operationType,
    inviteTokenSecret()
  );
}
