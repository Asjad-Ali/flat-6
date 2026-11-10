// Tests that need the Firebase emulator (started by `npm run test:firebase`).
const base = require('./package.json').jest;

module.exports = { ...base, testMatch: ['<rootDir>/__tests__/emulator/*.test.ts'], testTimeout: 30000 };
