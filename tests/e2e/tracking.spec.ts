import type { Worker } from '@playwright/test'
import type { CurrentScrimbaPage, DailyActivity } from '../../src/storage'
import type { TrackingState, TrackingUpdate } from '../../src/trackingProtocol'
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
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await lesson.bringToFront()
  const resumedAt = Date.now()
  await lesson.getByRole('textbox', { name: 'Code editor' }).pressSequentially('b')
  await expect.poll(() => countedSeconds(extensionServiceWorker), { timeout: 12_000 })
    .toBeGreaterThanOrEqual(stoppedSeconds + 5)
  expect(await countedSeconds(extensionServiceWorker))
    .toBeLessThanOrEqual(stoppedSeconds + Math.ceil((Date.now() - resumedAt) / 1000))
})

test('recovers a lost content-script reply without duplicating the persisted interval', async ({
  extensionContext, extensionServiceWorker, extensionId,
}) => {
  const lesson = await extensionContext.newPage()
  const cdp = await extensionContext.newCDPSession(lesson)
  const worlds: number[] = []
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context.id))
  await cdp.send('Runtime.enable')
  await lesson.goto('https://scrimba.com/interrupted-lesson')
  await expect(lesson.locator('#scrimtrack-page-widget')).toBeVisible()
  let contentWorld: number | undefined
  for (const contextId of worlds) {
    const result = await cdp.send('Runtime.evaluate', {
      contextId, expression: 'typeof chrome !== "undefined" && chrome.runtime?.id', returnByValue: true,
    }).catch(() => null)
    if (result?.result.value === extensionId) contentWorld = contextId
  }
  expect(contentWorld).toBeDefined()
  // Interrupt one actual message callback in the extension's isolated world.
  // The worker still commits it, so the retry must use its stored receipt.
  await cdp.send('Runtime.evaluate', { contextId: contentWorld, expression: `
    (() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let dropped = false;
      chrome.runtime.sendMessage = (message, callback) => {
        if (!dropped && message.type === 'scrimba:tracking-update' && message.kind === 'pulse') {
          dropped = true;
          return send(message, () => { void chrome.runtime.lastError; });
        }
        return send(message, callback);
      };
    })()
  ` })
  await lesson.bringToFront()
  const started = Date.now()
  await lesson.getByRole('textbox', { name: 'Code editor' }).pressSequentially('learning')
  await expect(lesson.locator('#scrimtrack-page-widget').getByText('Saving delayed. Retrying local data...', { exact: true }))
    .toBeVisible({ timeout: 12_000 })
  await expect.poll(() => countedSeconds(extensionServiceWorker), { timeout: 15_000 }).toBeGreaterThanOrEqual(10)
  expect(await countedSeconds(extensionServiceWorker)).toBeLessThanOrEqual(Math.ceil((Date.now() - started) / 1000))
  await expect(lesson.locator('#scrimtrack-page-widget').getByText('Saving delayed. Retrying local data...', { exact: true })).toHaveCount(0)
})

test('reset during tracking invalidates old retries and allows a fresh session', async ({
  extensionContext, extensionServiceWorker, extensionId,
}) => {
  const lesson = await extensionContext.newPage()
  await lesson.goto('https://scrimba.com/reset-lesson')
  await lesson.bringToFront()
  const editor = lesson.getByRole('textbox', { name: 'Code editor' })
  await editor.pressSequentially('first')
  await expect.poll(() => countedSeconds(extensionServiceWorker), { timeout: 12_000 }).toBeGreaterThanOrEqual(5)
  const old = await getExtensionStorage(extensionServiceWorker, ['trackingState', 'currentScrimbaPage'])
  const state = old.trackingState as TrackingState
  const sessionId = (old.currentScrimbaPage as NonNullable<CurrentScrimbaPage>).sessionId
  const record = state.sessions[sessionId]
  const stale: TrackingUpdate = {
    type: 'scrimba:tracking-update', epoch: state.epoch, sessionId, sequence: record.sequence,
    kind: 'pulse', from: record.startedAt, at: record.accountedAt,
    url: lesson.url(), title: null, isMediaPlaying: false,
  }
  const dashboard = await extensionContext.newPage()
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`)
  dashboard.once('dialog', (dialog) => dialog.accept())
  await dashboard.getByRole('button', { name: 'Reset activity only' }).click()
  await expect(dashboard.getByText('Activity data, sessions, and streaks were reset. Settings were kept.')).toBeVisible()
  expect(await countedSeconds(extensionServiceWorker)).toBe(0)
  // Replay a durable old message after reset, as if it arrived from an
  // interrupted tab or a service worker that restarted at the reset boundary.
  await extensionServiceWorker.evaluate(async (message) => {
    await new Promise<void>((resolve) => chrome.storage.local.set({
      [`tracking-outbox:${message.sessionId}:${message.sequence}`]: message,
    }, resolve))
  }, stale)
  await dashboard.waitForTimeout(6_000)
  expect(await countedSeconds(extensionServiceWorker)).toBe(0)
  expect((await getExtensionStorage(extensionServiceWorker, 'currentScrimbaPage')).currentScrimbaPage).toBeNull()
  await lesson.bringToFront()
  await editor.pressSequentially(' fresh')
  await expect.poll(() => countedSeconds(extensionServiceWorker), { timeout: 12_000 }).toBeGreaterThanOrEqual(5)
  const next = await getExtensionStorage(extensionServiceWorker, 'trackingState')
  expect((next.trackingState as TrackingState).epoch).not.toBe(state.epoch)
  expect(Object.keys((next.trackingState as TrackingState).sessions)).not.toContain(sessionId)
})
