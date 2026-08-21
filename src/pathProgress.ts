import { getStorageValue, setStorageValue, updateStorageValue } from './storage'
import type { AverageWindowDays, PathProgress } from './storage'
import {
  builtInScrimbaCourses,
  isScrimbaCourseProgress,
} from './scrimbaCourse'
import type {
  ScrimbaCourseDefinition,
  ScrimbaCourseProgress,
} from './scrimbaCourse'

const averageWindowValues = new Set<AverageWindowDays>([7, 14, 30, 'all'])

export const parseAverageWindowDays = (value: string): AverageWindowDays =>
  value === 'all' ? 'all' : Number(value) as 7 | 14 | 30

export const isValidAverageWindowDays = (value: unknown): value is AverageWindowDays =>
  averageWindowValues.has(value as AverageWindowDays)

export const isValidPathName = (value: string): boolean =>
  value.trim().length > 0

export const isValidProgressPercentage = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 100

export const isValidTotalEstimatedHours = (value: number): boolean =>
  Number.isFinite(value) && value > 0

const normalizePercentage = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(100, Math.max(0, value))
}

const normalizeTotalHours = (
  value: number,
  fallback: number,
): number => (Number.isFinite(value) && value > 0 ? value : fallback)

const normalizeAverageWindow = (value: unknown): AverageWindowDays =>
  isValidAverageWindowDays(value)
    ? (value as AverageWindowDays)
    : 7

const normalizeDetectedCourses = (
  value: unknown,
): Record<string, ScrimbaCourseProgress> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, ScrimbaCourseProgress] =>
        isScrimbaCourseProgress(entry[1]) && entry[0] === entry[1].id,
    ),
  )
}

const normalizePathProgress = (pathProgress: PathProgress): PathProgress => ({
  averageWindowDays: normalizeAverageWindow(pathProgress.averageWindowDays),
  courseUrl:
    typeof pathProgress.courseUrl === 'string' && pathProgress.courseUrl.trim()
      ? pathProgress.courseUrl
      : null,
  detectedCourses: normalizeDetectedCourses(pathProgress.detectedCourses),
  lastProgressSyncAt:
    typeof pathProgress.lastProgressSyncAt === 'string'
      ? pathProgress.lastProgressSyncAt
      : null,
  pathName: pathProgress.pathName.trim(),
  progressPercentage: normalizePercentage(pathProgress.progressPercentage),
  progressSource: pathProgress.progressSource === 'scrimba' ? 'scrimba' : 'manual',
  selectedCourseId:
    typeof pathProgress.selectedCourseId === 'string' &&
    pathProgress.selectedCourseId.trim()
      ? pathProgress.selectedCourseId
      : null,
  totalEstimatedHours: normalizeTotalHours(pathProgress.totalEstimatedHours, 1),
})

export type SelectableScrimbaCourse = ScrimbaCourseDefinition & {
  detectedAt: string | null
  progressPercentage: number | null
}

export const getSelectableScrimbaCourses = (
  pathProgress: PathProgress | null,
): SelectableScrimbaCourse[] => {
  const detectedCourses = pathProgress?.detectedCourses ?? {}
  const builtInIds = new Set(builtInScrimbaCourses.map((course) => course.id))
  const builtInOptions = builtInScrimbaCourses.map((course) => {
    const detectedCourse = detectedCourses[course.id]

    return {
      ...course,
      detectedAt: detectedCourse?.detectedAt ?? null,
      progressPercentage: detectedCourse?.progressPercentage ?? null,
      totalEstimatedHours:
        detectedCourse?.totalEstimatedHours ?? course.totalEstimatedHours,
    }
  })
  const discoveredOptions = Object.values(detectedCourses)
    .filter((course) => !builtInIds.has(course.id))
    .map((course) => ({
      detectedAt: course.detectedAt,
      id: course.id,
      name: course.name,
      progressPercentage: course.progressPercentage,
      totalEstimatedHours: course.totalEstimatedHours,
      url: course.url,
    }))
    .sort((first, second) => first.name.localeCompare(second.name))

  return [...builtInOptions, ...discoveredOptions]
}

export const getSelectedScrimbaCourse = (
  pathProgress: PathProgress | null,
): SelectableScrimbaCourse | null =>
  getSelectableScrimbaCourses(pathProgress).find(
    (course) => course.id === pathProgress?.selectedCourseId,
  ) ?? null

export const getPathProgress = async (): Promise<PathProgress> =>
  normalizePathProgress(await getStorageValue('pathProgress'))

