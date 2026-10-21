import { addCalendarDays, getDateKey, nextDateBoundary } from './calendar'
import { defineStorageMutation } from './storageMutations'
import { getUserSettings } from './settings'
import { getStorageValue, setStorageValue, updateStorageValue } from './storage'
import type { DailyActivity, LearningSession } from './storage'
import { calculateStreakStatus } from './streak'

type StartLearningSessionInput = Omit<
  LearningSession,
  'activeSeconds' | 'endedAt'
>

type AddActiveSecondsInput = {
  activeSeconds: number
  recordedAt?: string
  sessionId?: string
  url?: string
  title?: string | null
}

type AddActiveSecondsIntervalInput = {
  activeSeconds: number
  endedAt: string
  sessionId?: string
  url?: string
  title?: string | null
}

type ActivitySegment = {
  activeSeconds: number
  date: string
  endedAt: string
  startedAt: string
}

export const getLocalDateKey = getDateKey

const splitIntervalByLocalDate = (
  startedAt: string,
  endedAt: string,
  timezone: string,
): ActivitySegment[] => {
  const segments: ActivitySegment[] = []
  let cursor = new Date(startedAt)
  const end = new Date(endedAt)
  const startTime = cursor.getTime()
  let accountedSeconds = 0

  while (cursor < end) {
    const sameDate = getDateKey(cursor, timezone) === getDateKey(new Date(end.getTime() - 1), timezone)
    const segmentEnd = sameDate ? end : nextDateBoundary(cursor, timezone)
    const elapsedSeconds = Math.floor((segmentEnd.getTime() - startTime) / 1000)
    const activeSeconds = elapsedSeconds - accountedSeconds
    accountedSeconds = elapsedSeconds

    if (activeSeconds > 0) {
      segments.push({
        activeSeconds,
        date: getDateKey(cursor, timezone),
        startedAt: cursor.toISOString(),
        endedAt: segmentEnd.toISOString(),
      })
    }

    cursor = segmentEnd
  }

  return segments
}

export const createDailyActivity = (
  date: string,
  goalSeconds = 0,
): DailyActivity => ({
  date,
  activeSeconds: 0,
  goalSeconds,
  goalCompleted: false,
  sessions: [],
})

const getOrCreateActivity = (
  activities: Record<string, DailyActivity>,
  date: string,
  goalSeconds = 0,
): DailyActivity => activities[date] ?? createDailyActivity(date, goalSeconds)

const normalizeActiveSeconds = (activeSeconds: number): number =>
  Math.max(0, Math.floor(activeSeconds))

const withGoalCompletion = (activity: DailyActivity): DailyActivity => ({
  ...activity,
  goalCompleted:
    activity.goalSeconds > 0 && activity.activeSeconds >= activity.goalSeconds,
})

const withUpdatedSession = (
  activity: DailyActivity,
  segment: ActivitySegment,
  sessionId?: string,
  url?: string,
  title?: string | null,
): DailyActivity => {
  if (!sessionId) {
    return activity
  }

  const existingSession = activity.sessions.find(({ id }) => id === sessionId)

  if (!existingSession) {
    return {
      ...activity,
      sessions: [
        ...activity.sessions,
        {
          id: sessionId,
          url: url ?? '',
          title: title ?? null,
          startedAt: segment.startedAt,
          isActive: true,
          endedAt: segment.endedAt,
          activeSeconds: segment.activeSeconds,
        },
      ],
    }
  }

  return {
    ...activity,
    sessions: activity.sessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            url: url ?? session.url,
            title: title ?? session.title,
            isActive: true,
            endedAt: segment.endedAt,
            activeSeconds: session.activeSeconds + segment.activeSeconds,
          }
        : session,
    ),
  }
}

