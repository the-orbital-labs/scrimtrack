import { formatActiveTime } from '../goalProgress'
import type { WeeklySummary } from '../weeklySummary'
import type { MonthlySummary } from '../monthlySummary'

const pluralizeActiveDays = (count: number): string =>
  `${count} active ${count === 1 ? 'day' : 'days'}`

type ProgressRecapProps = { weeklySummary: WeeklySummary | null; monthlySummary: MonthlySummary | null }

export function ProgressRecap({ weeklySummary, monthlySummary }: ProgressRecapProps) {
  const monthlySummaryLines =
    monthlySummary?.summaryText ?? ['Your monthly summary is loading.']
  const weeklySummaryLines =
    weeklySummary?.summaryText ?? ['Your weekly summary is loading.']
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
  return (
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

  )
}
