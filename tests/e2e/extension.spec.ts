import type { BrowserContext } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  expect,
  getExtensionStorage,
  seedExtensionStorage,
  test,
} from './fixtures'

const getLocalDateKey = (date: Date): string => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const addDays = (date: Date, amount: number): Date => {
  const nextDate = new Date(date)

  nextDate.setUTCDate(nextDate.getUTCDate() + amount)

  return nextDate
}

const createTestStorage = (): Record<string, unknown> => {
  const today = new Date()
  const activities = [
    { date: addDays(today, -2), activeSeconds: 45 * 60 },
    { date: addDays(today, -1), activeSeconds: 35 * 60 },
    { date: today, activeSeconds: 20 * 60 },
  ].map(({ date, activeSeconds }) => ({
    activeSeconds,
    date: getLocalDateKey(date),
    goalCompleted: activeSeconds >= 30 * 60,
    goalSeconds: 30 * 60,
    sessions: [],
  }))

  return {
    currentScrimbaPage: null,
    dailyActivities: Object.fromEntries(
      activities.map((activity) => [activity.date, activity]),
    ),
    extensionStatus: {
      installedAt: today.toISOString(),
      lastStartedAt: today.toISOString(),
      version: '0.3.0',
    },
    pathProgress: {
      averageWindowDays: 7,
      courseUrl: 'https://scrimba.com/frontend-path-c0j',
      detectedCourses: {},
      lastProgressSyncAt: null,
      pathName: 'Frontend Developer Path',
      progressPercentage: 25,
      progressSource: 'manual',
      selectedCourseId: 'c0j',
      totalEstimatedHours: 80,
    },
    streakStatus: {
      currentStreak: 3,
      lastCalculatedAt: today.toISOString(),
      longestStreak: 3,
    },
    userSettings: {
      dailyGoalSeconds: 30 * 60,
      floatingWidgetVisible: true,
      idleTimeoutSeconds: 2 * 60,
      timezone: 'UTC',
      trackingEnabled: true,
    },
  }
}

const openExtensionPage = async (
  context: BrowserContext,
  extensionId: string,
  path: 'dashboard.html' | 'popup.html',
) => {
  const page = await context.newPage()

  await page.goto(`chrome-extension://${extensionId}/${path}`)

  return page
}

test.beforeEach(async ({ extensionServiceWorker }) => {
  await seedExtensionStorage(extensionServiceWorker, createTestStorage())
})

test.afterEach(async ({ extensionContext }) => {
  await Promise.all(extensionContext.pages().map((page) => page.close()))
})

test('persists popup settings and shows them on the dashboard', async ({
  extensionContext,
  extensionId,
  extensionServiceWorker,
}) => {
  const popup = await openExtensionPage(
    extensionContext,
    extensionId,
    'popup.html',
  )

  await expect(
    popup.getByRole('heading', { name: 'Learning status' }),
  ).toBeVisible()
  await expect(popup.getByLabel("Today's progress")).toContainText('20m 00s')
  await expect(popup.getByLabel("Today's progress")).toContainText('30m 00s')

  await popup.locator('summary', { hasText: 'Settings' }).click()
  await popup
    .getByRole('group', { name: 'Daily goal presets' })
    .getByRole('button', { name: '45m' })
    .click()
  await expect(popup.getByText('Saved 45m 00s daily goal.')).toBeVisible()

  const dashboard = await openExtensionPage(
    extensionContext,
    extensionId,
    'dashboard.html',
  )

  await expect(dashboard.getByRole('heading', { name: 'ScrimTrack' })).toBeVisible()
  await expect(dashboard.getByText('20m 00s / 45m 00s')).toBeVisible()

  const { userSettings } = await getExtensionStorage(
    extensionServiceWorker,
    'userSettings',
  )

  expect(userSettings).toMatchObject({ dailyGoalSeconds: 45 * 60 })
})

test('syncs tracking changes between the dashboard and popup', async ({
  extensionContext,
  extensionId,
}) => {
  const popup = await openExtensionPage(
    extensionContext,
    extensionId,
    'popup.html',
  )
  const dashboard = await openExtensionPage(
    extensionContext,
    extensionId,
    'dashboard.html',
  )

  const trackingToggle = dashboard.getByRole('checkbox', {
    name: /Tracking on/,
  })

  await expect(trackingToggle).toBeChecked()
  await trackingToggle.click()

  await expect(
    dashboard.getByText(
      'Tracking is paused. No Scrimba activity will be counted.',
    ),
  ).toBeVisible()
  await expect(popup.getByRole('heading', { name: 'Paused' })).toBeVisible()
  await expect(popup.getByLabel('Tracking paused')).toContainText(
    'No Scrimba activity will be counted',
  )
})

