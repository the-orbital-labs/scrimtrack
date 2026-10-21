import { createDailyActivity, splitIntervalByLocalDate, withUpdatedSession } from './activity'
import { getDateKey } from './calendar'
import { getStorageValue, setStorageValues } from './storage'
import { calculateStreakStatus } from './streak'
import { isScrimbaUrl } from './scrimbaUrl'
import type { TrackingReply, TrackingUpdate } from './trackingProtocol'

export const isTrackingUpdate = (value: unknown): value is TrackingUpdate => {
  if (!value || typeof value !== 'object') return false
  const update = value as TrackingUpdate
  return update.type === 'scrimba:tracking-update' &&
    ['start', 'pulse', 'stop', 'activity'].includes(update.kind) &&
    typeof update.epoch === 'string' && typeof update.sessionId === 'string' &&
    Number.isSafeInteger(update.sequence) && update.sequence > 0 &&
    typeof update.url === 'string' && isScrimbaUrl(update.url) &&
    (update.title === null || typeof update.title === 'string') &&
    typeof update.isMediaPlaying === 'boolean' &&
    typeof update.at === 'string' && Number.isFinite(Date.parse(update.at)) &&
    typeof update.from === 'string' && Number.isFinite(Date.parse(update.from)) &&
    Date.parse(update.from) <= Date.parse(update.at)
}

