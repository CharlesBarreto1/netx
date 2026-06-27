const base = require('../../jest.config.base');

module.exports = {
  ...base,
  rootDir: '.',
  testRegex: 'src/.*\\.(spec|test)\\.ts$',
};
