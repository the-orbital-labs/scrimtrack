import type { StorageKey, StorageSchema } from './storage'
import { isScrimbaCourseProgress } from './scrimbaCourse'

export const storageVersion = 3 as const

export class DataValidationError extends Error {
  constructor(path: string) {
    super(`Invalid local data: ${path}. No data was changed.`)
    this.name = 'DataValidationError'
  }
}

type Check = (value: unknown) => boolean
const object: Check = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const text: Check = (v) => typeof v === 'string'
const nonempty: Check = (v) => text(v) && (v as string).length > 0
const bool: Check = (v) => typeof v === 'boolean'
const number = (min = 0, max = Number.MAX_SAFE_INTEGER): Check =>
  (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const integer = (min = 0, max = Number.MAX_SAFE_INTEGER): Check =>
  (v) => number(min, max)(v) && Number.isSafeInteger(v)
const nullable = (check: Check): Check => (v) => v === null || check(v)
const timestamp: Check = (v) => typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v.slice(0, 10)
const date: Check = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
const url: Check = (v) => {
  if (typeof v !== 'string') return false
  try {
    const parsed = new URL(v)
    return parsed.protocol === 'https:' && ['scrimba.com', 'v2.scrimba.com'].includes(parsed.hostname) &&
      !parsed.username && !parsed.password && !parsed.port
  } catch { return false }
}
const timezone: Check = (v) => {
  if (typeof v !== 'string' || !v) return false
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true } catch { return false }
}

function fields(value: unknown, checks: Record<string, Check>, path: string): asserts value is Record<string, unknown> {
  if (!object(value)) throw new DataValidationError(path)
  for (const [key, check] of Object.entries(checks)) {
    if (!check((value as Record<string, unknown>)[key])) throw new DataValidationError(`${path}.${key}`)
  }
}

function record(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!object(value)) throw new DataValidationError(path)
  if (Object.keys(value as object).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) {
    throw new DataValidationError(path)
  }
}

// Validate at the persistence boundary as well as at import. Invalid existing
// data is reported, never silently replaced with an empty history.
export function validateStorageValue<Key extends StorageKey>(key: Key, value: unknown): asserts value is StorageSchema[Key] {
  const path = key
  switch (key) {
    case 'storageVersion':
      if (value !== storageVersion) throw new DataValidationError(path)
      break
    case 'extensionStatus':
      fields(value, { installedAt: nullable(timestamp), lastStartedAt: nullable(timestamp), version: nullable(text) }, path)
      break
    case 'userSettings':
      fields(value, { dailyGoalSeconds: integer(1, 86400), floatingWidgetVisible: bool,
        idleTimeoutSeconds: integer(), trackingEnabled: bool, timezone }, path)
      break
    case 'streakStatus':
      fields(value, { currentStreak: integer(), longestStreak: integer(), lastCalculatedAt: nullable(timestamp) }, path)
      break
    case 'currentScrimbaPage':
      if (value === null) break
      fields(value, { sessionId: nonempty, url, title: nullable(text), startedAt: timestamp,
        isActive: bool, isIdle: bool, lastActiveAt: nullable(timestamp), lastInactiveAt: nullable(timestamp),
        lastActivityAt: nullable(timestamp), lastIdleAt: nullable(timestamp) }, path)
      break
    case 'dailyActivities':
      record(value, path)
      for (const [key, activity] of Object.entries(value)) {
        if (!date(key)) throw new DataValidationError(`${path}.${key}`)
        fields(activity, { date: (v) => v === key, activeSeconds: integer(), goalSeconds: integer(0, 86400),
          goalCompleted: bool, sessions: Array.isArray }, `${path}.${key}`)
        const ids = new Set<string>()
        let total = 0
        for (const session of activity.sessions as unknown[]) {
          fields(session, { id: nonempty, url: (v) => v === '' || url(v), title: nullable(text), startedAt: timestamp,
            isActive: bool, endedAt: nullable(timestamp), activeSeconds: integer() }, `${path}.${key}.sessions`)
          if (ids.has(session.id as string) || (session.endedAt !== null &&
            Date.parse(session.endedAt as string) < Date.parse(session.startedAt as string))) throw new DataValidationError(`${path}.${key}.sessions`)
          ids.add(session.id as string)
          total += session.activeSeconds as number
        }
        // Older exports can contain totals without session detail.
        if (total > (activity.activeSeconds as number)) throw new DataValidationError(`${path}.${key}.activeSeconds`)
      }
      break
    case 'pathProgress':
      fields(value, { courseUrl: nullable(url), detectedCourses: object, lastProgressSyncAt: nullable(timestamp),
        pathName: text, progressSource: (v) => v === 'manual' || v === 'scrimba', totalEstimatedHours: number(Number.MIN_VALUE),
        progressPercentage: number(0, 100), selectedCourseId: nullable(nonempty),
        averageWindowDays: (v) => [7, 14, 30, 'all'].includes(v as number | string) }, path)
      record(value.detectedCourses, `${path}.detectedCourses`)
      for (const [id, course] of Object.entries(value.detectedCourses)) {
        if (!isScrimbaCourseProgress(course) || course.id !== id || !timestamp(course.detectedAt) ||
          !url(course.url) || !nullable(integer())(course.completedItems) || !nullable(integer(1))(course.totalItems) ||
          (course.completedItems !== null && course.totalItems !== null && course.completedItems > course.totalItems)) {
          throw new DataValidationError(`${path}.detectedCourses.${id}`)
        }
      }
      break
    case 'trackingState':
      fields(value, { epoch: nonempty, sessions: object }, path)
      record(value.sessions, `${path}.sessions`)
      for (const receipt of Object.values(value.sessions)) {
        fields(receipt, { sequence: integer(1), at: timestamp, accountedAt: timestamp, countedUntil: timestamp,
          isMediaPlaying: bool, lastActivityAt: timestamp, startedAt: timestamp, activeUntil: nullable(timestamp), reply: object }, path)
        fields(receipt.reply, { ok: bool }, `${path}.reply`)
        for (const [key, check] of Object.entries({ epoch: nonempty, sequence: integer(1), isIdle: bool,
          isActive: bool, trackingEnabled: bool, error: text })) {
          if (key in receipt.reply && !check(receipt.reply[key])) throw new DataValidationError(`${path}.reply.${key}`)
        }
      }
  }
}

export function validateVersion(version: unknown): void {
  if (version !== undefined && (!Number.isInteger(version) || (version as number) < 0 || (version as number) > storageVersion)) {
    throw new Error('This data uses an unsupported storage version. Update ScrimTrack before opening it. No data was changed.')
  }
}
