export type TrackingUpdate = {
  type: 'scrimba:tracking-update'
  epoch: string
  sessionId: string
  sequence: number
  kind: 'start' | 'pulse' | 'stop' | 'activity'
  url: string
  title: string | null
  at: string
  from: string
  isMediaPlaying: boolean
}

export type TrackingReply = {
  ok: boolean
  epoch?: string
  sequence?: number
  isIdle?: boolean
  isActive?: boolean
  trackingEnabled?: boolean
  error?: string
}

export type TrackingReceipt = {
  sequence: number
  at: string
  accountedAt: string
  countedUntil: string
  isMediaPlaying: boolean
  lastActivityAt: string
  startedAt: string
  activeUntil: string | null
  reply: TrackingReply
}

export type TrackingState = {
  epoch: string
  sessions: Record<string, TrackingReceipt>
}
