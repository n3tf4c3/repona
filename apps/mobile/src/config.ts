import { resolvePublicMobileConfig } from './configValidation';

// URL base da API do web (Next.js) e marcador de ambiente usados pela
// sincronização. O Expo só embute EXPO_PUBLIC_* acessado diretamente, por isso
// estas duas leituras não devem virar destructuring/dynamic lookup.
//
// O preview é deliberadamente local-only enquanto não existe staging: eas.json
// usa um domínio reservado `.invalid`, que nunca resolve. Para desenvolvimento
// fora do EAS, defina as DUAS variáveis; por exemplo:
// EXPO_PUBLIC_APP_ENV=development
// EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000
//
// A validação falha fechado quando uma variável falta e também rejeita qualquer
// perfil development/preview apontando para o backend real. (auditoria #79)
const publicConfig = resolvePublicMobileConfig({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  appEnvironment: process.env.EXPO_PUBLIC_APP_ENV,
});

export const API_BASE_URL = publicConfig.apiBaseUrl;
export const APP_ENV = publicConfig.appEnvironment;
