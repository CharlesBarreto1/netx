// Metro config — monorepo Nx + alias @netx/shared.
//
// Por que NÃO usar babel-plugin-module-resolver? Ele intercepta TODA expressão
// (incl. require.context do expo-router) e quebra o bundle. Resolver de alias
// no Metro é a forma "oficial" pra workspaces e não atrapalha outros plugins.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Alias do workspace package (TS source — Metro transpila on-the-fly).
config.resolver.extraNodeModules = {
  '@netx/shared': path.resolve(workspaceRoot, 'packages/shared/src'),
};

module.exports = config;
