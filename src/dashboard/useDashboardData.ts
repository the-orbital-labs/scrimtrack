import { useCallback, useEffect, useState } from 'react'
import { getActivityForDate, getCurrentStreakStatus, recalculateStreakStatus } from '../activity'
import { secondsToMinutes } from '../goalProgress'
import { getDashboardHeatmapGrid } from '../heatmap'
import type { HeatmapGrid } from '../heatmap'
import { getPathProgress } from '../pathProgress'
import { getFinishEstimateText, getPathProjection } from '../projection'
import type { PathProjection } from '../projection'
import { getUserSettings } from '../settings'
import { getStorageValue } from '../storage'
import type { CurrentScrimbaPage, DailyActivity, PathProgress, StreakStatus, UserSettings } from '../storage'
import { getAllTimeStats, getCurrentMonthTimeStats, getCurrentWeekTimeStats } from '../timeStats'
import type { AllTimeStats, MonthlyTimeStats, WeeklyTimeStats } from '../timeStats'
import { getCurrentMonthSummary } from '../monthlySummary'
import type { MonthlySummary } from '../monthlySummary'
import { getCurrentWeekSummary } from '../weeklySummary'
import type { WeeklySummary } from '../weeklySummary'

export function useDashboardData() {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [todayActivity, setTodayActivity] = useState<DailyActivity | null>(null)
  const [currentScrimbaPage, setCurrentScrimbaPage] =
    useState<CurrentScrimbaPage>(null)
  const [streakStatus, setStreakStatus] = useState<StreakStatus | null>(null)
  const [heatmapGrid, setHeatmapGrid] = useState<HeatmapGrid | null>(null)
  const [weeklyTimeStats, setWeeklyTimeStats] = useState<WeeklyTimeStats | null>(null)
  const [monthlyTimeStats, setMonthlyTimeStats] = useState<MonthlyTimeStats | null>(null)
  const [allTimeStats, setAllTimeStats] = useState<AllTimeStats | null>(null)
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary | null>(null)
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary | null>(null)
  const [pathProgress, setPathProgress] = useState<PathProgress | null>(null)
  const [finishDateText, setFinishDateText] = useState('Study on Scrimba to estimate')
  const [finishDateLabel, setFinishDateLabel] = useState('Not estimated yet')
  const [averagePaceSeconds, setAveragePaceSeconds] = useState(0)
  const [completedHours, setCompletedHours] = useState(0)
  const [remainingHours, setRemainingHours] = useState(0)
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState('30')
  const [idleTimeoutSeconds, setIdleTimeoutSeconds] = useState(2 * 60)
  const [totalEstimatedHours, setTotalEstimatedHours] = useState('1')
  const [progressPercentage, setProgressPercentage] = useState('0')
  const [storageError, setStorageError] = useState<string | null>(null)

  const syncProjection = useCallback((projection: PathProjection) => {
    setFinishDateText(getFinishEstimateText(projection, 'full'))
    setFinishDateLabel(projection.finishDateLabel ?? 'Not estimated yet')
    setAveragePaceSeconds(projection.averageDailySeconds)
    setCompletedHours(projection.completedHours)
    setRemainingHours(projection.remainingHours)
  }, [])

  const refreshTodayActivity = useCallback(() => {
    void Promise.all([
      getActivityForDate(new Date()),
      getCurrentStreakStatus(),
      getDashboardHeatmapGrid(),
      getCurrentWeekTimeStats(),
      getCurrentMonthTimeStats(),
      getAllTimeStats(),
      getCurrentWeekSummary(),
      getCurrentMonthSummary(),
      getPathProjection(),
      getStorageValue('currentScrimbaPage'),
    ]).then(
      ([
        activity,
        streak,
        heatmap,
        weekStats,
        monthStats,
        allStats,
        summary,
        monthSummary,
        projection,
        currentPage,
      ]) => {
        setTodayActivity(activity)
        setStreakStatus(streak)
        setHeatmapGrid(heatmap)
        setWeeklyTimeStats(weekStats)
        setMonthlyTimeStats(monthStats)
        setAllTimeStats(allStats)
        setWeeklySummary(summary)
        setMonthlySummary(monthSummary)
        setCurrentScrimbaPage(currentPage)
        syncProjection(projection)
      },
    ).catch(() => {
      setStorageError('Could not load local data. Displayed values may be out of date. Reload and try again.')
    })
  }, [syncProjection])

  useEffect(() => {
    let isMounted = true
    let isSettingsListenerAttached = false
    const refreshIntervalId = window.setInterval(refreshTodayActivity, 5_000)
    const handleSettingsChange = (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') {
        return
      }

      if (changes.dailyActivities || changes.trackingState) refreshTodayActivity()

      const currentPageChange = changes.currentScrimbaPage

      if (currentPageChange && 'newValue' in currentPageChange) {
        setCurrentScrimbaPage(
          (currentPageChange.newValue as CurrentScrimbaPage | undefined) ?? null,
        )
      }

      const pathProgressChange = changes.pathProgress

      if (pathProgressChange && 'newValue' in pathProgressChange) {
        void getPathProgress().then((nextPathProgress) => {
          setPathProgress(nextPathProgress)
          setTotalEstimatedHours(String(nextPathProgress.totalEstimatedHours))
          setProgressPercentage(String(nextPathProgress.progressPercentage))
          void getPathProjection().then(syncProjection).catch(() => {
            setStorageError('Could not load local data. Displayed values may be out of date. Reload and try again.')
          })
        }).catch(() => {
          setStorageError('Could not load local data. Displayed values may be out of date. Reload and try again.')
        })
      }

      const nextSettings = changes.userSettings?.newValue

      if (!nextSettings || typeof nextSettings !== 'object') {
        return
      }

      const nextUserSettings = nextSettings as Partial<UserSettings>

      if (typeof nextUserSettings.timezone === 'string') refreshTodayActivity()

      setSettings((currentSettings) =>
        currentSettings
          ? { ...currentSettings, ...nextUserSettings }
          : currentSettings,
      )

      if (typeof nextUserSettings.idleTimeoutSeconds === 'number') {
        setIdleTimeoutSeconds(nextUserSettings.idleTimeoutSeconds)
      }
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener(handleSettingsChange)
        isSettingsListenerAttached = true
      }
    } catch {
      isSettingsListenerAttached = false
    }

    void Promise.all([
      getUserSettings(),
      getActivityForDate(new Date()),
      recalculateStreakStatus(),
      getDashboardHeatmapGrid(),
      getCurrentWeekTimeStats(),
      getCurrentMonthTimeStats(),
      getAllTimeStats(),
      getCurrentWeekSummary(),
      getCurrentMonthSummary(),
      getPathProgress(),
      getPathProjection(),
      getStorageValue('currentScrimbaPage'),
    ]).then(
      ([
        loadedSettings,
        loadedTodayActivity,
        loadedStreakStatus,
        loadedHeatmapGrid,
        loadedWeeklyTimeStats,
        loadedMonthlyTimeStats,
        loadedAllTimeStats,
        loadedWeeklySummary,
        loadedMonthlySummary,
        loadedPathProgress,
        projection,
        loadedCurrentScrimbaPage,
      ]) => {
        if (!isMounted) {
          return
        }

        setSettings(loadedSettings)
        setTodayActivity(loadedTodayActivity)
        setStreakStatus(loadedStreakStatus)
        setHeatmapGrid(loadedHeatmapGrid)
        setWeeklyTimeStats(loadedWeeklyTimeStats)
        setMonthlyTimeStats(loadedMonthlyTimeStats)
        setAllTimeStats(loadedAllTimeStats)
        setWeeklySummary(loadedWeeklySummary)
        setMonthlySummary(loadedMonthlySummary)
        setPathProgress(loadedPathProgress)
        setCurrentScrimbaPage(loadedCurrentScrimbaPage)
        syncProjection(projection)
        setTotalEstimatedHours(String(loadedPathProgress.totalEstimatedHours))
        setProgressPercentage(String(loadedPathProgress.progressPercentage))
        setDailyGoalMinutes(
          String(secondsToMinutes(loadedSettings.dailyGoalSeconds)),
        )
        setIdleTimeoutSeconds(loadedSettings.idleTimeoutSeconds)
      },
    ).catch(() => {
      setStorageError('Could not load local data. Displayed values may be out of date. Reload and try again.')
    })

    return () => {
      isMounted = false
      window.clearInterval(refreshIntervalId)
      if (isSettingsListenerAttached) {
        try {
          chrome.storage.onChanged.removeListener(handleSettingsChange)
        } catch {
          // The extension context may already be invalidated during cleanup.
        }
      }
    }
  }, [refreshTodayActivity, syncProjection])

  return {
    settings,
    setSettings,
    todayActivity,
    currentScrimbaPage,
    streakStatus,
    setStreakStatus,
    heatmapGrid,
    weeklyTimeStats,
    monthlyTimeStats,
    allTimeStats,
    weeklySummary,
    monthlySummary,
    pathProgress,
    setPathProgress,
    finishDateText,
    finishDateLabel,
    averagePaceSeconds,
    completedHours,
    remainingHours,
    dailyGoalMinutes,
    setDailyGoalMinutes,
    idleTimeoutSeconds,
    setIdleTimeoutSeconds,
    totalEstimatedHours,
    setTotalEstimatedHours,
    progressPercentage,
    setProgressPercentage,
    storageError,
    setStorageError,
    syncProjection,
    refreshTodayActivity,
  }
}
