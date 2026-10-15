import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '../../work/playwright-report', open: 'never' }]],
  outputDir: path.resolve(__dirname, '../../work/playwright-results'),
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    browserName: 'chromium',
    headless: true,
    launchOptions: executablePath ? { executablePath } : { channel: 'msedge' },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'desktop-edge', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
});
