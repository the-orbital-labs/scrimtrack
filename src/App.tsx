import { ActivityCalendar } from './dashboard/ActivityCalendar'
import { ProgressRecap } from './dashboard/ProgressRecap'
import { SummaryStatCard } from './dashboard/SummaryStatCard'
import { fullDateFormatter, parseLocalDateKey } from './dashboard/dateFormatting'
import { DataImport } from './DataImport'
import type { StorageSchema } from './storage'
import { useState } from 'react'
import { useDashboardData } from './dashboard/useDashboardData'
import './App.css'
import { getLocalDateKey } from './activity'
import { downloadLocalDataExport } from './dataExport'
import { formatActiveTime, getGoalProgress, secondsToMinutes } from './goalProgress'
import {
  getIdleTimeoutPresetLabel,
  idleTimeoutPresets,
  isIdleTimeoutPreset,
} from './idleTimeout'
import {
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
  getPathProjection,
} from './projection'
import { builtInScrimbaCourses } from './scrimbaCourse'
import {
  saveDailyGoal,
  saveFloatingWidgetVisible,
  saveIdleTimeout,
  saveTrackingEnabled,
} from './settings'
import { resetLocalData } from './storage'
import type { AverageWindowDays, PathProgress } from './storage'
import { getStreakDisplayState } from './streakDisplay'
import { useLiveActivitySeconds } from './useLiveActivitySeconds'

const dailyGoalPresetMinutes = [15, 30, 45, 60] as const
const isValidDailyGoalMinutes = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && value <= 24 * 60

function App() {
  const {
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
  } = useDashboardData()
  const [dailyGoalError, setDailyGoalError] = useState<string | null>(null)
  const [dailyGoalStatusText, setDailyGoalStatusText] = useState<string | null>(null)
  const [idleTimeoutStatusText, setIdleTimeoutStatusText] = useState<string | null>(null)
  const [trackingStatusMessage, setTrackingStatusMessage] = useState<string | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)
  const [pathSaveStatusText, setPathSaveStatusText] = useState<string | null>(null)
  const [exportStatusText, setExportStatusText] = useState<string | null>(null)
  const [resetStatusText, setResetStatusText] = useState<string | null>(null)

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
      setDailyGoalError('Could not save the daily goal. Reload and try again.')
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
    }).catch(() => {
      setIdleTimeoutStatusText('Could not save the idle timeout. Reload and try again.')
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
    }).catch(() => {
      setTrackingStatusMessage('Could not update tracking. Reload to check its current state and try again.')
    })
  }

  const openFloatingWidget = () => {
    if (!settings || settings.floatingWidgetVisible) {
      return
    }

    void saveFloatingWidgetVisible(true).then(setSettings).catch(() => {

      setStorageError('Could not save settings. Reload and try again.')

    })
  }

  const refreshProjection = () => {
    void getPathProjection().then((projection) => {
      syncProjection(projection)
    }).catch(() => {
      setStorageError('Could not load local data. Displayed values may be out of date. Reload and try again.')
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
    }).catch(() => {
      setPathSaveStatusText(null)
      setPathError('Could not save path settings. Reload and try again.')
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
    }).catch(() => {
      setPathSaveStatusText(null)
      setPathError('Could not save path settings. Reload and try again.')
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
    }).catch(() => {
      setPathSaveStatusText(null)
      setPathError('Could not save path settings. Reload and try again.')
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
    }).catch(() => {
      setPathSaveStatusText(null)
      setPathError('Could not save path settings. Reload and try again.')
    })
  }

  const applyStorageSnapshot = (nextStorage: StorageSchema) => {
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
    refreshTodayActivity()
    refreshProjection()
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
      applyStorageSnapshot(nextStorage)
      setResetStatusText(
        resetSettings
          ? 'All local data and settings were reset.'
          : 'Activity data, sessions, and streaks were reset. Settings were kept.',
      )
    }).catch(() => {
      setResetStatusText('Reset could not be completed. Some data may have changed. Reload to check and try again.')
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
    settings?.timezone,
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
  const streakDisplay = getStreakDisplayState(streakStatus, todayActiveSeconds)
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
  const currentDateText = fullDateFormatter.format(parseLocalDateKey(todayActivity?.date ?? getLocalDateKey()))
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
      {storageError ? (
        <div role="alert">
          <p>{storageError}</p>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      ) : null}
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

      <ActivityCalendar heatmapGrid={heatmapGrid} dateKey={todayActivity?.date} liveActivityOffset={liveActivityOffset} goalComplete={goalProgress.isComplete} />

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

      <ProgressRecap weeklySummary={weeklySummary} monthlySummary={monthlySummary} />

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
        <DataImport onImported={applyStorageSnapshot} />
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