const recalculateStreakForDate = defineStorageMutation(
  'recalculateStreakStatus',
  async (today?: string) => {
    const { timezone } = await getUserSettings()
    const todayKey = today ?? getDateKey(new Date(), timezone)
    const activities = await getStorageValue('dailyActivities')
    const streakStatus = calculateStreakStatus(activities, todayKey)

    await setStorageValue('streakStatus', streakStatus)

    return streakStatus
  },
)

export const recalculateStreakStatus = async (today?: string | Date) => {
  const { timezone } = await getUserSettings()
  return recalculateStreakForDate(today instanceof Date ? getDateKey(today, timezone) : today)
}

export const ensureTodayActivity = async (): Promise<DailyActivity> => {
  const { dailyGoalSeconds, timezone } = await getUserSettings()
  const today = getDateKey(new Date(), timezone)
  const activities = await updateStorageValue('dailyActivities', (current) => ({
    ...current,
    [today]: getOrCreateActivity(current, today, dailyGoalSeconds),
  }))

  return activities[today]
}

export const startLearningSession = async (
  session: StartLearningSessionInput,
): Promise<DailyActivity> => {
  const { dailyGoalSeconds, timezone } = await getUserSettings()
  const date = getDateKey(session.startedAt, timezone)
  const activities = await updateStorageValue('dailyActivities', (current) => {
    const activity = getOrCreateActivity(current, date, dailyGoalSeconds)

    if (activity.sessions.some(({ id }) => id === session.id)) {
      return current
    }

    return {
      ...current,
      [date]: {
        ...activity,
        sessions: [
          ...activity.sessions,
          {
            ...session,
            endedAt: null,
            activeSeconds: 0,
          },
        ],
      },
    }
  })
  const streakStatus = calculateStreakStatus(activities, date)

  await setStorageValue('streakStatus', streakStatus)

  return activities[date]
}

export const setLearningSessionActiveState = async (
  sessionId: string,
  isActive: boolean,
): Promise<boolean> => {
  let didUpdate = false

  await updateStorageValue('dailyActivities', (current) => {
    let nextActivities = current

    for (const [date, activity] of Object.entries(current)) {
      if (!activity.sessions.some(({ id }) => id === sessionId)) {
        continue
      }

      didUpdate = true
      nextActivities = {
        ...nextActivities,
        [date]: {
          ...activity,
          sessions: activity.sessions.map((session) =>
            session.id === sessionId ? { ...session, isActive } : session,
          ),
        },
      }
    }

    return nextActivities
  })

  return didUpdate
}

export const closeLearningSession = async (
  sessionId: string,
  endedAt: string,
): Promise<boolean> => {
  let didUpdate = false

  await updateStorageValue('dailyActivities', (current) => {
    let nextActivities = current

    for (const [date, activity] of Object.entries(current)) {
      if (!activity.sessions.some(({ id }) => id === sessionId)) {
        continue
      }

      didUpdate = true
      nextActivities = {
        ...nextActivities,
        [date]: {
          ...activity,
          sessions: activity.sessions.flatMap((session) => {
            if (session.id !== sessionId) {
              return [session]
            }

            if (session.activeSeconds === 0) {
              return []
            }

            return [
              {
                ...session,
                isActive: false,
                endedAt,
              },
            ]
          }),
        },
      }
    }

    return nextActivities
  })

  return didUpdate
}

export const addActiveSecondsToToday = async ({
  activeSeconds,
  recordedAt = new Date().toISOString(),
  sessionId,
  url,
  title,
}: AddActiveSecondsInput): Promise<DailyActivity> => {
  const seconds = normalizeActiveSeconds(activeSeconds)
  const { dailyGoalSeconds, timezone } = await getUserSettings()
  const date = getDateKey(recordedAt, timezone)
  const activities = await updateStorageValue('dailyActivities', (current) => {
    const activity = getOrCreateActivity(current, date, dailyGoalSeconds)
    const nextActivity = withGoalCompletion({
      ...activity,
      activeSeconds: activity.activeSeconds + seconds,
      sessions: sessionId
        ? activity.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  url: url ?? session.url,
                  title: title ?? session.title,
                  isActive: true,
                  endedAt: recordedAt,
                  activeSeconds: session.activeSeconds + seconds,
                }
              : session,
          )
        : activity.sessions,
    })

    return {
      ...current,
      [date]: nextActivity,
    }
  })
  await setStorageValue('streakStatus', calculateStreakStatus(activities, date))

  return activities[date]
}

