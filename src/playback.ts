const playbackMessageSource = 'scrimtrack-page-playback'
const playbackHeartbeatIntervalMs = 1_000

const trackedMediaElements = new Set<HTMLMediaElement>()
const activeAudioSources = new Set<AudioBufferSourceNode>()

const isMediaElementPlaying = (media: HTMLMediaElement): boolean =>
  !media.paused &&
  !media.ended &&
  media.playbackRate > 0 &&
  media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA

const isPlaybackActive = (): boolean =>
  Array.from(trackedMediaElements).some(isMediaElementPlaying) ||
  Array.from(activeAudioSources).some(
    (source) => source.context.state === 'running',
  )

const reportPlaybackState = () => {
  window.postMessage(
    {
      source: playbackMessageSource,
      isPlaying: isPlaybackActive(),
      observedAt: Date.now(),
    },
    window.location.origin,
  )
}

const trackMediaElement = (media: HTMLMediaElement) => {
  if (trackedMediaElements.has(media)) {
    return
  }

  trackedMediaElements.add(media)

  const playbackEvents: Array<keyof HTMLMediaElementEventMap> = [
    'playing',
    'pause',
    'ended',
    'waiting',
    'stalled',
    'emptied',
    'error',
    'ratechange',
  ]

  playbackEvents.forEach((eventType) => {
    media.addEventListener(eventType, reportPlaybackState)
  })
}

const trackMediaInNode = (node: Node) => {
  if (node instanceof HTMLMediaElement) {
    trackMediaElement(node)
  }

  if (node instanceof Element) {
    node
      .querySelectorAll<HTMLMediaElement>('video, audio')
      .forEach(trackMediaElement)
  }
}

const nativeMediaPlay = HTMLMediaElement.prototype.play

HTMLMediaElement.prototype.play = function play(): Promise<void> {
  trackMediaElement(this)
  return nativeMediaPlay.call(this)
}

if (typeof AudioBufferSourceNode !== 'undefined') {
  const nativeAudioSourceStart = AudioBufferSourceNode.prototype.start

  AudioBufferSourceNode.prototype.start = function start(
    when?: number,
    offset?: number,
    duration?: number,
  ): void {
    this.addEventListener(
      'ended',
      () => {
        activeAudioSources.delete(this)
        reportPlaybackState()
      },
      { once: true },
    )

    if (duration !== undefined) {
      nativeAudioSourceStart.call(this, when, offset, duration)
    } else if (offset !== undefined) {
      nativeAudioSourceStart.call(this, when, offset)
    } else if (when !== undefined) {
      nativeAudioSourceStart.call(this, when)
    } else {
      nativeAudioSourceStart.call(this)
    }

    activeAudioSources.add(this)
    reportPlaybackState()
  }
}

const mediaObserver = new MutationObserver((records) => {
  records.forEach((record) => {
    record.addedNodes.forEach(trackMediaInNode)
  })
})

const startMediaObserver = () => {
  const root = document.documentElement

  if (!root) {
    window.setTimeout(startMediaObserver, 0)
    return
  }

  trackMediaInNode(root)
  mediaObserver.observe(root, { childList: true, subtree: true })
}

startMediaObserver()
window.setInterval(reportPlaybackState, playbackHeartbeatIntervalMs)
