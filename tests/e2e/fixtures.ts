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
  extensionContext: async ({ headless, playwright }, provide) => {
    const context = await playwright.chromium.launchPersistentContext('', {
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      channel: 'chromium',
      headless,
    })

    context.setDefaultNavigationTimeout(15_000)
    context.setDefaultTimeout(5_000)

    await provide(context)
    await context.close()
  },
  extensionServiceWorker: async ({ extensionContext }, provide) => {
    const serviceWorker =
      extensionContext.serviceWorkers()[0] ??
      (await extensionContext.waitForEvent('serviceworker'))

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
      )
      .toBe(true)

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
