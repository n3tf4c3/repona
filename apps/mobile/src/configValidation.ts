export const PRODUCTION_API_BASE_URL = 'https://repona.vercel.app';

export const MOBILE_ENVIRONMENTS = ['development', 'preview', 'production'] as const;

export type MobileEnvironment = (typeof MOBILE_ENVIRONMENTS)[number];

type PublicConfigInput = {
  apiBaseUrl?: string;
  appEnvironment?: string;
};

export type PublicMobileConfig = {
  apiBaseUrl: string;
  appEnvironment: MobileEnvironment;
};

function parseEnvironment(value: string | undefined): MobileEnvironment {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(
      'EXPO_PUBLIC_APP_ENV não definido. Configure explicitamente development, preview ou production.',
    );
  }
  if (!MOBILE_ENVIRONMENTS.includes(normalized as MobileEnvironment)) {
    throw new Error(`EXPO_PUBLIC_APP_ENV inválido: ${normalized}.`);
  }
  return normalized as MobileEnvironment;
}

function parseApiBaseUrl(
  value: string | undefined,
): { baseUrl: string; hostname: string; origin: string } {
  const normalized = value?.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error(
      'EXPO_PUBLIC_API_BASE_URL não definida. Configure a URL da API explicitamente; não há fallback para produção.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL deve ser uma URL absoluta válida.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL deve usar http ou https.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL não pode conter credenciais, query string ou fragmento.');
  }

  return {
    baseUrl: normalized,
    hostname: parsed.hostname.toLowerCase(),
    origin: parsed.origin.toLowerCase(),
  };
}

// Validação fail-closed da configuração pública do bundle (auditoria #79).
// O marcador de ambiente é independente da URL: assim um perfil non-production
// não pode apontar para produção por engano, mesmo que a variável de URL exista.
export function resolvePublicMobileConfig(input: PublicConfigInput): PublicMobileConfig {
  const appEnvironment = parseEnvironment(input.appEnvironment);
  const { baseUrl, hostname, origin } = parseApiBaseUrl(input.apiBaseUrl);
  const productionUrl = new URL(PRODUCTION_API_BASE_URL);
  const productionHostname = productionUrl.hostname.toLowerCase();
  const productionOrigin = productionUrl.origin.toLowerCase();

  if (appEnvironment !== 'production' && hostname === productionHostname) {
    throw new Error(
      `O ambiente ${appEnvironment} não pode usar o backend de produção (${productionOrigin}).`,
    );
  }
  if (appEnvironment === 'production' && origin !== productionOrigin) {
    throw new Error(
      `O ambiente production deve usar o backend de produção (${productionOrigin}).`,
    );
  }

  return { apiBaseUrl: baseUrl, appEnvironment };
}
