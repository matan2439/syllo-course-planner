/**
 * Web component/integration tests (Slice 1). ts-jest is used deliberately
 * instead of babel-jest: adding a babel config to a Next app disables Next's
 * SWC compiler for the whole app. ts-jest keeps the production build on SWC
 * while compiling TSX for tests via tsconfig.jest.json (jsx: react-jsx).
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/\\.next/'],
}
