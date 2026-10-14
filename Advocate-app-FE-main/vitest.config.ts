import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// UI component tests (npm test). Separate from vite.config so the dev/build
// settings stay as they are.
export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
})
