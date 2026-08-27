import type { BrowserContext } from '@playwright/test'
import {
  expect,
  getExtensionStorage,
  seedExtensionStorage,
  test,
} from './fixtures'

const getLocalDateKey = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const addDays = (date: Date, amount: number): Date => {
  const nextDate = new Date(date)

  nextDate.setDate(nextDate.getDate() + amount)

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
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
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
