export const idleTimeoutPresets = [
  { seconds: 10, label: '10s' },
  { seconds: 30, label: '30s' },
  { seconds: 60, label: '1m' },
  { seconds: 2 * 60, label: '2m' },
  { seconds: 3 * 60, label: '3m' },
] as const

export const isIdleTimeoutPreset = (seconds: number): boolean =>
  idleTimeoutPresets.some((preset) => preset.seconds === seconds)

export const getIdleTimeoutPresetLabel = (seconds: number): string | null =>
  idleTimeoutPresets.find((preset) => preset.seconds === seconds)?.label ?? null
