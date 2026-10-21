type PagePlaybackStateMessage = {
  source: 'scrimtrack-page-playback'
  isPlaying: boolean
  observedAt: number
}

const mediaPlaybackCheckIntervalMs = 1_000
const mediaPlaybackHeartbeatIntervalMs = 15_000
const mediaPlaybackProgressThresholdSeconds = 0.05
const pagePlaybackStateMaxAgeMs = 3_000

export function createPlaybackMonitor(
  isPageActive: () => boolean,
  onActivity: () => void,
) {
  let isMediaPlaybackActive = false
  let isPagePlaybackActive = false
  let lastPagePlaybackStateAt = 0
  let lastMediaPlaybackHeartbeatAt = 0
  const observedMediaTimes = new WeakMap<HTMLMediaElement, number>()

  let mediaPlaybackCheckIntervalId: number | null = null
  const stopMediaPlaybackMonitor = () => {
    if (mediaPlaybackCheckIntervalId === null) {
      return
    }

    window.clearInterval(mediaPlaybackCheckIntervalId)
    mediaPlaybackCheckIntervalId = null
    isMediaPlaybackActive = false
  }

  const getMediaElements = (): HTMLMediaElement[] => {
    const mediaElements = Array.from(
      document.querySelectorAll<HTMLMediaElement>('video, audio'),
    )

    document.querySelectorAll<HTMLIFrameElement>('iframe').forEach((frame) => {
      try {
        const frameDocument = frame.contentDocument

        if (frameDocument) {
          mediaElements.push(
            ...frameDocument.querySelectorAll<HTMLMediaElement>('video, audio'),
          )
        }
      } catch {
        // Cross-origin frames are intentionally ignored to keep permissions minimal.
      }
    })

    return mediaElements
  }

  const isMediaElementAdvancing = (media: HTMLMediaElement): boolean => {
    const currentTime = media.currentTime
    const previousTime = observedMediaTimes.get(media)

    observedMediaTimes.set(media, currentTime)

    if (
      media.paused ||
      media.ended ||
      media.playbackRate <= 0 ||
      media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return false
    }

    return (
      previousTime === undefined ||
      currentTime - previousTime > mediaPlaybackProgressThresholdSeconds
    )
  }

  const isMediaSessionPlaying = (): boolean => {
    try {
      return navigator.mediaSession?.playbackState === 'playing'
    } catch {
      return false
    }
  }

  const isPagePlaybackStateMessage = (
    value: unknown,
  ): value is PagePlaybackStateMessage => {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    const candidate = value as Record<string, unknown>

    return (
      candidate.source === 'scrimtrack-page-playback' &&
      typeof candidate.isPlaying === 'boolean' &&
      typeof candidate.observedAt === 'number'
    )
  }

  const handlePagePlaybackState = (event: MessageEvent) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      !isPagePlaybackStateMessage(event.data)
    ) {
      return
    }

    isPagePlaybackActive = event.data.isPlaying
    lastPagePlaybackStateAt = Date.now()
  }

  const checkMediaPlayback = () => {
    const now = Date.now()
    const wasPlaying = isMediaPlaybackActive
    const hasActivePagePlayback =
      isPagePlaybackActive &&
      now - lastPagePlaybackStateAt <= pagePlaybackStateMaxAgeMs
    const isPlaying =
      isPageActive() &&
      (hasActivePagePlayback ||
        isMediaSessionPlaying() ||
        getMediaElements().some(isMediaElementAdvancing))

    isMediaPlaybackActive = isPlaying

    if (
      !isPlaying ||
      (wasPlaying &&
        now - lastMediaPlaybackHeartbeatAt < mediaPlaybackHeartbeatIntervalMs)
    ) {
      return
    }

    lastMediaPlaybackHeartbeatAt = now
    onActivity()
  }

  const startMediaPlaybackMonitor = () => {
    if (mediaPlaybackCheckIntervalId !== null) {
      return
    }

    checkMediaPlayback()
    mediaPlaybackCheckIntervalId = window.setInterval(
      checkMediaPlayback,
      mediaPlaybackCheckIntervalMs,
    )
  }

  return {
    get isPlaying() { return isMediaPlaybackActive },
    start: startMediaPlaybackMonitor, stop: stopMediaPlaybackMonitor,
    check: checkMediaPlayback, handleMessage: handlePagePlaybackState,
    resetHeartbeat: () => { lastMediaPlaybackHeartbeatAt = 0 },
  }
}
