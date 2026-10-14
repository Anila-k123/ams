import { defineConfig, devices } from '@playwright/test'
import { API, APP, BE_DIR, PYTHON, backendEnv } from './e2e/env'

// Browser E2E (npm run e2e). Starts its own backend (:8090, database
// pactpro_e2e), frontend (:5180) and AI stand-in (:8099); never the working
// instance on :8080 / :5173. See docs/E2E.md.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'e2e/.results/results.json' }]],
  globalSetup: './e2e/global-setup.ts',
  outputDir: 'e2e/.results/artifacts',
  use: {
    baseURL: APP,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node e2e/llm-stub.mjs',
      url: 'http://127.0.0.1:8099/__stats',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `"${PYTHON}" manage.py runserver 127.0.0.1:8090 --noreload`,
      cwd: BE_DIR,
      url: `${API}/api/invitations/preview?token=health`,
      env: backendEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx vite --port 5180 --strictPort',
      url: APP,
      env: { VITE_API_BASE: API },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