export const addActiveSecondsForInterval = async ({
  activeSeconds,
  endedAt,
  sessionId,
  url,
  title,
}: AddActiveSecondsIntervalInput): Promise<DailyActivity[]> => {
  const seconds = normalizeActiveSeconds(activeSeconds)

  if (seconds === 0) {
    return []
  }

  const endedAtTime = new Date(endedAt).getTime()
  const startedAt = new Date(endedAtTime - seconds * 1000).toISOString()
  const { dailyGoalSeconds, timezone } = await getUserSettings()
  const segments = splitIntervalByLocalDate(startedAt, endedAt, timezone)
  const activities = await updateStorageValue('dailyActivities', (current) => {
    let nextActivities = { ...current }

    for (const segment of segments) {
      const activity = getOrCreateActivity(
        nextActivities,
        segment.date,
        dailyGoalSeconds,
      )
      const nextActivity = withGoalCompletion(
        withUpdatedSession(
          {
            ...activity,
            activeSeconds: activity.activeSeconds + segment.activeSeconds,
          },
          segment,
          sessionId,
          url,
          title,
        ),
      )

      nextActivities = {
        ...nextActivities,
        [segment.date]: nextActivity,
      }
    }

    return nextActivities
  })
  const lastSegment = segments.at(-1)

  if (lastSegment) {
    await setStorageValue(
      'streakStatus',
      calculateStreakStatus(activities, lastSegment.date),
    )
  }

  return segments.map((segment) => activities[segment.date])
}

export const getActivityForDate = async (
  date: string | Date,
): Promise<DailyActivity> => {
  const { dailyGoalSeconds, timezone } = await getUserSettings()
  const dateKey = typeof date === 'string' ? date : getDateKey(date, timezone)
  const activities = await getStorageValue('dailyActivities')

  return getOrCreateActivity(activities, dateKey, dailyGoalSeconds)
}

export const getActivityForDateRange = async (
  startDate: string | Date,
  endDate: string | Date,
): Promise<DailyActivity[]> => {
  const { dailyGoalSeconds, timezone } = await getUserSettings()
  const startKey = typeof startDate === 'string' ? startDate : getDateKey(startDate, timezone)
  const endKey = typeof endDate === 'string' ? endDate : getDateKey(endDate, timezone)
  const activities = await getStorageValue('dailyActivities')
  const results: DailyActivity[] = []

  for (let key = startKey; key <= endKey; key = addCalendarDays(key, 1)) {
    results.push(getOrCreateActivity(activities, key, dailyGoalSeconds))
  }

  return results
}

export const updateGoalCompletionStatus = async (
  date: string | Date = new Date(),
): Promise<DailyActivity> => {
  const { dailyGoalSeconds, timezone } = await getUserSettings()
  const dateKey = typeof date === 'string' ? date : getDateKey(date, timezone)
  const activities = await updateStorageValue('dailyActivities', (current) => {
    const activity = getOrCreateActivity(current, dateKey, dailyGoalSeconds)

    return {
      ...current,
      [dateKey]: withGoalCompletion(activity),
    }
  })
  await setStorageValue(
    'streakStatus',
    calculateStreakStatus(activities, dateKey),
  )

  return activities[dateKey]
}

export const getCurrentStreakStatus = async (now = new Date()) => {
  const [activities, settings] = await Promise.all([
    getStorageValue('dailyActivities'), getUserSettings(),
  ])
  return calculateStreakStatus(activities, getDateKey(now, settings.timezone))
}
