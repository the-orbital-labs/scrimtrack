import { useEffect, useState } from 'react'
import { getLocalDateKey } from './activity'
import type { DailyActivity } from './storage'

type LiveActivitySnapshot = {
  activeSeconds: number
  date: string
  isRunning: boolean
  sourceActivity: DailyActivity | null
}

export const useLiveActivitySeconds = (
  activity: DailyActivity | null,
  isRunning: boolean,
): number => {
  const [liveActivity, setLiveActivity] = useState<LiveActivitySnapshot>(() => ({
    activeSeconds: activity?.activeSeconds ?? 0,
    date: activity?.date ?? getLocalDateKey(),
    isRunning,
    sourceActivity: activity,
  }))

  if (
    liveActivity.sourceActivity !== activity ||
    liveActivity.isRunning !== isRunning
  ) {
    const wasActivityReset =
      activity !== null &&
      !isRunning &&
      activity.activeSeconds === 0 &&
      activity.sessions.length === 0
    const activityDate = activity?.date ?? liveActivity.date
    const activeSeconds =
      liveActivity.date !== activityDate || wasActivityReset
        ? (activity?.activeSeconds ?? 0)
        : Math.max(
            liveActivity.activeSeconds,
            activity?.activeSeconds ?? 0,
          )

    setLiveActivity({
      activeSeconds,
      date: activityDate,
      isRunning,
      sourceActivity: activity,
    })
  }

  useEffect(() => {
    if (!isRunning) {
      return
    }

    const intervalId = window.setInterval(() => {
      const today = getLocalDateKey()

      setLiveActivity((currentActivity) => ({
        ...currentActivity,
        activeSeconds:
          currentActivity.date === today
            ? currentActivity.activeSeconds + 1
            : 1,
        date: today,
      }))
    }, 1_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isRunning])

  if (!activity || liveActivity.date !== activity.date) {
    return activity?.activeSeconds ?? 0
  }

  return Math.max(liveActivity.activeSeconds, activity.activeSeconds)
}
