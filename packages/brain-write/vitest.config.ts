import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/complete-validator/msw-setup-hook.ts'],
  },
})
