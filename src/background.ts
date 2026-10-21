import { defineStorageMutation, enableStorageHost, enqueueStorageMutation, executeStorageMutation, settleStorageWrites } from './storageMutations'
import { recalculateStreakStatus } from './activity'
import { ensurePathProgress, recordDetectedScrimbaCourse } from './pathProgress'
import { isScrimbaCourseProgress } from './scrimbaCourse'
import { ensureUserSettings } from './settings'
import { ensureStorageMigrated, updateStorageValue } from './storage'
import { deliverTrackingUpdate, isTrackingUpdate, replayTrackingOutbox, trackingOutboxPrefix } from './tracking'

enableStorageHost()

// Every worker boot and queued operation must pass migration before touching
// history. Retry after a failed initialization without allowing later writes.
let storageReady = false
const ensureReady = async () => {
  if (!storageReady) {
    await ensureStorageMigrated()
    storageReady = true
  }
}
const enqueueReady = <Result>(operation: () => Promise<Result>) =>
  enqueueStorageMutation(async () => { await ensureReady(); return operation() })

// Position is an absolute value, but still goes through the single writer.
defineStorageMutation('saveWidgetPosition', async (position: { x: number; y: number }) => {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new Error('Invalid widget position.')
  }
  return new Promise<boolean>((resolve, reject) => {
    chrome.storage.local.set({ widgetPosition: { x: position.x, y: position.y } }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'Could not save widget position.'))
      } else {
        resolve(true)
      }
    })
  })
})

const startupSnapshot = () => ({
  lastStartedAt: new Date().toISOString(),
  version: chrome.runtime.getManifest().version,
})

chrome.runtime.onInstalled.addListener(() => {
  void enqueueReady(() => settleStorageWrites([
    updateStorageValue('extensionStatus', (extensionStatus) => ({
      ...extensionStatus,
      installedAt: new Date().toISOString(),
      ...startupSnapshot(),
    })),
    ensureUserSettings(),
    ensurePathProgress(),
    recalculateStreakStatus(),
  ])).catch((error: unknown) => {
    console.warn('ScrimTrack could not initialize local data:', error)
  })

  console.info('ScrimTrack installed')
})

chrome.runtime.onStartup.addListener(() => {
  void enqueueReady(() => settleStorageWrites([
    updateStorageValue('extensionStatus', (extensionStatus) => ({
      ...extensionStatus,
      ...startupSnapshot(),
    })),
    recalculateStreakStatus(),
  ])).catch((error: unknown) => {
    console.warn('ScrimTrack could not initialize local data:', error)
  })

  console.info('ScrimTrack service worker started')
})

// Register synchronously so storage changes wake a suspended MV3 worker. The
// outbox also survives a tab closing before its runtime message is delivered.
let replayTimer: ReturnType<typeof setTimeout> | undefined
const replay = () => enqueueReady(replayTrackingOutbox).catch((error: unknown) => {
  console.warn('ScrimTrack could not replay pending tracking data:', error)
  clearTimeout(replayTimer)
  replayTimer = setTimeout(() => { void replay() }, 5_000)
})
chrome.storage.onChanged.addListener((changes, area) => {
  const generation = changes.trackingState as { oldValue?: { epoch?: string }; newValue?: { epoch?: string } } | undefined
  if (area === 'local' && (Object.entries(changes).some(([key, change]) =>
    key.startsWith(trackingOutboxPrefix) && change.newValue) ||
    (generation?.oldValue && generation.newValue?.epoch !== generation.oldValue.epoch))) void replay()
})
void replay()

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return
  const candidate = message as Record<string, unknown>
  const isMutation = candidate.type === 'storage:mutate'
  const isTracking = isTrackingUpdate(message)
  const course = candidate.type === 'scrimba:course-progress-detected' &&
    isScrimbaCourseProgress(candidate.course) ? candidate.course : null
  if (!isMutation && !isTracking && !course) return

  void enqueueReady(async () => {
    if (isMutation) {
      if (typeof candidate.command !== 'string' || !Array.isArray(candidate.args)) {
        throw new Error('Invalid storage mutation.')
      }
      const value = await executeStorageMutation(candidate.command, candidate.args)
      sendResponse({ ok: true, value })
    } else if (isTracking) {
      const reply = await deliverTrackingUpdate(message)
      // A disconnected recipient must not interrupt the mutation queue or
      // undo its durable receipt. The next delivery will receive the receipt.
      try { sendResponse(reply) } catch { /* The tab may have closed. */ }
    } else if (course) {
      const path = await recordDetectedScrimbaCourse(course)
      sendResponse({ ok: true, isSelectedCourse: path.selectedCourseId === course.id,
        progressPercentage: path.progressPercentage })
    }
  }).catch((error: unknown) => {
    console.warn('ScrimTrack could not save local data:', error)
    try { sendResponse({ ok: false, error: isMutation && error instanceof Error ? error.message : 'storage-failure' }) } catch { /* Disconnected tab. */ }
  })
  return true
})
