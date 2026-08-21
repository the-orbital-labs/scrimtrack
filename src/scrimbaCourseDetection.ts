import type { ScrimbaCourseProgress } from './scrimbaCourse'

const scrimbaHosts = new Set(['scrimba.com', 'v2.scrimba.com'])
const courseIdPattern = /(?:^|-)(c0[a-z0-9]+)$/i
const builtInCourseNames: Record<string, string> = {
  c02v: 'AI Engineer Path',
  c0fullstack: 'Fullstack Developer Path',
  c0j: 'Frontend Developer Path',
  c0tbi0l98f: 'Backend Developer Path',
}

const getCourseIdFromUrl = (value: string): string | null => {
  try {
    const url = new URL(value)

    if (url.protocol !== 'https:' || !scrimbaHosts.has(url.hostname)) {
      return null
    }

    const courseSegment = url.pathname
      .split('/')
      .filter(Boolean)
      .find((segment) => courseIdPattern.test(segment))

    return courseSegment?.match(courseIdPattern)?.[1]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

const getCanonicalCourseUrl = (value: string, courseId: string): string => {
  const url = new URL(value)
  const courseSegment = url.pathname
    .split('/')
    .filter(Boolean)
    .find((segment) => segment.toLowerCase().endsWith(`-${courseId}`) || segment.toLowerCase() === courseId)

  if (courseSegment) {
    url.pathname = `/${courseSegment}`
  }

  url.search = ''
  url.hash = ''

  return url.toString().replace(/\/$/, '')
}

const normalizeCourseName = (value: string): string =>
  value
    .replace(/\s*[|–—-]\s*Scrimba.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

const getCourseName = (
  documentValue: Document,
  courseId: string,
  canonicalUrl: string,
): string | null => {
  if (builtInCourseNames[courseId]) {
    return builtInCourseNames[courseId]
  }

  const linkedCourseName = Array.from(
    documentValue.querySelectorAll<HTMLAnchorElement>('a[href]'),
  ).map((anchor) => ({
    name: normalizeCourseName(anchor.textContent ?? ''),
    url: anchor.href,
  })).find(
    (candidate) =>
      candidate.name.length >= 3 &&
      candidate.name.length <= 120 &&
      getCourseIdFromUrl(candidate.url) === courseId &&
      getCanonicalCourseUrl(candidate.url, courseId) === canonicalUrl,
  )?.name

  if (linkedCourseName) {
    return linkedCourseName
  }

  const metadataTitle = documentValue
    .querySelector<HTMLMetaElement>('meta[property="og:title"]')
    ?.content
  const heading = documentValue.querySelector('h1')?.textContent
  const candidates = [metadataTitle, heading, documentValue.title]
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map(normalizeCourseName)

  return candidates.find((candidate) => candidate.length >= 3 && candidate.length <= 120) ?? null
}

const normalizePercentage = (value: number): number | null =>
  Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value)
    : null

const getProgressFromFractions = (
  documentValue: Document,
): Pick<ScrimbaCourseProgress, 'completedItems' | 'progressPercentage' | 'totalItems'> | null => {
  const fractions = (documentValue.body?.innerText ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d{1,4})\s*\/\s*(\d{1,4})(?:\s+(?:items?|lessons?|modules?|scrims?))?$/i)

      if (!match) {
        return []
      }

      const completed = Number(match[1])
      const total = Number(match[2])

      return total > 0 && completed <= total ? [{ completed, total }] : []
    })

  if (fractions.length === 0) {
    return null
  }

  const completedItems = fractions.reduce((sum, fraction) => sum + fraction.completed, 0)
  const totalItems = fractions.reduce((sum, fraction) => sum + fraction.total, 0)

  return {
    completedItems,
    progressPercentage: normalizePercentage((completedItems / totalItems) * 100),
    totalItems,
  }
}

