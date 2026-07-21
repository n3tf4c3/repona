import "server-only";
import { headers } from "next/headers";
import { safeRequestId } from "@/lib/requestId";

async function currentRequestId(): Promise<string> {
  try {
    return safeRequestId((await headers()).get("x-request-id"));
  } catch {
    // Uma Action também pode ser exercitada fora do ciclo HTTP em testes.
  }
  return crypto.randomUUID();
}

/**
 * Registra somente metadados operacionais controlados pelo servidor. Nunca
 * serializa o Error, argumentos da Action, token, payload ou casaId.
 */
export async function reportUnexpectedActionFailure(
  action: string
): Promise<string> {
  const requestId = await currentRequestId();
  console.error(
    JSON.stringify({
      level: "error",
      event: "server_action_failed",
      action,
      code: "UNEXPECTED_ERROR",
      requestId,
    })
  );
  return requestId;
}

export function reportUnexpectedRouteFailure(
  operation: string,
  candidateRequestId?: string | null
): string {
  const requestId = safeRequestId(candidateRequestId);
  console.error(
    JSON.stringify({
      level: "error",
      event: "route_failed",
      operation,
      code: "UNEXPECTED_ERROR",
      requestId,
    })
  );
  return requestId;
}

export function genericActionError(requestId: string): string {
  return `Algo deu errado. Tente novamente. Referência: ${requestId.slice(0, 8)}.`;
}
