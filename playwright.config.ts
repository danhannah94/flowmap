// UI tests (design.md §8, §10 Part 2). `pnpm test:ui` builds, then starts `flowmap serve` on a temp copy of the
// fixtures (tests/ui/serve.mjs). Each test writes its own diagram into that directory, so tests don't share files.
import { defineConfig, devices } from '@playwright/test';
import { E2E_DIR, E2E_PORT } from './tests/ui/env';

export default defineConfig({
  testDir: 'tests/ui',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  workers: 4,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'node tests/ui/serve.mjs',
    url: `http://127.0.0.1:${E2E_PORT}/api/diagrams`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: { FLOWMAP_E2E_DIR: E2E_DIR, FLOWMAP_E2E_PORT: String(E2E_PORT) },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
