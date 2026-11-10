// Expo rewrites process.env.EXPO_PUBLIC_* to read from this module; in tests use the real environment.
module.exports = { env: process.env };
