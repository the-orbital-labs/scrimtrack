// Date keys are calendar dates. Only instants are converted through a timezone.
export const getDateKey = (
  value: Date | string = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
): string => {
  const date = typeof value === 'string' ? new Date(value) : value
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)!.value

  return `${part('year')}-${part('month')}-${part('day')}`
}

const calendarDate = (key: string): Date => new Date(`${key}T00:00:00.000Z`)

export const addCalendarDays = (key: string, days: number): string => {
  const date = calendarDate(key)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const calendarDayCount = (start: string, end: string): number =>
  Math.round((calendarDate(end).getTime() - calendarDate(start).getTime()) / 86_400_000) + 1

export const weekStartKey = (key: string, weekStartsOn = 0): string =>
  addCalendarDays(key, -((calendarDate(key).getUTCDay() - weekStartsOn + 7) % 7))

// Find the first instant on the next date, including 23/25-hour days and
// timezones whose clocks change at midnight. No fixed UTC offset is assumed.
export const nextDateBoundary = (instant: Date, timeZone: string): Date => {
  const key = getDateKey(instant, timeZone)
  let low = instant.getTime()
  let high = low + 48 * 60 * 60 * 1000
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (getDateKey(new Date(middle), timeZone) === key) low = middle
    else high = middle
  }
  return new Date(high)
}
