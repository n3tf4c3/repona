import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTION_API_BASE_URL, resolvePublicMobileConfig } from './configValidation';

test('config falha fechado quando URL ou ambiente faltam', () => {
  assert.throws(
    () => resolvePublicMobileConfig({ appEnvironment: 'development' }),
    /EXPO_PUBLIC_API_BASE_URL não definida/,
  );
  assert.throws(
    () => resolvePublicMobileConfig({ apiBaseUrl: 'http://10.0.2.2:3000' }),
    /EXPO_PUBLIC_APP_ENV não definido/,
  );
});

test('config rejeita ambiente desconhecido e URL não HTTP', () => {
  assert.throws(
    () =>
      resolvePublicMobileConfig({
        appEnvironment: 'staging',
        apiBaseUrl: 'https://example.invalid',
      }),
    /EXPO_PUBLIC_APP_ENV inválido/,
  );
  assert.throws(
    () =>
      resolvePublicMobileConfig({
        appEnvironment: 'development',
        apiBaseUrl: 'file:///tmp/repona',
      }),
    /deve usar http ou https/,
  );
});

test('development e preview nunca aceitam a origem de produção', () => {
  for (const appEnvironment of ['development', 'preview'] as const) {
    assert.throws(
      () =>
        resolvePublicMobileConfig({
          appEnvironment,
          apiBaseUrl: `${PRODUCTION_API_BASE_URL}/`,
        }),
      /não pode usar o backend de produção/,
    );
  }
});

test('production exige a origem canônica e development aceita backend local', () => {
  assert.throws(
    () =>
      resolvePublicMobileConfig({
        appEnvironment: 'production',
        apiBaseUrl: 'https://repona-preview.invalid',
      }),
    /deve usar o backend de produção/,
  );

  assert.deepEqual(
    resolvePublicMobileConfig({
      appEnvironment: 'development',
      apiBaseUrl: 'http://10.0.2.2:3000/',
    }),
    {
      appEnvironment: 'development',
      apiBaseUrl: 'http://10.0.2.2:3000',
    },
  );
});