test('preserves simultaneous settings saves from the popup and dashboard', async ({
  extensionContext,
  extensionId,
  extensionServiceWorker,
}) => {
  const popup = await openExtensionPage(extensionContext, extensionId, 'popup.html')
  const dashboard = await openExtensionPage(extensionContext, extensionId, 'dashboard.html')
  await popup.locator('summary', { hasText: 'Settings' }).click()
  const goal = popup.getByRole('group', { name: 'Daily goal presets' })
    .getByRole('button', { name: '45m' })
  const tracking = dashboard.getByRole('checkbox', { name: /Tracking on/ })

  await Promise.all([goal.click(), tracking.click()])

  await expect.poll(async () => {
    const { userSettings } = await getExtensionStorage(extensionServiceWorker, 'userSettings')
    return userSettings
  }).toMatchObject({ dailyGoalSeconds: 2700, trackingEnabled: false })
  await expect(popup.getByRole('heading', { name: 'Paused' })).toBeVisible()
})

test('injects the widget only on supported Scrimba pages', async ({
  extensionContext,
  extensionServiceWorker,
}) => {
  await extensionContext.route('https://scrimba.com/**', async (route) => {
    await route.fulfill({
      body: '<!doctype html><html><head><title>Test Scrim</title></head><body><main>Scrimba lesson</main></body></html>',
      contentType: 'text/html',
      status: 200,
    })
  })
  await extensionContext.route('https://example.com/**', async (route) => {
    await route.fulfill({
      body: '<!doctype html><html><head><title>Other site</title></head><body><main>Other site</main></body></html>',
      contentType: 'text/html',
      status: 200,
    })
  })

  const scrimbaPage = await extensionContext.newPage()
  await scrimbaPage.goto('https://scrimba.com/e2e-course')

  const widget = scrimbaPage.locator('#scrimtrack-page-widget')

  await expect(widget).toBeVisible()
  await expect(widget.getByLabel('ScrimTrack page widget')).toBeVisible()
  await widget.getByRole('button', { name: 'Pause' }).click()
  await expect(widget.getByRole('button', { name: 'Resume' })).toBeVisible()

  const { userSettings } = await getExtensionStorage(
    extensionServiceWorker,
    'userSettings',
  )

  expect(userSettings).toMatchObject({ trackingEnabled: false })

  const unsupportedPage = await extensionContext.newPage()
  await unsupportedPage.goto('https://example.com/no-extension')
  await expect(
    unsupportedPage.locator('#scrimtrack-page-widget'),
  ).toHaveCount(0)
})

test('reports a worker storage failure and recovers on the next save', async ({
  extensionContext, extensionId, extensionServiceWorker,
}) => {
  const popup = await openExtensionPage(extensionContext, extensionId, 'popup.html')
  await popup.locator('summary', { hasText: 'Settings' }).click()
  const goal = popup.getByRole('group', { name: 'Daily goal presets' })
    .getByRole('button', { name: '45m' })
  await extensionServiceWorker.evaluate(() => {
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local)
    chrome.storage.local.set = () => {
      chrome.storage.local.set = originalSet
      throw new Error('Injected storage write failure')
    }
  })
  await goal.click()
  await expect(popup.getByText('Could not save the daily goal. Reload and try again.')).toBeVisible()
  await expect(popup.getByText('Saved 45m 00s daily goal.')).toHaveCount(0)
  expect((await getExtensionStorage(extensionServiceWorker, 'userSettings')).userSettings)
    .toMatchObject({ dailyGoalSeconds: 1800 })
  await goal.click()
  await expect(popup.getByText('Saved 45m 00s daily goal.')).toBeVisible()
  expect((await getExtensionStorage(extensionServiceWorker, 'userSettings')).userSettings)
    .toMatchObject({ dailyGoalSeconds: 2700 })
})

