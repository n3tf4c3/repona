// Metro config ciente do monorepo: observa a raiz do workspace para resolver
// dependências hasteadas e o pacote @repona/core (TypeScript de origem).
// A partir do SDK 52 o Expo já configura monorepos automaticamente, mas deixamos
// explícito para garantir a resolução do pacote symlinkado.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
