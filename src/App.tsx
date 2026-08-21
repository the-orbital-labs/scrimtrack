import { useEffect, useState } from 'react'
import './App.css'
import {
  getActivityForDate,
  getLocalDateKey,
  recalculateStreakStatus,
} from './activity'
import { downloadLocalDataExport } from './dataExport'
import { formatActiveTime, getGoalProgress, secondsToMinutes } from './goalProgress'
import { getDashboardHeatmapGrid } from './heatmap'
import type { HeatmapGrid, HeatmapWeek } from './heatmap'
import { getHeatmapTooltipLines, getHeatmapTooltipText } from './heatmapTooltip'
import {
  getIdleTimeoutPresetLabel,
  idleTimeoutPresets,
  isIdleTimeoutPreset,
} from './idleTimeout'
import {
  getPathProgress,
  getSelectableScrimbaCourses,
  getSelectedScrimbaCourse,
  isValidAverageWindowDays,
  isValidProgressPercentage,
  isValidTotalEstimatedHours,
  parseAverageWindowDays,
  saveAverageWindowDays,
  saveProgressPercentage,
  saveTotalEstimatedHours,
  selectScrimbaCourse,
} from './pathProgress'
import {
  formatHoursPerDay,
  formatPathHours,
  getFinishEstimateText,
  getPathProjection,
} from './projection'
import type { PathProjection } from './projection'
import { builtInScrimbaCourses } from './scrimbaCourse'
import {
  getUserSettings,
  saveDailyGoal,
  saveFloatingWidgetVisible,
  saveIdleTimeout,
  saveTrackingEnabled,
} from './settings'
import { getStorageValue, resetLocalData } from './storage'
import type {
  AverageWindowDays,
  CurrentScrimbaPage,
  DailyActivity,
  PathProgress,
  StreakStatus,
  UserSettings,
} from './storage'
import { getStreakDisplayState } from './streakDisplay'
import {
  getAllTimeStats,
  getCurrentMonthTimeStats,
  getCurrentWeekTimeStats,
} from './timeStats'
import type { AllTimeStats, MonthlyTimeStats, WeeklyTimeStats } from './timeStats'
import { getCurrentMonthSummary } from './monthlySummary'
import type { MonthlySummary } from './monthlySummary'
import { getCurrentWeekSummary } from './weeklySummary'
import type { WeeklySummary } from './weeklySummary'
import { useLiveActivitySeconds } from './useLiveActivitySeconds'

const dailyGoalPresetMinutes = [15, 30, 45, 60] as const
const heatmapPeriodOptions = ['year', 'month', 'week'] as const
const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' })
const dateRangeFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
  year: 'numeric',
})

type HeatmapPeriod = (typeof heatmapPeriodOptions)[number]

const heatmapPeriodLabels: Record<HeatmapPeriod, string> = {
  year: 'Last 365 days',
  month: 'This month',
  week: 'This week',
}

const pluralizeActiveDays = (count: number): string =>
  `${count} active ${count === 1 ? 'day' : 'days'}`

const isValidDailyGoalMinutes = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && value <= 24 * 60

const parseLocalDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number)

  return new Date(year, month - 1, day)
}

const getMonthKey = (dateKey: string): string => {
  const date = parseLocalDateKey(dateKey)

  return `${date.getFullYear()}-${date.getMonth()}`
}

const getMonthLabel = (
  week: HeatmapWeek,
  weekIndex: number,
  weeks: HeatmapWeek[],
): string => {
  const previousMonthKeys = new Set(
    weeks
      .slice(0, weekIndex)
      .flatMap((previousWeek) => previousWeek.days)
      .filter((day) => !day.isOutsideRange)
      .map((day) => getMonthKey(day.date)),
  )
  const firstNewMonthDay = week.days.find(
    (day) => !day.isOutsideRange && !previousMonthKeys.has(getMonthKey(day.date)),
  )

  return firstNewMonthDay
    ? monthFormatter.format(parseLocalDateKey(firstNewMonthDay.date))
    : ''
}

const getWeekStart = (date: Date): Date => {
  const weekStart = new Date(date)

  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())

  return weekStart
}

type SummaryStatCardProps = {
  detail: string
  isEmpty?: boolean
  label: string
  value: string
}

