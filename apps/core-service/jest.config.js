const base = require('../../jest.config.base');

module.exports = {
  ...base,
  rootDir: '.',
  // Só testes unitários de src/ (e2e ficam em test/jest-e2e.json).
  testRegex: 'src/.*\\.(spec|test)\\.ts$',
};