test('refreshes open views when the saved timezone changes across a date boundary', async ({
  extensionContext, extensionId, extensionServiceWorker,
}) => {
  const storage = createTestStorage()
  await seedExtensionStorage(extensionServiceWorker, {
    ...storage,
    userSettings: { ...(storage.userSettings as object), timezone: 'America/Los_Angeles' },
    dailyActivities: Object.fromEntries([
      ['2026-03-08', 600], ['2026-03-09', 1200],
    ].map(([date, activeSeconds]) => [date, {
      date, activeSeconds, goalSeconds: 1800, goalCompleted: false, sessions: [],
    }])),
  })
  const popup = await extensionContext.newPage()
  const dashboard = await extensionContext.newPage()
  for (const [page, path] of [[popup, 'popup.html'], [dashboard, 'dashboard.html']] as const) {
    // UI clocks only: this test exercises calendar rendering, not time counting.
    await page.clock.setFixedTime(new Date('2026-03-09T00:30:00Z'))
    await page.goto(`chrome-extension://${extensionId}/${path}`)
  }
  await expect(popup.getByLabel("Today's progress")).toContainText('10m 00s')
  await expect(dashboard.getByText('10m 00s / 30m 00s')).toBeVisible()
  await popup.locator('summary', { hasText: 'Settings' }).click()
  await popup.getByRole('textbox', { name: 'Timezone', exact: true }).fill('Asia/Tokyo')
  await popup.getByRole('textbox', { name: 'Timezone', exact: true }).press('Tab')
  await expect(popup.getByLabel("Today's progress")).toContainText('20m 00s')
  await expect(dashboard.getByText('20m 00s / 30m 00s')).toBeVisible()
  expect((await getExtensionStorage(extensionServiceWorker, 'dailyActivities')).dailyActivities)
    .toEqual(expect.objectContaining({
      '2026-03-08': expect.objectContaining({ activeSeconds: 600 }),
      '2026-03-09': expect.objectContaining({ activeSeconds: 1200 }),
    }))
})

test('exports the stored data as a readable JSON download', async ({
  extensionContext, extensionId,
}) => {
  const dashboard = await openExtensionPage(extensionContext, extensionId, 'dashboard.html')
  const downloadEvent = dashboard.waitForEvent('download')
  await dashboard.getByRole('button', { name: 'Download JSON export' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/^scrimtrack-\d{4}-\d{2}-\d{2}\.json$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  const data = JSON.parse(await readFile(path!, 'utf8'))
  expect(data).toMatchObject({ app: 'scrimtrack', schemaVersion: 2, data: {
    userSettings: { timezone: 'UTC', dailyGoalSeconds: 1800 },
    pathProgress: { pathName: 'Frontend Developer Path' },
  } })
  expect(Object.keys(data.data.dailyActivities)).toHaveLength(3)
})

test('cancels reset safely and resets activity without changing settings', async ({
  extensionContext, extensionId, extensionServiceWorker,
}) => {
  const dashboard = await openExtensionPage(extensionContext, extensionId, 'dashboard.html')
  const popup = await openExtensionPage(extensionContext, extensionId, 'popup.html')
  const reset = dashboard.getByRole('button', { name: 'Reset activity only' })
  const before = await getExtensionStorage(extensionServiceWorker, ['dailyActivities', 'userSettings', 'pathProgress'])
  dashboard.once('dialog', (dialog) => dialog.dismiss())
  await reset.click()
  expect(await getExtensionStorage(extensionServiceWorker, ['dailyActivities', 'userSettings', 'pathProgress'])).toEqual(before)
  dashboard.once('dialog', (dialog) => dialog.accept())
  await reset.click()
  await expect(dashboard.getByText('Activity data, sessions, and streaks were reset. Settings were kept.')).toBeVisible()
  await expect(popup.getByLabel("Today's progress").getByText('0s', { exact: true })).toBeVisible()
  const after = await getExtensionStorage(extensionServiceWorker, ['dailyActivities', 'userSettings', 'pathProgress', 'currentScrimbaPage', 'streakStatus'])
  expect(after).toMatchObject({
    currentScrimbaPage: null,
    userSettings: before.userSettings,
    pathProgress: before.pathProgress,
    streakStatus: { currentStreak: 0, longestStreak: 0 },
  })
  expect(Object.values(after.dailyActivities as object).every((day) => day.activeSeconds === 0 && day.sessions.length === 0)).toBe(true)
})
