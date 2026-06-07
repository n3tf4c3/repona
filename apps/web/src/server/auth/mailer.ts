import "server-only";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Envio plugável: sem RESEND_API_KEY, apenas registra o link no log do servidor
// (grátis, zero setup). Com a chave definida, envia de verdade pelo Resend.
export async function enviarEmailReset(email: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Repona <onboarding@resend.dev>";

  if (!apiKey) {
    console.log(`[reset-senha] Link de redefinição para ${email}: ${link}`);
    return;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "Redefinir sua senha do Repona",
      text: `Você pediu para redefinir sua senha no Repona.\n\nAbra o link abaixo (válido por 1 hora):\n${link}\n\nSe não foi você, pode ignorar este e-mail.`,
    }),
  });

  if (!res.ok) {
    console.error(`[reset-senha] Falha ao enviar e-mail (${res.status}).`);
    throw new Error("EMAIL_SEND_FAILED");
  }
}