export const savePathName = (pathName: string): Promise<PathProgress> =>
  updateStorageValue('pathProgress', (pathProgress) =>
    normalizePathProgress({
      ...pathProgress,
      pathName,
    }),
  )

export const saveTotalEstimatedHours = (
  totalEstimatedHours: number,
): Promise<PathProgress> =>
  updateStorageValue('pathProgress', (pathProgress) =>
    normalizePathProgress({
      ...pathProgress,
      totalEstimatedHours: normalizeTotalHours(
        totalEstimatedHours,
        pathProgress.totalEstimatedHours,
      ),
    }),
  )

export const saveProgressPercentage = (
  progressPercentage: number,
): Promise<PathProgress> =>
  updateStorageValue('pathProgress', (pathProgress) =>
    normalizePathProgress({
      ...pathProgress,
      lastProgressSyncAt: null,
      progressPercentage,
      progressSource: 'manual',
    }),
  )

export const selectScrimbaCourse = (
  courseId: string,
): Promise<PathProgress> =>
  updateStorageValue('pathProgress', (storedPathProgress) => {
    const pathProgress = normalizePathProgress(storedPathProgress)
    const course = getSelectableScrimbaCourses(pathProgress).find(
      (candidate) => candidate.id === courseId,
    )

    if (!course) {
      return pathProgress
    }

    const hasDetectedProgress = course.progressPercentage !== null

    return normalizePathProgress({
      ...pathProgress,
      courseUrl: course.url,
      lastProgressSyncAt: hasDetectedProgress ? course.detectedAt : null,
      pathName: course.name,
      progressPercentage: hasDetectedProgress ? course.progressPercentage! : 0,
      progressSource: hasDetectedProgress ? 'scrimba' : 'manual',
      selectedCourseId: course.id,
      totalEstimatedHours:
        course.totalEstimatedHours ?? pathProgress.totalEstimatedHours,
    })
  })

export const recordDetectedScrimbaCourse = (
  detectedCourse: ScrimbaCourseProgress,
): Promise<PathProgress> =>
  updateStorageValue('pathProgress', (storedPathProgress) => {
    const pathProgress = normalizePathProgress(storedPathProgress)
    const previousCourse = pathProgress.detectedCourses[detectedCourse.id]
    const nextCourse: ScrimbaCourseProgress = {
      ...detectedCourse,
      completedItems:
        detectedCourse.completedItems ?? previousCourse?.completedItems ?? null,
      progressPercentage:
        detectedCourse.progressPercentage ??
        previousCourse?.progressPercentage ??
        null,
      totalEstimatedHours:
        detectedCourse.totalEstimatedHours ??
        previousCourse?.totalEstimatedHours ??
        null,
      totalItems: detectedCourse.totalItems ?? previousCourse?.totalItems ?? null,
    }
    const isSelectedCourse = pathProgress.selectedCourseId === detectedCourse.id
    const hasDetectedProgress = nextCourse.progressPercentage !== null

    return normalizePathProgress({
      ...pathProgress,
      courseUrl: isSelectedCourse ? nextCourse.url : pathProgress.courseUrl,
      detectedCourses: {
        ...pathProgress.detectedCourses,
        [nextCourse.id]: nextCourse,
      },
      lastProgressSyncAt:
        isSelectedCourse && hasDetectedProgress
          ? nextCourse.detectedAt
          : pathProgress.lastProgressSyncAt,
      pathName: isSelectedCourse ? nextCourse.name : pathProgress.pathName,
      progressPercentage:
        isSelectedCourse && hasDetectedProgress
          ? nextCourse.progressPercentage!
          : pathProgress.progressPercentage,
      progressSource:
        isSelectedCourse && hasDetectedProgress
          ? 'scrimba'
          : pathProgress.progressSource,
      totalEstimatedHours:
        isSelectedCourse && nextCourse.totalEstimatedHours !== null
          ? nextCourse.totalEstimatedHours
          : pathProgress.totalEstimatedHours,
    })
  })

export const saveAverageWindowDays = (
  averageWindowDays: AverageWindowDays,
): Promise<PathProgress> =>
  updateStorageValue('pathProgress', (pathProgress) =>
    normalizePathProgress({
      ...pathProgress,
      averageWindowDays,
    }),
  )

export const ensurePathProgress = async (): Promise<PathProgress> => {
  const pathProgress = await getPathProgress()

  await setStorageValue('pathProgress', pathProgress)

  return pathProgress
}
