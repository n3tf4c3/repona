// URL base da API do web (Next.js) usada pela sincronização por casa.
// Definida por perfil de build via EXPO_PUBLIC_API_BASE_URL (eas.json): dev ->
// emulador/local, preview -> staging, production -> produção. Para testar contra
// um servidor local, defina EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
// (emulador usa http://10.0.2.2:3000) ou o IP da máquina na rede (ex.:
// http://192.168.0.10:3000) em dispositivo físico.
//
// Sem fallback para produção (auditoria #79): antes, a ausência da variável caía
// silenciosamente em https://repona.vercel.app — um build dev/preview mal
// configurado enviaria token e snapshot para o backend REAL, contaminando os
// dados de produção. Todo perfil define a variável em eas.json; a ausência é
// misconfiguração e falha alto, nunca aponta para produção por engano.
const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
if (!fromEnv) {
  throw new Error(
    "EXPO_PUBLIC_API_BASE_URL não definida. Configure a URL da API por perfil (eas.json) " +
      "ou no ambiente do `expo start`. O app não usa o backend de produção como fallback."
  );
}
export const API_BASE_URL = fromEnv;
