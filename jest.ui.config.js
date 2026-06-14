module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/ui/**/*.test.js'],
  transform: {
    '^.+\\.m?js$': ['babel-jest', { configFile: './babel.config.ui.js' }],
  },
  transformIgnorePatterns: [],
};