// Called only inside the shared mutation queue. A receipt and every value it
// acknowledges are committed together; a lost reply can safely be replayed.
export const applyTrackingUpdate = async (update: TrackingUpdate): Promise<TrackingReply> => {
  const [state, settings, storedActivities, current] = await Promise.all([
    getStorageValue('trackingState'), getStorageValue('userSettings'),
    getStorageValue('dailyActivities'), getStorageValue('currentScrimbaPage'),
  ])
  if (update.epoch !== state.epoch) {
    return { ok: false, error: 'tracking-reset', epoch: state.epoch }
  }
  const previous = state.sessions[update.sessionId]
  if (previous && update.sequence <= previous.sequence) {
    return { ...previous.reply, sequence: update.sequence }
  }
  if ((previous && update.sequence !== previous.sequence + 1) || (!previous && update.kind !== 'start')) {
    return { ok: false, error: 'out-of-order' }
  }

  const at = Date.parse(update.at)
  const record = previous ? { ...previous } : {
    sequence: 0, at: update.at, startedAt: update.at, accountedAt: update.at, countedUntil: update.at,
    isMediaPlaying: update.isMediaPlaying,
    lastActivityAt: update.at, activeUntil: null, reply: { ok: true },
  }
  const sessions = { ...state.sessions }
  let page = current
  const activities = { ...storedActivities }
  const currentIsNewer = current?.sessionId !== update.sessionId &&
    Date.parse(current?.lastActiveAt ?? '') > at

  if (update.kind === 'start') {
    record.accountedAt = update.at
    record.lastActivityAt = update.at
    record.isMediaPlaying = update.isMediaPlaying
    record.activeUntil = !settings.trackingEnabled ? update.at : currentIsNewer ? current!.lastActiveAt : null
    if (settings.trackingEnabled && current && current.sessionId !== update.sessionId && !currentIsNewer) {
      const displaced = sessions[current.sessionId]
      if (displaced && Date.parse(displaced.countedUntil) > at) {
        // The new tab's start may itself be delayed. Do not count an overlap
        // that the old tab already committed before we learned about the switch.
        record.accountedAt = displaced.countedUntil
      }
      if (displaced) sessions[current.sessionId] = {
        ...displaced,
        activeUntil: displaced.activeUntil ?? update.at,
      }
      // A late stop from the old tab must not close the newly active tab.
      for (const [date, day] of Object.entries(activities)) {
        activities[date] = { ...day, sessions: day.sessions.map((session) =>
          session.id === current.sessionId ? { ...session, isActive: false } : session) }
      }
    }
    if (settings.trackingEnabled && !currentIsNewer) page = {
      sessionId: update.sessionId, url: update.url, title: update.title,
      startedAt: record.startedAt, isActive: true, isIdle: false,
      lastActiveAt: update.at, lastInactiveAt: null,
      lastActivityAt: update.at, lastIdleAt: null,
    }
  }

  const idleAt = Date.parse(record.lastActivityAt) + settings.idleTimeoutSeconds * 1000
  const cutoff = record.activeUntil ? Date.parse(record.activeUntil) : Infinity
  const idle = (update.kind === 'pulse' || update.kind === 'stop') &&
    !update.isMediaPlaying && at >= idleAt && idleAt <= cutoff
  if (update.kind !== 'start') {
    const activity = update.kind === 'activity'
    const from = Math.max(activity ? -Infinity : Date.parse(update.from), Date.parse(record.accountedAt))
    const mediaPlaying = activity ? record.isMediaPlaying : update.isMediaPlaying
    const until = Math.min(at, cutoff, mediaPlaying ? Infinity : idleAt)
    const seconds = Math.max(0, Math.floor((until - from) / 1000))
    if (seconds > 0) {
      record.countedUntil = new Date(from + seconds * 1000).toISOString()
      // Count whole seconds from the interval's actual beginning, preserving
      // idle cutoffs and splitting midnight in the saved timezone.
      for (const segment of splitIntervalByLocalDate(new Date(from).toISOString(), new Date(from + seconds * 1000).toISOString(), settings.timezone)) {
        const day = activities[segment.date] ?? createDailyActivity(segment.date, settings.dailyGoalSeconds)
        const next = withUpdatedSession({ ...day, activeSeconds: day.activeSeconds + segment.activeSeconds },
          segment, update.sessionId, update.url, update.title)
        activities[segment.date] = { ...next, goalCompleted: next.goalSeconds > 0 && next.activeSeconds >= next.goalSeconds }
      }
    }
    // Even a clipped/zero-second interval is consumed. Retrying it must never
    // count time after a subsequent idle, focus, or settings transition.
    const consumedAt = activity && (mediaPlaying || at <= idleAt) && at <= cutoff
      ? from + seconds * 1000 : at
    record.accountedAt = new Date(Math.max(Date.parse(record.accountedAt), consumedAt)).toISOString()
    if (idle || update.kind === 'stop') {
      record.activeUntil = new Date(Math.min(cutoff, idle ? idleAt : at)).toISOString()
    }
  }

  if (update.kind === 'activity') {
    // Flush against the previous idle deadline before renewing it. Otherwise
    // input just before a pulse could retroactively count an earlier idle gap.
    if (record.reply.isIdle && page?.sessionId === update.sessionId && settings.trackingEnabled) {
      record.activeUntil = null
      record.accountedAt = update.at
      page = { ...page, isActive: true, isIdle: false, lastActiveAt: update.at, lastIdleAt: null }
    }
    if (!record.activeUntil) record.lastActivityAt = update.at
    record.isMediaPlaying = update.isMediaPlaying
    if (page?.sessionId === update.sessionId) page = { ...page, lastActivityAt: record.lastActivityAt }
  }

  const isActive = record.activeUntil === null
  for (const [date, day] of Object.entries(activities)) {
    activities[date] = { ...day, sessions: day.sessions.map((session) => session.id === update.sessionId
      ? { ...session, isActive, endedAt: isActive ? session.endedAt : record.activeUntil }
      : session) }
  }
  if (page?.sessionId === update.sessionId) page = {
    ...page, isActive, isIdle: idle || (update.kind === 'activity' ? false : page.isIdle),
    lastInactiveAt: isActive ? page.lastInactiveAt : record.activeUntil,
    lastIdleAt: idle ? record.activeUntil : page.lastIdleAt,
  }
  const reply: TrackingReply = {
    ok: true, epoch: state.epoch, sequence: update.sequence,
    isActive, isIdle: idle, trackingEnabled: settings.trackingEnabled,
  }
  sessions[update.sessionId] = { ...record, at: update.at, sequence: update.sequence, reply }
  await setStorageValues({
    trackingState: { ...state, sessions }, dailyActivities: activities, currentScrimbaPage: page,
    streakStatus: calculateStreakStatus(activities, getDateKey(update.at, settings.timezone)),
  })
  return reply
}

export const trackingOutboxPrefix = 'tracking-outbox:'

export const removeTrackingOutboxEntry = (key: string): Promise<void> => new Promise((resolve, reject) => {
  chrome.storage.local.remove(key, () => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
    else resolve()
  })
})

export const deliverTrackingUpdate = async (update: TrackingUpdate): Promise<TrackingReply> => {
  const reply = await applyTrackingUpdate(update)
  if (reply.ok || reply.error === 'tracking-reset' || reply.trackingEnabled === false) {
    // Removal is housekeeping. A failed removal leaves a safe duplicate to
    // replay after restart, and must not turn a successful commit into failure.
    await removeTrackingOutboxEntry(`${trackingOutboxPrefix}${update.sessionId}:${update.sequence}`).catch(() => {})
  }
  return reply
}

export const replayTrackingOutbox = async (): Promise<void> => {
  const items = await new Promise<Record<string, unknown>>((resolve, reject) => {
    chrome.storage.local.get(null, (values) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
      else resolve(values)
    })
  })
  const pending = Object.entries(items).filter(([key, value]) => key.startsWith(trackingOutboxPrefix) && isTrackingUpdate(value))
    .map(([, value]) => value as TrackingUpdate)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.sequence - b.sequence)
  for (const update of pending) await deliverTrackingUpdate(update)
}
