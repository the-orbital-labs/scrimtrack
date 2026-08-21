export type ScrimbaCourseDefinition = {
  id: string
  name: string
  url: string
  totalEstimatedHours: number | null
}

export type ScrimbaCourseProgress = ScrimbaCourseDefinition & {
  completedItems: number | null
  detectedAt: string
  progressPercentage: number | null
  totalItems: number | null
}

export const builtInScrimbaCourses: readonly ScrimbaCourseDefinition[] = [
  {
    id: 'c0fullstack',
    name: 'Fullstack Developer Path',
    url: 'https://scrimba.com/fullstack-path-c0fullstack',
    totalEstimatedHours: 108.4,
  },
  {
    id: 'c0j',
    name: 'Frontend Developer Path',
    url: 'https://scrimba.com/frontend-path-c0j',
    totalEstimatedHours: 81.6,
  },
  {
    id: 'c0tbi0l98f',
    name: 'Backend Developer Path',
    url: 'https://scrimba.com/the-backend-developer-path-c0tbi0l98f',
    totalEstimatedHours: 39.4,
  },
  {
    id: 'c02v',
    name: 'AI Engineer Path',
    url: 'https://scrimba.com/the-ai-engineer-path-c02v',
    totalEstimatedHours: 11.4,
  },
]

const scrimbaHosts = new Set(['scrimba.com', 'v2.scrimba.com'])

const isScrimbaUrl = (value: string): boolean => {
  try {
    const url = new URL(value)

    return url.protocol === 'https:' && scrimbaHosts.has(url.hostname)
  } catch {
    return false
  }
}

export const isScrimbaCourseProgress = (
  value: unknown,
): value is ScrimbaCourseProgress => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.id === 'string' &&
    /^c0[a-z0-9]+$/i.test(candidate.id) &&
    typeof candidate.name === 'string' &&
    candidate.name.trim().length >= 3 &&
    candidate.name.length <= 120 &&
    typeof candidate.url === 'string' &&
    isScrimbaUrl(candidate.url) &&
    (candidate.totalEstimatedHours === null ||
      (typeof candidate.totalEstimatedHours === 'number' &&
        Number.isFinite(candidate.totalEstimatedHours) &&
        candidate.totalEstimatedHours > 0)) &&
    (candidate.progressPercentage === null ||
      (typeof candidate.progressPercentage === 'number' &&
        Number.isFinite(candidate.progressPercentage) &&
        candidate.progressPercentage >= 0 &&
        candidate.progressPercentage <= 100)) &&
    (candidate.completedItems === null ||
      (typeof candidate.completedItems === 'number' && candidate.completedItems >= 0)) &&
    (candidate.totalItems === null ||
      (typeof candidate.totalItems === 'number' && candidate.totalItems > 0)) &&
    typeof candidate.detectedAt === 'string'
  )
}
