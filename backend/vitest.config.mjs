import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DB_STORAGE_TYPE: 'json',
      JWT_SECRET: 'test-only-jwt-secret-at-least-32-chars',
      INTERNAL_CRYPTO_SECRET: 'test-only-internal-crypto-secret-at-least-32-chars',
      KEY_STORAGE_TYPE: 'file',
      FALCON_KEYSTORE_PATH: 'node_modules/.cache/test-falcon-keystore.json',
      PUBLIC_VERIFY_URL: 'http://localhost:3000/api/public/documents/verify',
    },
  },
});
