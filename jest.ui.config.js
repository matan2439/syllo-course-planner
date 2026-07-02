module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/ui/**/*.test.js', '**/tests/ui/**/*.test.ts'],
  transform: {
    '^.+\\.m?js$': ['babel-jest', { configFile: './babel.config.ui.js' }],
    // .ts suites (web/ frontend units) — does not affect the .js planner suites
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
  transformIgnorePatterns: [],
};
