// Metro config — habilita resolução do workspace npm (monorepo Nx)
// pra que `@netx/shared` seja resolvido sem symlink quebrado.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch tudo no workspace (pra hot-reload do @netx/shared)
config.watchFolders = [workspaceRoot];

// 2. Resolver módulos em DOIS caminhos: o do mobile e o do workspace root.
//    Sem isso, Metro só olha em apps/mobile/node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Evita duplicação de react/react-native (hooks quebram se houver 2 cópias)
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
