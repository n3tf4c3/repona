// URL base da API do web (Next.js) usada pela sincronização por casa.
// Definida por perfil de build via EXPO_PUBLIC_API_BASE_URL (eas.json), para que
// builds de development/preview possam apontar para um backend separado e não
// contaminar os dados de produção (auditoria #79). Sem a variável, cai no deploy
// de produção. Para testar contra um servidor local, defina
// EXPO_PUBLIC_API_BASE_URL=http://localhost:3000 (emulador) ou o IP da máquina
// na rede (ex.: http://192.168.0.10:3000) em dispositivo físico.
const PRODUCTION_API_BASE_URL = "https://repona.vercel.app";
const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
export const API_BASE_URL = fromEnv && fromEnv.length > 0 ? fromEnv : PRODUCTION_API_BASE_URL;
