module.exports = {
  testEnvironment: 'node',
  // Board-init beforeEach parses the ~17k-line legacy semester_board_viewer.html
  // in jsdom, which routinely exceeds jest's 5000ms default hook timeout (worse
  // under high-core-count parallelism). Set here so local AND CI are stable
  // without any per-invocation --testTimeout flag.
  testTimeout: 60000,
  testMatch: ['**/tests/ui/**/*.test.js', '**/tests/ui/**/*.test.ts'],
  transform: {
    '^.+\\.m?js$': ['babel-jest', { configFile: './babel.config.ui.js' }],
    // .ts suites (web/ frontend units) — does not affect the .js planner suites
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
  transformIgnorePatterns: [],
};
