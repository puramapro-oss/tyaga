import { defineConfig, devices } from '@playwright/test'

/**
 * E2E TYAGA — dev local (schéma `tyaga` réel via .env.local).
 * Compte de test : tyaga-e2e@purama-test.dev (créé 1re exécution).
 */

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3198',
    locale: 'fr-FR',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx next dev -p 3198',
    port: 3198,
    reuseExistingServer: true,
    timeout: 90_000,
  },
})
