import {
  expect,
  test as base,
  type BrowserContext,
  type Worker,
} from '@playwright/test'
import { resolve } from 'node:path'

type ChromeStorageApi = {
  storage: {
    local: {
      clear: () => Promise<void>
      get: (keys: string | string[]) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
  }
}

type ExtensionFixtures = {
  extensionContext: BrowserContext
  extensionId: string
  extensionServiceWorker: Worker
}

const extensionPath = resolve('dist')

export const test = base.extend<ExtensionFixtures>({
  extensionContext: async ({ headless, playwright }, provide, testInfo) => {
    const context = await playwright.chromium.launchPersistentContext('', {
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      channel: 'chromium',
      headless,
      timezoneId: 'UTC',
    })

    context.setDefaultNavigationTimeout(15_000)
    context.setDefaultTimeout(5_000)

    const diagnostics: string[] = []
    context.on('console', (message) => diagnostics.push(`[${message.type()}] ${message.text()}`))
    context.on('weberror', (error) => diagnostics.push(error.error().stack ?? error.error().message))
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    try {
      await provide(context)
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        const tracePath = testInfo.outputPath('trace.zip')
        await context.tracing.stop({ path: tracePath })
        await testInfo.attach('trace', { path: tracePath, contentType: 'application/zip' })
        await testInfo.attach('browser-log', { body: diagnostics.join('\n'), contentType: 'text/plain' })
      } else {
        await context.tracing.stop()
      }
      await context.close()
    }
  },
  extensionServiceWorker: async ({ extensionContext }, provide) => {
    const serviceWorker =
      extensionContext.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://')) ??
      (await extensionContext.waitForEvent('serviceworker', {
        predicate: (worker) => worker.url().startsWith('chrome-extension://'),
        timeout: 15_000,
      }))

    await expect
      .poll(() =>
        serviceWorker.evaluate(async () => {
          const extensionChrome = (
            globalThis as typeof globalThis & { chrome: ChromeStorageApi }
          ).chrome
          const { extensionStatus } = await extensionChrome.storage.local.get(
            'extensionStatus',
          )

          return Boolean(
            extensionStatus &&
              typeof extensionStatus === 'object' &&
              'version' in extensionStatus,
          )
        }),
        { message: 'Extension installation must initialize local storage', timeout: 15_000 },
      )
      .toBe(true)

    // extensionStatus is written alongside other initialization writes. Its
    // presence alone does not mean the mutation queue has finished. A real
    // page-to-worker round trip waits behind initialization before we seed data.
    const bootstrap = await extensionContext.newPage()
    await bootstrap.goto(`chrome-extension://${new URL(serviceWorker.url()).host}/popup.html`)
    const response = await bootstrap.evaluate(() => new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'storage:mutate', command: 'saveTimezone', args: ['UTC'] }, (result) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
        else resolve(result)
      })
    }))
    expect(response).toMatchObject({ ok: true })
    await bootstrap.close()

    await provide(serviceWorker)
  },
  extensionId: async ({ extensionServiceWorker }, provide) => {
    await provide(new URL(extensionServiceWorker.url()).host)
  },
})

export { expect }

export const seedExtensionStorage = async (
  serviceWorker: Worker,
  values: Record<string, unknown>,
): Promise<void> => {
  await serviceWorker.evaluate(async (storageValues: Record<string, unknown>) => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: ChromeStorageApi }
    ).chrome

    await extensionChrome.storage.local.clear()
    await extensionChrome.storage.local.set(storageValues)
  }, values)
}

export const getExtensionStorage = async (
  serviceWorker: Worker,
  keys: string | string[],
): Promise<Record<string, unknown>> =>
  serviceWorker.evaluate(async (storageKeys: string | string[]) => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: ChromeStorageApi }
    ).chrome

    return extensionChrome.storage.local.get(storageKeys)
  }, keys)
