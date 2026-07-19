/**
 * Jest dos testes de INTEGRAÇÃO (banco real).
 *
 * Deliberadamente NÃO estende jest.config.base.js: aquele impõe limiar de
 * cobertura, que não faz sentido medir aqui — teste de integração cobre
 * caminho, não linha.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],

  // allowJs porque precisamos transformar JS de node_modules (ver abaixo).
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },

  // O oidc-provider (e 4 dependências suas) são ESM puro. O Node 24 carrega
  // ESM por require() nativamente — foi verificado —, mas o jest-runtime
  // intercepta o require() com registry próprio e NÃO implementa esse suporte.
  // Então em teste, e só em teste, transpilamos esses pacotes para CJS.
  // Em produção o import é direto, sem transformação.
  transformIgnorePatterns: ['/node_modules/(?!(oidc-provider|jose|eta|nanoid|quick-lru)/)'],

  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup/after-env.ts'],
  testTimeout: 30000,

  // Serial de propósito: todos os testes compartilham UM banco e truncam entre
  // si. Em paralelo, um teste apagaria o dado do outro no meio da execução.
  maxWorkers: 1,
};
