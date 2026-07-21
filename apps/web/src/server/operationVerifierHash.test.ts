import assert from "node:assert/strict";
import test from "node:test";
import {
  accountOperationRequestHashWithSecret,
  operationVerifierHashWithSecret,
  operationVerifierMatches,
} from "./operationVerifierHash";

const VERIFIER = "ab".repeat(32);

test("verifier usa chave estável e separação de contexto", () => {
  const inviteSecret = "chave-estavel-da-cifra";
  const beforePepperRotation = operationVerifierHashWithSecret(
    VERIFIER,
    "create",
    inviteSecret
  );
  process.env.RATE_LIMIT_PEPPER = "pepper-novo-que-nao-participa";
  const afterPepperRotation = operationVerifierHashWithSecret(
    VERIFIER,
    "create",
    inviteSecret
  );

  assert.equal(beforePepperRotation, afterPepperRotation);
  assert.equal(
    accountOperationRequestHashWithSecret("payload", "create", inviteSecret),
    accountOperationRequestHashWithSecret("payload", "create", inviteSecret)
  );
  assert.notEqual(
    accountOperationRequestHashWithSecret("payload", "create", inviteSecret),
    accountOperationRequestHashWithSecret("payload", "delete", inviteSecret)
  );
  assert.notEqual(
    beforePepperRotation,
    operationVerifierHashWithSecret(VERIFIER, "rotate", inviteSecret)
  );
  assert.equal(operationVerifierMatches(beforePepperRotation, afterPepperRotation), true);
  assert.equal(operationVerifierMatches(null, afterPepperRotation), false);
});

test("verifier exige 256 bits representados em hexadecimal", () => {
  assert.throws(
    () => operationVerifierHashWithSecret("operation-id-nao-e-segredo", "create", "key"),
    /INVALID_OPERATION_VERIFIER/
  );
});