function SummaryStatCard({
  detail,
  isEmpty = false,
  label,
  value,
}: SummaryStatCardProps) {
  return (
    <article className={`summary-stat-card ${isEmpty ? 'is-empty' : ''}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="summary-card-detail">{detail}</span>
    </article>
  )
}

function App() {
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
  const [dailyGoalError, setDailyGoalError] = useState<string | null>(null)
  const [dailyGoalStatusText, setDailyGoalStatusText] = useState<string | null>(null)
  const [idleTimeoutSeconds, setIdleTimeoutSeconds] = useState(2 * 60)
  const [idleTimeoutStatusText, setIdleTimeoutStatusText] = useState<string | null>(null)
  const [trackingStatusMessage, setTrackingStatusMessage] = useState<string | null>(null)
  const [heatmapPeriod, setHeatmapPeriod] = useState<HeatmapPeriod>('year')
  const [totalEstimatedHours, setTotalEstimatedHours] = useState('1')
  const [progressPercentage, setProgressPercentage] = useState('0')
  const [pathError, setPathError] = useState<string | null>(null)
  const [pathSaveStatusText, setPathSaveStatusText] = useState<string | null>(null)
  const [exportStatusText, setExportStatusText] = useState<string | null>(null)
  const [resetStatusText, setResetStatusText] = useState<string | null>(null)

  const syncProjection = (projection: PathProjection) => {
    setFinishDateText(getFinishEstimateText(projection, 'full'))
    setFinishDateLabel(projection.finishDateLabel ?? 'Not estimated yet')
    setAveragePaceSeconds(projection.averageDailySeconds)
    setCompletedHours(projection.completedHours)
    setRemainingHours(projection.remainingHours)
  }

  const refreshTodayActivity = () => {
    void Promise.all([
      getActivityForDate(new Date()),
      getStorageValue('streakStatus'),
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
    )
  }

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
          void getPathProjection().then(syncProjection)
        })
      }

      const nextSettings = changes.userSettings?.newValue

      if (!nextSettings || typeof nextSettings !== 'object') {
        return
      }

      const nextUserSettings = nextSettings as Partial<UserSettings>

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
    )

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
  }, [])

  const saveGoalMinutes = (minutes: number) => {
    if (!isValidDailyGoalMinutes(minutes)) {
      setDailyGoalError('Enter 1-1440 minutes.')
      setDailyGoalStatusText(null)
      setDailyGoalMinutes(
        settings ? String(secondsToMinutes(settings.dailyGoalSeconds)) : '30',
      )
      return
    }

    setDailyGoalError(null)
    setDailyGoalStatusText('Saving daily goal...')
    setDailyGoalMinutes(String(minutes))
    void saveDailyGoal(minutes * 60).then((nextSettings) => {
      setSettings(nextSettings)
      setDailyGoalMinutes(String(secondsToMinutes(nextSettings.dailyGoalSeconds)))
      setDailyGoalStatusText(
        `Saved ${formatActiveTime(nextSettings.dailyGoalSeconds)} daily goal.`,
      )
      refreshTodayActivity()
    }).catch(() => {
      setDailyGoalError('Enter 1-1440 minutes.')
      setDailyGoalStatusText(null)
    })
  }

  const saveCustomGoal = () => {
    saveGoalMinutes(Number(dailyGoalMinutes))
  }

  const saveIdleTimeoutSeconds = (seconds: number) => {
    if (!isIdleTimeoutPreset(seconds)) {
      setIdleTimeoutStatusText('Choose one of the available timeout options.')
      setIdleTimeoutSeconds(settings?.idleTimeoutSeconds ?? 2 * 60)
      return
    }

    setIdleTimeoutStatusText('Saving idle timeout...')
    setIdleTimeoutSeconds(seconds)
    void saveIdleTimeout(seconds).then((nextSettings) => {
      setSettings(nextSettings)
      setIdleTimeoutSeconds(nextSettings.idleTimeoutSeconds)
      setIdleTimeoutStatusText(
        `Saved ${getIdleTimeoutPresetLabel(seconds) ?? formatActiveTime(seconds)} idle timeout.`,
      )
    })
  }

  const toggleTracking = () => {
    if (!settings) {
      return
    }

    const nextTrackingEnabled = !settings.trackingEnabled

    setTrackingStatusMessage(
      nextTrackingEnabled ? 'Resuming tracking...' : 'Pausing tracking...',
    )
    void saveTrackingEnabled(nextTrackingEnabled).then((nextSettings) => {
      setSettings(nextSettings)
      setTrackingStatusMessage(
        nextSettings.trackingEnabled
          ? 'Tracking is on. Lesson playback and coding will be counted.'
          : 'Tracking is paused. No Scrimba activity will be counted.',
      )
      refreshTodayActivity()
    })
  }

  const openFloatingWidget = () => {
    if (!settings || settings.floatingWidgetVisible) {
      return
    }

    setSettings({ ...settings, floatingWidgetVisible: true })
    void saveFloatingWidgetVisible(true).then(setSettings)
  }

  const refreshProjection = () => {
    void getPathProjection().then((projection) => {
      syncProjection(projection)
    })
  }

  const syncPathProgress = (nextPathProgress: PathProgress) => {
    setPathProgress(nextPathProgress)
    setTotalEstimatedHours(String(nextPathProgress.totalEstimatedHours))
    setProgressPercentage(String(nextPathProgress.progressPercentage))
    setPathError(null)
    refreshProjection()
  }

  const selectCourse = (courseId: string) => {
    if (!courseId) {
      return
    }

    setPathSaveStatusText('Selecting Scrimba course...')
    void selectScrimbaCourse(courseId).then((nextPathProgress) => {
      syncPathProgress(nextPathProgress)
      setPathSaveStatusText(
        nextPathProgress.progressSource === 'scrimba'
          ? 'Selected course and synced its Scrimba progress.'
          : 'Selected course. Open it on Scrimba to sync visible progress.',
      )
    })
  }

  const saveTotalEstimatedHoursValue = () => {
    const hours = Number(totalEstimatedHours)

    if (!isValidTotalEstimatedHours(hours)) {
      setPathError('Total estimate must be greater than 0 hours.')
      setPathSaveStatusText(null)
      setTotalEstimatedHours(String(pathProgress?.totalEstimatedHours ?? 1))
      return
    }

    setPathSaveStatusText('Saving total estimate...')
    void saveTotalEstimatedHours(hours).then((nextPathProgress) => {
      syncPathProgress(nextPathProgress)
      setPathSaveStatusText('Saved total estimate.')
    })
  }

  const saveProgressPercentageValue = () => {
    const percentage = Number(progressPercentage)

    if (!isValidProgressPercentage(percentage)) {
      setPathError('Progress must be between 0 and 100%.')
      setPathSaveStatusText(null)
      setProgressPercentage(String(pathProgress?.progressPercentage ?? 0))
      return
    }

    setPathSaveStatusText('Saving progress...')
    void saveProgressPercentage(percentage).then((nextPathProgress) => {
      syncPathProgress(nextPathProgress)
      setPathSaveStatusText('Saved progress.')
    })
  }

  const saveAverageWindowValue = (averageWindowDays: AverageWindowDays) => {
    if (!isValidAverageWindowDays(averageWindowDays)) {
      setPathError('Choose a valid average window.')
      setPathSaveStatusText(null)
      return
    }

    setPathSaveStatusText('Saving average window...')
    void saveAverageWindowDays(averageWindowDays).then((nextPathProgress) => {
      syncPathProgress(nextPathProgress)
      setPathSaveStatusText('Saved average window.')
    })
  }

  const resetData = (resetSettings: boolean) => {
    const message = resetSettings
      ? 'Delete all local activity, sessions, streaks, path settings, and app settings? This cannot be undone.'
      : 'Delete all local activity, sessions, and streaks while keeping your settings? This cannot be undone.'

    if (!window.confirm(message)) {
      return
    }

    setResetStatusText('Resetting local data...')
    void resetLocalData({ resetSettings }).then((nextStorage) => {
      setSettings(nextStorage.userSettings)
      setStreakStatus(nextStorage.streakStatus)
      setPathProgress(nextStorage.pathProgress)
      setTotalEstimatedHours(String(nextStorage.pathProgress.totalEstimatedHours))
      setProgressPercentage(String(nextStorage.pathProgress.progressPercentage))
      setDailyGoalMinutes(String(secondsToMinutes(nextStorage.userSettings.dailyGoalSeconds)))
      setIdleTimeoutSeconds(nextStorage.userSettings.idleTimeoutSeconds)
      setDailyGoalError(null)
      setDailyGoalStatusText(null)
      setIdleTimeoutStatusText(null)
      setPathError(null)
      setPathSaveStatusText(null)
      setTrackingStatusMessage(null)
      setResetStatusText(
        resetSettings
          ? 'All local data and settings were reset.'
          : 'Activity data, sessions, and streaks were reset. Settings were kept.',
      )
      refreshTodayActivity()
      refreshProjection()
    })
  }

  const exportData = () => {
    setExportStatusText('Preparing JSON export...')
    void downloadLocalDataExport().then((fileName) => {
      setExportStatusText(`Downloaded ${fileName}.`)
    }).catch(() => {
      setExportStatusText('Export failed. Try again.')
    })
  }

  const isLiveActivityRunning =
    settings?.trackingEnabled !== false &&
    currentScrimbaPage?.isActive === true &&
    !currentScrimbaPage.isIdle
  const liveTodayActiveSeconds = useLiveActivitySeconds(
    todayActivity,
    isLiveActivityRunning,
  )
  const displayedTodayActivity = todayActivity
    ? {
        ...todayActivity,
        activeSeconds: liveTodayActiveSeconds,
        goalCompleted:
          todayActivity.goalCompleted ||
          (todayActivity.goalSeconds > 0 &&
            liveTodayActiveSeconds >= todayActivity.goalSeconds),
      }
    : null
  const liveActivityOffset = Math.max(
    0,
    liveTodayActiveSeconds - (todayActivity?.activeSeconds ?? 0),
  )
  const goalProgress = getGoalProgress(displayedTodayActivity, settings)
  const todayActiveSeconds = goalProgress.activeSeconds
  const weeklyActiveSeconds =
    (weeklyTimeStats?.activeSeconds ?? 0) + liveActivityOffset
  const monthlyActiveSeconds =
    (monthlyTimeStats?.activeSeconds ?? 0) + liveActivityOffset
  const allTimeActiveSeconds =
    (allTimeStats?.activeSeconds ?? 0) + liveActivityOffset
  const progressText =
    goalProgress.goalSeconds > 0
      ? `${formatActiveTime(goalProgress.activeSeconds)} / ${formatActiveTime(goalProgress.goalSeconds)}`
      : 'Not set'
  const currentDailyGoalText =
    settings && settings.dailyGoalSeconds > 0
      ? formatActiveTime(settings.dailyGoalSeconds)
      : 'Not set'
  const currentIdleTimeoutText =
    settings && settings.idleTimeoutSeconds > 0
      ? formatActiveTime(settings.idleTimeoutSeconds)
      : 'Not set'
  const weeklyAverageText = `${formatActiveTime(
    Math.floor(weeklyActiveSeconds / (weeklyTimeStats?.dayCount || 1)),
  )} avg/day`
  const monthlyActiveDaysText = `${monthlyTimeStats?.activeDays ?? 0} active days`
  const allTimeActiveDaysText = `${allTimeStats?.activeDays ?? 0} active days`
  const weeklySummaryLines =
    weeklySummary?.summaryText ?? ['Your weekly summary is loading.']
  const monthlySummaryLines =
    monthlySummary?.summaryText ?? ['Your monthly summary is loading.']
  const pathStatusText = pathProgress?.pathName
    ? `${pathProgress.pathName} - ${pathProgress.progressPercentage}% complete`
    : 'No path set'
  const pathNameDisplay = pathProgress?.pathName || 'No path set'
  const paceWindowLabel =
    pathProgress?.averageWindowDays === 'all'
      ? 'All-time average'
      : `${pathProgress?.averageWindowDays ?? 7}-day average`
  const pathCompletionPercentage = pathProgress?.progressPercentage ?? 0
  const selectableCourses = getSelectableScrimbaCourses(pathProgress)
  const builtInCourseIds = new Set(builtInScrimbaCourses.map((course) => course.id))
  const builtInCourseOptions = selectableCourses.filter((course) =>
    builtInCourseIds.has(course.id),
  )
  const discoveredCourseOptions = selectableCourses.filter(
    (course) => !builtInCourseIds.has(course.id),
  )
  const selectedCourse = getSelectedScrimbaCourse(pathProgress)
  const courseSyncHelpText = !selectedCourse
    ? 'Choose a path below. Other Scrimba courses appear after you open their course or lesson page.'
    : pathProgress?.progressSource === 'scrimba'
      ? 'Progress was detected automatically from Scrimba. It will refresh while the course is open.'
      : 'Open this course on Scrimba to detect visible progress automatically. Manual progress remains available as a fallback.'
  const averagePaceText = formatHoursPerDay(averagePaceSeconds)
  const completedHoursText = formatPathHours(completedHours)
  const remainingHoursText =
    remainingHours <= 0 ? 'Path complete' : formatPathHours(remainingHours)
  const weeklyComparisonDifference = Math.abs(
    weeklySummary?.comparisonSeconds ?? 0,
  )
  const weeklyComparisonLabel =
    weeklySummary?.comparisonTrend === 'increase'
      ? 'Improved'
      : weeklySummary?.comparisonTrend === 'decrease'
        ? 'Declined'
        : 'No change'
  const weeklyBestDayText = weeklySummary?.bestDay
    ? `${weeklySummary.bestDay.label} - ${formatActiveTime(weeklySummary.bestDay.activeSeconds)}`
    : 'No best day yet'
  const monthlyBestDayText = monthlySummary?.bestDay
    ? `${monthlySummary.bestDay.label} - ${formatActiveTime(monthlySummary.bestDay.activeSeconds)}`
    : 'No best day yet'
  const streakDisplay = getStreakDisplayState(streakStatus, todayActiveSeconds)
  const heatmapDays =
    heatmapGrid?.weeks
      .flatMap((week) => week.days)
      .filter((day) => !day.isOutsideRange && !day.isFuture) ?? []
  const today = new Date()
  const selectedHeatmapStartDate =
    heatmapPeriod === 'week'
      ? getWeekStart(today)
      : heatmapPeriod === 'month'
        ? new Date(today.getFullYear(), today.getMonth(), 1)
        : parseLocalDateKey(heatmapGrid?.startDate ?? getLocalDateKey(today))
  const selectedHeatmapStartKey = getLocalDateKey(selectedHeatmapStartDate)
  const selectedHeatmapEndKey = heatmapGrid?.endDate ?? getLocalDateKey(today)
  const selectedHeatmapDays = heatmapDays.filter(
    (day) => day.date >= selectedHeatmapStartKey && day.date <= selectedHeatmapEndKey,
  )
  const todayDateKey = getLocalDateKey(today)
  const selectedTodayHeatmapDay = selectedHeatmapDays.find(
    (day) => day.date === todayDateKey,
  )
  const selectedHeatmapActiveDays = selectedHeatmapDays.filter(
    (day) => day.activeSeconds > 0,
  ).length +
    (liveActivityOffset > 0 && selectedTodayHeatmapDay?.activeSeconds === 0
      ? 1
      : 0)
  const selectedHeatmapActiveSeconds =
    selectedHeatmapDays.reduce(
      (total, day) => total + day.activeSeconds,
      0,
    ) + (selectedTodayHeatmapDay ? liveActivityOffset : 0)
  const selectedHeatmapGoalDays = selectedHeatmapDays.filter(
    (day) => day.goalCompleted,
  ).length +
    (selectedTodayHeatmapDay &&
    !selectedTodayHeatmapDay.goalCompleted &&
    goalProgress.isComplete
      ? 1
      : 0)
  const heatmapDateRangeText = heatmapGrid
    ? `${dateRangeFormatter.format(parseLocalDateKey(heatmapGrid.startDate))} to ${dateRangeFormatter.format(parseLocalDateKey(heatmapGrid.endDate))}`
    : 'Loading activity range'
  const heatmapMonthMarkers =
    heatmapGrid?.weeks
      .map((week, index, weeks) => ({
        column: index + 1,
        label: getMonthLabel(week, index, weeks),
        startDate: week.startDate,
      }))
      .filter((marker) => marker.label) ?? []
  const trackingStatusText =
    settings?.trackingEnabled === false
      ? 'Tracking paused'
      : isLiveActivityRunning
        ? 'Tracking'
        : currentScrimbaPage?.isIdle
          ? 'Idle'
          : 'Ready'
  const trackingSettingText =
    settings?.trackingEnabled === false ? 'Tracking paused' : 'Tracking on'
  const trackingStatusClass =
    settings?.trackingEnabled === false ? 'is-paused' : 'is-active'
  const currentDateText = fullDateFormatter.format(new Date())
  const currentStreak = streakStatus?.currentStreak ?? 0
  const currentStreakLabel = `${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}`
  const todaySummaryDetail =
    todayActiveSeconds > 0
      ? goalProgress.isComplete
        ? 'Goal complete today'
        : 'Active Scrimba time'
      : 'No activity yet'
  const weeklySummaryDetail =
    weeklyActiveSeconds > 0 ? weeklyAverageText : 'No activity this week'
  const monthlySummaryDetail =
    monthlyActiveSeconds > 0 ? monthlyActiveDaysText : 'No activity this month'
  const streakSummaryDetail =
    currentStreak > 0 ? streakDisplay.message : 'No streak yet'
  const allTimeSummaryDetail =
    allTimeActiveSeconds > 0 ? allTimeActiveDaysText : 'No tracked time yet'

  return (
    <main className="app-shell dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Local-first Chrome extension</p>
          <h1>ScrimTrack</h1>
          <p className="dashboard-date">{currentDateText}</p>
        </div>
        <div className="dashboard-header-actions">
          <span className={`status-pill ${trackingStatusClass}`}>
            {trackingStatusText}
          </span>
          <button
            type="button"
            className="settings-link"
            disabled={!settings || settings.floatingWidgetVisible}
            onClick={openFloatingWidget}
          >
            {settings?.floatingWidgetVisible ? 'Widget open' : 'Open widget'}
          </button>
          <a className="settings-link" href="#idle-timeout-settings">
            Settings
          </a>
        </div>
      </header>

      <section
        className="panel heatmap-hero-panel"
        aria-labelledby="dashboard-heatmap-title"
      >
        <div className="heatmap-hero-header">
          <div>
            <p className="eyebrow">Activity calendar</p>
            <h2 id="dashboard-heatmap-title">Year in Scrimba</h2>
            <p className="heatmap-range-label">{heatmapDateRangeText}</p>
          </div>

          <div
            className="heatmap-period-control"
            role="group"
            aria-label="Heatmap summary period"
          >
            {heatmapPeriodOptions.map((period) => (
              <button
                key={period}
                type="button"
                className={heatmapPeriod === period ? 'is-selected' : undefined}
                onClick={() => setHeatmapPeriod(period)}
              >
                {period}
              </button>
            ))}
          </div>
        </div>

        <div className="heatmap-summary-grid" aria-label="Selected period totals">
          <span>
            Period
            <strong>{heatmapPeriodLabels[heatmapPeriod]}</strong>
          </span>
          <span>
            Active days
            <strong>{selectedHeatmapActiveDays}</strong>
          </span>
          <span>
            Total time
            <strong>{formatActiveTime(selectedHeatmapActiveSeconds)}</strong>
          </span>
          <span>
            Goals hit
            <strong>{selectedHeatmapGoalDays}</strong>
          </span>
        </div>

        <div className="dashboard-heatmap" aria-label="365-day activity heatmap">
          <div className="dashboard-months" aria-hidden="true">
            {heatmapMonthMarkers.map((marker) => (
              <span
                key={marker.startDate}
                style={{ gridColumn: `${marker.column} / span 4` }}
              >
                {marker.label}
              </span>
            ))}
          </div>

          <div className="dashboard-heatmap-body">
            <div className="dashboard-weekdays" aria-hidden="true">
              {weekdayLabels.map((label, index) => (
                <span key={label}>{index % 2 === 1 ? label : ''}</span>
              ))}
            </div>

            <div
              className="dashboard-heatmap-grid"
              role="img"
              aria-label="Daily Scrimba activity for the last 365 days"
            >
              {heatmapGrid?.weeks.map((week) => (
                <div className="dashboard-heatmap-week" key={week.startDate}>
                  {week.days.map((day) => {
                    const isSelectedPeriodDay =
                      !day.isOutsideRange &&
                      day.date >= selectedHeatmapStartKey &&
                      day.date <= selectedHeatmapEndKey

                    return (
                      <span
                        key={day.date}
                        tabIndex={0}
                        className={[
                          'dashboard-heatmap-cell',
                          'heatmap-tooltip-trigger',
                          `heatmap-level-${day.intensity}`,
                          day.isFuture || day.isOutsideRange ? 'is-muted' : '',
                          isSelectedPeriodDay ? 'is-selected-period' : '',
                          !isSelectedPeriodDay && heatmapPeriod !== 'year'
                            ? 'is-outside-selected-period'
                            : '',
                        ].filter(Boolean).join(' ')}
                        aria-label={getHeatmapTooltipText(day)}
                      >
                        <span className="heatmap-tooltip" role="tooltip">
                          {getHeatmapTooltipLines(day).map((line) => (
                            <span key={line}>{line}</span>
                          ))}
                        </span>
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="heatmap-legend" aria-label="Heatmap intensity legend">
            <span>Less</span>
            {[0, 1, 2, 3, 4, 5].map((level) => (
              <span
                key={level}
                className={`dashboard-heatmap-cell heatmap-level-${level}`}
                title={
                  [
                    '0 min',
                    '1-14 min',
                    '15-29 min',
                    '30-59 min',
                    '60-119 min',
                    '120+ min',
                  ][level]
                }
              />
            ))}
            <span>More</span>
          </div>
        </div>
      </section>

      <section className="panel idle-timeout-panel" id="idle-timeout-settings">
        <div className="goal-settings-header">
          <div>
            <p className="eyebrow">Tracking settings</p>
            <h2>Idle Timeout</h2>
          </div>
          <span>
            Current timeout
            <strong>{currentIdleTimeoutText}</strong>
          </span>
        </div>

        <label className="tracking-toggle-card">
          <span>
            <strong>{trackingSettingText}</strong>
            <small>
              {settings?.trackingEnabled === false
                ? 'No Scrimba activity is being tracked.'
                : 'Lesson playback and code-editor activity are tracked while the page is active.'}
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings?.trackingEnabled ?? true}
            onChange={toggleTracking}
          />
        </label>
        {trackingStatusMessage ? (
          <span className="save-status" role="status" aria-live="polite">
            {trackingStatusMessage}
          </span>
        ) : null}

        <p className="settings-help-text">
          Idle timeout is how long coding can pause without editor interaction before tracking stops. Playing lesson media keeps tracking active while the Scrimba tab is visible and focused.
        </p>

        <div className="goal-control" role="group" aria-label="Idle timeout presets">
          <div className="segmented-control idle-timeout-presets">
            {idleTimeoutPresets.map((preset) => (
              <button
                key={preset.seconds}
                type="button"
                className={
                  idleTimeoutSeconds === preset.seconds ? 'is-selected' : undefined
                }
                onClick={() => saveIdleTimeoutSeconds(preset.seconds)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {idleTimeoutStatusText ? (
            <span className="save-status" role="status" aria-live="polite">
              {idleTimeoutStatusText}
            </span>
          ) : null}
        </div>
      </section>

      <section className="panel" id="dashboard-settings">
        <div className="goal-settings-header">
          <div>
            <p className="eyebrow">Goal settings</p>
            <h2>Daily Goal</h2>
          </div>
          <span>
            Current goal
            <strong>{currentDailyGoalText}</strong>
          </span>
        </div>
        <div className={`streak-state streak-state-${streakDisplay.tone}`}>
          <strong>{streakDisplay.currentLabel}</strong>
          <span>{streakDisplay.longestLabel}</span>
          <p>{streakDisplay.message}</p>
        </div>
        <div className="goal-progress" aria-label="Today goal progress">
          <div className="goal-progress-header">
            <span>Today</span>
            <strong>{progressText}</strong>
          </div>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${goalProgress.visualPercentage}%` }} />
          </div>
          <p className="projection-line">
            {goalProgress.isComplete
              ? 'Goal complete'
              : `${formatActiveTime(goalProgress.remainingSeconds)} remaining`}
          </p>
        </div>
        <div className="dashboard-goal-row">
          <div className="goal-control" role="group" aria-label="Daily goal presets">
            <div className="segmented-control">
              {dailyGoalPresetMinutes.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={
                    Number(dailyGoalMinutes) === minutes ? 'is-selected' : undefined
                  }
                  onClick={() => saveGoalMinutes(minutes)}
                >
                  {minutes}m
                </button>
              ))}
            </div>
            <div className="input-row dashboard-input-row goal-custom-row">
              <input
                max="1440"
                min="1"
                step="1"
                type="number"
                value={dailyGoalMinutes}
                onChange={(event) => setDailyGoalMinutes(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    saveCustomGoal()
                  }
                }}
              />
              <span>min</span>
              <button type="button" className="secondary-button" onClick={saveCustomGoal}>
                Save
              </button>
            </div>
          </div>
          {dailyGoalError ? <span className="error-text">{dailyGoalError}</span> : null}
          {dailyGoalStatusText ? (
            <span className="save-status" role="status" aria-live="polite">
              {dailyGoalStatusText}
            </span>
          ) : null}
        </div>
      </section>

      <section className="panel pace-panel" aria-labelledby="pace-title">
        <div className="pace-header">
          <div>
            <p className="eyebrow">Path projection</p>
            <h2 id="pace-title">Learning Pace</h2>
          </div>
          <a className="secondary-button" href="#path-setup">
            Edit path
          </a>
        </div>

        <div className="pace-path-card">
          <span>Current path</span>
          <strong>{pathNameDisplay}</strong>
          <div className="pace-progress-row">
            <span>{pathCompletionPercentage}% complete</span>
            <span>{completedHoursText} logged</span>
          </div>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${pathCompletionPercentage}%` }} />
          </div>
        </div>

        <div className="pace-stat-grid" aria-label="Path pace summary">
          <span>
            Average pace
            <strong>{averagePaceText}</strong>
            <small>{paceWindowLabel}</small>
          </span>
          <span>
            Remaining
            <strong>{remainingHoursText}</strong>
            <small>estimated path time</small>
          </span>
          <span>
            Finish date
            <strong>{finishDateLabel}</strong>
            <small>{finishDateText}</small>
          </span>
        </div>
      </section>

      <section className="panel path-setup-panel" id="path-setup" aria-label="Path setup">
        <div className="panel-heading-row">
          <h2>Path Setup</h2>
          <span>{pathStatusText}</span>
        </div>

        <div className="path-setup-grid">
          <div className="path-setting-field">
            <label htmlFor="dashboard-course-selection">Scrimba path or course</label>
            <select
              id="dashboard-course-selection"
              value={pathProgress?.selectedCourseId ?? ''}
              onChange={(event) => selectCourse(event.target.value)}
            >
              <option value="">Choose a path or discovered course</option>
              <optgroup label="Scrimba paths">
                {builtInCourseOptions.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </optgroup>
              {discoveredCourseOptions.length > 0 ? (
                <optgroup label="Courses found on Scrimba">
                  {discoveredCourseOptions.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <span className="path-sync-help">{courseSyncHelpText}</span>
            {selectedCourse ? (
              <a
                className="path-course-link"
                href={selectedCourse.url}
                rel="noreferrer"
                target="_blank"
              >
                Open {selectedCourse.name} on Scrimba
              </a>
            ) : null}
          </div>

          <div className="path-setting-field">
            <label htmlFor="dashboard-total-estimate">Total estimate</label>
            <div className="input-row dashboard-input-row path-setting-row">
              <input
                id="dashboard-total-estimate"
                min="0.1"
                step="0.5"
                type="number"
                value={totalEstimatedHours}
                onChange={(event) => setTotalEstimatedHours(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    saveTotalEstimatedHoursValue()
                  }
                }}
              />
              <span>hr</span>
              <button type="button" className="secondary-button" onClick={saveTotalEstimatedHoursValue}>
                Save
              </button>
            </div>
          </div>

          <div className="path-setting-field">
            <label htmlFor="dashboard-path-progress">
              Progress {pathProgress?.progressSource === 'scrimba' ? '(Scrimba)' : '(manual fallback)'}
            </label>
            <div className="input-row dashboard-input-row path-setting-row">
              <input
                id="dashboard-path-progress"
                max="100"
                min="0"
                step="1"
                type="number"
                value={progressPercentage}
                onChange={(event) => setProgressPercentage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    saveProgressPercentageValue()
                  }
                }}
              />
              <span>%</span>
              <button type="button" className="secondary-button" onClick={saveProgressPercentageValue}>
                Save
              </button>
            </div>
          </div>

          <div className="path-setting-field">
            <label htmlFor="dashboard-average-window">Average window</label>
            <select
              id="dashboard-average-window"
              value={pathProgress?.averageWindowDays ?? 7}
              onChange={(event) => {
                saveAverageWindowValue(parseAverageWindowDays(event.target.value))
              }}
            >
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>

        <div className="path-setup-stats">
          <span>
            Remaining
            <strong>{remainingHoursText}</strong>
          </span>
          <span>
            Completed
            <strong>{completedHoursText}</strong>
          </span>
          <span>
            Average pace
            <strong>{averagePaceText}</strong>
          </span>
          <span className="path-projection-message">
            Projection
            <strong>{finishDateText}</strong>
          </span>
        </div>
        {pathError ? <span className="error-text">{pathError}</span> : null}
        {pathSaveStatusText ? (
          <span className="save-status" role="status" aria-live="polite">
            {pathSaveStatusText}
          </span>
        ) : null}
      </section>

      <section className="summary-grid" aria-label="Key learning stats">
        <SummaryStatCard
          detail={todaySummaryDetail}
          isEmpty={todayActiveSeconds === 0}
          label="Today"
          value={formatActiveTime(todayActiveSeconds)}
        />
        <SummaryStatCard
          detail={weeklySummaryDetail}
          isEmpty={weeklyActiveSeconds === 0}
          label="This week"
          value={formatActiveTime(weeklyActiveSeconds)}
        />
        <SummaryStatCard
          detail={monthlySummaryDetail}
          isEmpty={monthlyActiveSeconds === 0}
          label="This month"
          value={formatActiveTime(monthlyActiveSeconds)}
        />
        <SummaryStatCard
          detail={streakSummaryDetail}
          isEmpty={currentStreak === 0}
          label="Current streak"
          value={currentStreakLabel}
        />
        <SummaryStatCard
          detail={allTimeSummaryDetail}
          isEmpty={allTimeActiveSeconds === 0}
          label="All-time"
          value={formatActiveTime(allTimeActiveSeconds)}
        />
      </section>

      <section
        className="panel progress-summary-section"
        aria-labelledby="progress-summary-title"
      >
        <div className="panel-heading-row">
          <div>
            <p className="eyebrow">Progress summary</p>
            <h2 id="progress-summary-title">Weekly and Monthly Recap</h2>
          </div>
          <span>Narrative recap</span>
        </div>

        <div className="progress-summary-grid">
          <article className="summary-period-panel" aria-label="Weekly summary">
            <div className="summary-period-header">
              <h3>This Week</h3>
              <span>{pluralizeActiveDays(weeklySummary?.activeDays ?? 0)}</span>
            </div>
            <ul className="weekly-summary-list">
              {weeklySummaryLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="weekly-summary-stats">
              <span>
                Best day
                <strong>{weeklyBestDayText}</strong>
              </span>
              <span>
                Previous week
                <strong>{formatActiveTime(weeklySummary?.previousWeekActiveSeconds ?? 0)}</strong>
              </span>
              <span
                className={`weekly-comparison weekly-comparison-${weeklySummary?.comparisonTrend ?? 'no-change'}`}
              >
                Change
                <strong>{formatActiveTime(weeklyComparisonDifference)}</strong>
                <small>{weeklyComparisonLabel}</small>
              </span>
            </div>
          </article>

          <article className="summary-period-panel" aria-label="Monthly summary">
            <div className="summary-period-header">
              <h3>This Month</h3>
              <span>{pluralizeActiveDays(monthlySummary?.activeDays ?? 0)}</span>
            </div>
            <ul className="weekly-summary-list">
              {monthlySummaryLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="weekly-summary-stats">
              <span>
                Best day
                <strong>{monthlyBestDayText}</strong>
              </span>
              <span>
                Best week
                <strong>{formatActiveTime(monthlySummary?.bestWeek?.activeSeconds ?? 0)}</strong>
                <small>{monthlySummary?.bestWeek?.label ?? 'No activity yet'}</small>
              </span>
              <span>
                Daily average
                <strong>{formatActiveTime(monthlySummary?.dailyAverageSeconds ?? 0)}</strong>
              </span>
            </div>
          </article>
        </div>
      </section>

      <section className="panel privacy-note-panel" aria-label="Privacy note">
        <div>
          <p className="eyebrow">Privacy</p>
          <h2>Local-only data</h2>
        </div>
        <p className="settings-help-text">
          Your learning data stays on this device in Chrome storage. ScrimTrack does not create accounts, send learning data to a server, or run external analytics by default.
        </p>
      </section>

      <section className="panel data-reset-panel" aria-label="Data reset">
        <div>
          <p className="eyebrow">Local data</p>
          <h2>Export and Reset Data</h2>
        </div>
        <p className="settings-help-text">
          Export downloads a JSON file with daily activity, sessions, settings, streaks, and path data. Reset deletes local activity from this device.
        </p>
        <div className="export-action-row">
          <button type="button" className="secondary-button" onClick={exportData}>
            Download JSON export
          </button>
          {exportStatusText ? (
            <span className="save-status" role="status" aria-live="polite">
              {exportStatusText}
            </span>
          ) : null}
        </div>
        <div className="reset-action-grid">
          <button
            type="button"
            className="secondary-button"
            onClick={() => resetData(false)}
          >
            Reset activity only
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => resetData(true)}
          >
            Reset data and settings
          </button>
        </div>
        {resetStatusText ? (
          <span className="save-status" role="status" aria-live="polite">
            {resetStatusText}
          </span>
        ) : null}
      </section>

    </main>
  )
}

export default App
