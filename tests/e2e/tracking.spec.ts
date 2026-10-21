import type { Worker } from '@playwright/test'
import type { CurrentScrimbaPage, DailyActivity } from '../../src/storage'
import { expect, getExtensionStorage, seedExtensionStorage, test } from './fixtures'

// These tests deliberately observe several real five-second tracking pulses.
test.setTimeout(45_000)

const activities = async (worker: Worker) => {
  const data = await getExtensionStorage(worker, 'dailyActivities')
  return Object.values((data.dailyActivities ?? {}) as Record<string, DailyActivity>)
}
const countedSeconds = async (worker: Worker) =>
  (await activities(worker)).reduce((total, day) => total + day.activeSeconds, 0)

test.beforeEach(async ({ extensionContext, extensionServiceWorker }) => {
  await seedExtensionStorage(extensionServiceWorker, {
    userSettings: {
      dailyGoalSeconds: 1800,
      floatingWidgetVisible: true,
      idleTimeoutSeconds: 120,
      trackingEnabled: true,
      timezone: 'UTC',
    },
  })
  // Route web requests without intercepting the extension's own HTML and JS.
  await extensionContext.route(/^https:\/\//, (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Browser tracking lesson</title><textarea class="cm-content" aria-label="Code editor"></textarea>',
  }))
})

for (const host of ['scrimba.com', 'v2.scrimba.com']) {
  test(`persists real learning time on ${host} and stops when paused`, async ({
    extensionContext, extensionServiceWorker, extensionId,
  }) => {
    const lesson = await extensionContext.newPage()
    await lesson.goto(`https://${host}/e2e-lesson`)
    await lesson.bringToFront()
    await expect(lesson.locator('#scrimtrack-page-widget')).toBeVisible()
    const inputStartedAt = Date.now()
    await lesson.getByRole('textbox', { name: 'Code editor' }).pressSequentially('const learning = true')
    await expect.poll(() => countedSeconds(extensionServiceWorker), { timeout: 12_000 }).toBeGreaterThanOrEqual(5)
    expect(await countedSeconds(extensionServiceWorker))
      .toBeLessThanOrEqual(Math.ceil((Date.now() - inputStartedAt) / 1000))

    const days = await activities(extensionServiceWorker)
    expect(days.flatMap((day) => day.sessions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: `https://${host}/e2e-lesson`, activeSeconds: expect.any(Number) }),
    ]))
    expect(days.flatMap((day) => day.sessions).reduce((total, session) => total + session.activeSeconds, 0))
      .toBe(await countedSeconds(extensionServiceWorker))

    await lesson.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(lesson.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
    const pausedSeconds = await countedSeconds(extensionServiceWorker)
    // Observe more than a complete five-second pulse, with real content-script timers.
    await lesson.waitForTimeout(6_000)
    expect(await countedSeconds(extensionServiceWorker)).toBe(pausedSeconds)

    const popup = await extensionContext.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(popup.getByRole('heading', { name: 'Paused' })).toBeVisible()
    const dashboard = await extensionContext.newPage()
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`)
    await expect(dashboard.getByText(`${pausedSeconds}s / 30m 00s`)).toBeVisible()
    // Persisted data must survive opening a new view and reloading the lesson.
    await lesson.reload()
    expect(await countedSeconds(extensionServiceWorker)).toBe(pausedSeconds)
  })
}

test('caps idle time and resumes counting after editor activity', async ({
  extensionContext, extensionServiceWorker,
}) => {
  await seedExtensionStorage(extensionServiceWorker, {
    userSettings: {
      dailyGoalSeconds: 1800, floatingWidgetVisible: true,
      idleTimeoutSeconds: 2, trackingEnabled: true, timezone: 'UTC',
    },
  })
  const lesson = await extensionContext.newPage()
  await lesson.goto('https://scrimba.com/idle-lesson')
  await lesson.bringToFront()
  const editor = lesson.getByRole('textbox', { name: 'Code editor' })
  await editor.pressSequentially('a')
  await expect.poll(async () => {
    const { currentScrimbaPage } = await getExtensionStorage(extensionServiceWorker, 'currentScrimbaPage')
    return currentScrimbaPage as CurrentScrimbaPage
  }, { timeout: 12_000 }).toMatchObject({ isIdle: true, isActive: false })
  const idleSeconds = await countedSeconds(extensionServiceWorker)
  // The background truncates whole seconds at the idle boundary; subsecond
  // alignment between the input event and pulse may discard one second.
  expect(idleSeconds).toBeGreaterThanOrEqual(1)
  expect(idleSeconds).toBeLessThanOrEqual(2)
  await lesson.waitForTimeout(6_000)
  expect(await countedSeconds(extensionServiceWorker)).toBe(idleSeconds)
  await editor.pressSequentially('b')
  await expect.poll(() => countedSeconds(extensionServiceWorker), { timeout: 12_000 }).toBeGreaterThan(idleSeconds)
  expect(await countedSeconds(extensionServiceWorker)).toBeLessThanOrEqual(idleSeconds + 2)
})

test('does not count a lesson after it loses focus', async ({
  extensionContext, extensionServiceWorker,
}) => {
  const lesson = await extensionContext.newPage()
  await lesson.goto('https://scrimba.com/focus-lesson')
  await lesson.bringToFront()
  await lesson.getByRole('textbox', { name: 'Code editor' }).pressSequentially('a')
  await expect.poll(() => countedSeconds(extensionServiceWorker), { timeout: 12_000 }).toBeGreaterThanOrEqual(5)
  const other = await extensionContext.newPage()
  await other.goto('https://example.com/other')
  // Playwright enables focus emulation for headless pages. Disable it on the
  // lesson so switching tabs exercises Chrome's real visibility/focus events.
  const cdp = await extensionContext.newCDPSession(lesson)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await other.bringToFront()
  await expect.poll(() => lesson.evaluate(() => document.hasFocus())).toBe(false)
  await expect.poll(async () => {
    const { currentScrimbaPage } = await getExtensionStorage(extensionServiceWorker, 'currentScrimbaPage')
    return currentScrimbaPage as CurrentScrimbaPage
  }).toMatchObject({ isActive: false })
  const stoppedSeconds = await countedSeconds(extensionServiceWorker)
  await other.waitForTimeout(6_000)
  expect(await countedSeconds(extensionServiceWorker)).toBe(stoppedSeconds)
  await expect(other.locator('#scrimtrack-page-widget')).toHaveCount(0)
})
