import { useState } from 'react'
import { getLocalDateKey } from '../activity'
import { formatActiveTime } from '../goalProgress'
import type { HeatmapGrid, HeatmapWeek } from '../heatmap'
import { getHeatmapTooltipLines, getHeatmapTooltipText } from '../heatmapTooltip'
import { parseLocalDateKey } from './dateFormatting'

const heatmapPeriodOptions = ['year', 'month', 'week'] as const
const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' })
const dateRangeFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
type HeatmapPeriod = (typeof heatmapPeriodOptions)[number]

const heatmapPeriodLabels: Record<HeatmapPeriod, string> = {
  year: 'Last 365 days',
  month: 'This month',
  week: 'This week',
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

type ActivityCalendarProps = {
  heatmapGrid: HeatmapGrid | null
  dateKey?: string
  liveActivityOffset: number
  goalComplete: boolean
}

export function ActivityCalendar({ heatmapGrid, dateKey, liveActivityOffset, goalComplete }: ActivityCalendarProps) {
  const [heatmapPeriod, setHeatmapPeriod] = useState<HeatmapPeriod>('year')
  const heatmapDays =
    heatmapGrid?.weeks
      .flatMap((week) => week.days)
      .filter((day) => !day.isOutsideRange && !day.isFuture) ?? []
  const today = parseLocalDateKey(dateKey ?? getLocalDateKey())
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
    goalComplete
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
  return (
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

  )
}
