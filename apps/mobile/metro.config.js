// Expo SDK 52+ detecta workspaces automaticamente quando a configuração parte de
// expo/metro-config. Overrides manuais de watchFolders/nodeModulesPaths podem
// divergir do resolvedor oficial e por isso não são necessários aqui.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
