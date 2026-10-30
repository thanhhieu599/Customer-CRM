import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const cwd = resolve(__dirname, '../..');
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: [
    {
      command: 'npm run prisma:deploy:wasm -w apps/api && npm run db:seed && npm run start -w apps/api',
      cwd,
      url: 'http://localhost:4001/api/health',
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: process.env.UI_TEST_DATABASE_URL ?? 'postgresql://crm:crm@localhost:5432/crm_ui?schema=public',
        REDIS_URL: process.env.UI_TEST_REDIS_URL ?? 'redis://localhost:6379/3',
        JWT_SECRET: 'local-ui-test-only',
        COOKIE_SECURE: 'false',
        SCHEDULER_ENABLED: 'false',
        PORT: '4001',
      },
    },
    {
      command: 'npm exec -w apps/web -- next dev --webpack -p 3001',
      cwd,
      url: 'http://localhost:3001/login',
      timeout: 120000,
      reuseExistingServer: false,
      env: { API_URL: 'http://localhost:4001', NEXT_DIST_DIR: '.next-e2e' },
    },
  ],
});
