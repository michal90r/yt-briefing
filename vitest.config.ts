import { defineConfig } from 'vitest/config';

// Hermetic smoke tests: pure functions only, zero network/FS/subprocess. The same files run
// under `bun test` (Bun's native, Jest-compatible globals), so tests use GLOBAL describe/it/expect
// — never `import ... from 'vitest'` — and we enable globals here for the Node/vitest axis.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
