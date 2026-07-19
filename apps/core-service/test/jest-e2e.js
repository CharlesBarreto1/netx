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
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup/after-env.ts'],
  testTimeout: 30000,

  // Serial de propósito: todos os testes compartilham UM banco e truncam entre
  // si. Em paralelo, um teste apagaria o dado do outro no meio da execução.
  maxWorkers: 1,
};
