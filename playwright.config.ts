import { defineConfig } from '@playwright/test'
import process from 'node:process'

const isCi = Boolean(process.env.CI)

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  forbidOnly: isCi,
  fullyParallel: false,
  outputDir: 'test-results',
  reporter: isCi ? 'github' : 'list',
  retries: isCi ? 2 : 0,
  testDir: './tests/e2e',
  timeout: 30_000,
  workers: 1,
})
