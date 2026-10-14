import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(root, 'src/renderer/src'),
      '@shared': resolve(root, 'src/shared'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Tests that need a DOM declare it per file: `// @vitest-environment happy-dom`.
    environment: 'node',
  },
})