const getProgressFromElements = (documentValue: Document): number | null => {
  const progressElements = Array.from(
    documentValue.querySelectorAll<HTMLElement>(
      '[role="progressbar"], progress, [aria-label*="progress" i], [data-progress]',
    ),
  )

  for (const element of progressElements) {
    const progressContext = [
      element.getAttribute('aria-label'),
      element.getAttribute('data-progress'),
      element.textContent,
    ].filter(Boolean).join(' ')

    if (!/(?:course|learning|progress|complete)/i.test(progressContext)) {
      continue
    }

    const ariaValueAttribute = element.getAttribute('aria-valuenow')
    const ariaValue = Number(ariaValueAttribute)
    const ariaMaximum = Number(element.getAttribute('aria-valuemax') ?? 100)

    if (
      ariaValueAttribute !== null &&
      Number.isFinite(ariaValue) &&
      Number.isFinite(ariaMaximum) &&
      ariaMaximum > 0
    ) {
      const percentage = normalizePercentage((ariaValue / ariaMaximum) * 100)

      if (percentage !== null) {
        return percentage
      }
    }

    if (element instanceof HTMLProgressElement && element.max > 0) {
      const percentage = normalizePercentage((element.value / element.max) * 100)

      if (percentage !== null) {
        return percentage
      }
    }

    const textMatch = (element.getAttribute('aria-label') ?? element.textContent ?? '')
      .match(/(?:progress|complete(?:d)?)\D{0,30}(\d{1,3}(?:\.\d+)?)\s*%/i)
    const percentage = textMatch ? normalizePercentage(Number(textMatch[1])) : null

    if (percentage !== null) {
      return percentage
    }
  }

  return null
}

const parseIsoDurationHours = (value: string): number | null => {
  const match = value.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?$/i)

  if (!match) {
    return null
  }

  const hours = Number(match[1] ?? 0) + Number(match[2] ?? 0) / 60

  return hours > 0 ? Math.round(hours * 100) / 100 : null
}

const getJsonLdDurationHours = (documentValue: Document): number | null => {
  const findDuration = (value: unknown): string | null => {
    if (Array.isArray(value)) {
      return value.map(findDuration).find((duration) => duration !== null) ?? null
    }

    if (!value || typeof value !== 'object') {
      return null
    }

    const candidate = value as Record<string, unknown>

    if (typeof candidate.timeRequired === 'string') {
      return candidate.timeRequired
    }

    return Object.values(candidate).map(findDuration).find((duration) => duration !== null) ?? null
  }

  for (const script of documentValue.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const duration = findDuration(JSON.parse(script.textContent ?? ''))
      const hours = duration ? parseIsoDurationHours(duration) : null

      if (hours !== null) {
        return hours
      }
    } catch {
      // Ignore unrelated or temporarily incomplete metadata blocks.
    }
  }

  return null
}

const getDurationHours = (documentValue: Document): number | null => {
  const metadataHours = getJsonLdDurationHours(documentValue)

  if (metadataHours !== null) {
    return metadataHours
  }

  const durationMatch = (documentValue.body?.innerText ?? '').match(
    /Duration\s+(?:(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b)?(?:\s*(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min)\b)?/i,
  )

  if (!durationMatch) {
    return null
  }

  const hours = Number(durationMatch[1] ?? 0) + Number(durationMatch[2] ?? 0) / 60

  return hours > 0 ? Math.round(hours * 100) / 100 : null
}

export const detectScrimbaCourseProgress = (
  documentValue: Document,
  pageUrl: string,
): ScrimbaCourseProgress | null => {
  const id = getCourseIdFromUrl(pageUrl)

  if (!id) {
    return null
  }

  const url = getCanonicalCourseUrl(pageUrl, id)
  const name = getCourseName(documentValue, id, url)

  if (!name) {
    return null
  }

  const pagePath = new URL(pageUrl).pathname.replace(/\/$/, '')
  const coursePath = new URL(url).pathname.replace(/\/$/, '')
  const isCourseOverviewPage = pagePath === coursePath
  const fractionProgress = isCourseOverviewPage
    ? getProgressFromFractions(documentValue)
    : null

  return {
    completedItems: fractionProgress?.completedItems ?? null,
    detectedAt: new Date().toISOString(),
    id,
    name,
    progressPercentage:
      fractionProgress?.progressPercentage ??
      (isCourseOverviewPage ? getProgressFromElements(documentValue) : null),
    totalEstimatedHours:
      isCourseOverviewPage ? getDurationHours(documentValue) : null,
    totalItems: fractionProgress?.totalItems ?? null,
    url,
  }
}
