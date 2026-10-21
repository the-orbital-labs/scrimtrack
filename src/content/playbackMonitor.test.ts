// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://scrimba.com/lesson"}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackMonitor } from './playbackMonitor'

describe('page playback monitoring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T12:00:00Z'))
  })
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const message = (isPlaying = true, overrides: MessageEventInit = {}) => new MessageEvent('message', {
    source: window,
    origin: window.location.origin,
    data: { source: 'scrimtrack-page-playback', isPlaying, observedAt: Date.now() },
    ...overrides,
  })

  it('requires a recent playback message from this page and foreground focus', () => {
    let focused = true
    const activity = vi.fn()
    const monitor = createPlaybackMonitor(() => focused, activity)
    monitor.handleMessage(message(true, { source: null }))
    monitor.handleMessage(message(true, { origin: 'https://example.com' }))
    monitor.handleMessage(message(true, { data: { source: 'other', isPlaying: true } }))
    monitor.check()
    expect(monitor.isPlaying).toBe(false)
    expect(activity).not.toHaveBeenCalled()

    monitor.handleMessage(message())
    monitor.check()
    expect(monitor.isPlaying).toBe(true)
    expect(activity).toHaveBeenCalledTimes(1)
    focused = false
    monitor.check()
    expect(monitor.isPlaying).toBe(false)
    focused = true
    vi.advanceTimersByTime(3001)
    monitor.check()
    expect(monitor.isPlaying).toBe(false)
  })

  it('keeps playback active with heartbeats and stops polling on cleanup', () => {
    const activity = vi.fn()
    const monitor = createPlaybackMonitor(() => true, activity)
    monitor.handleMessage(message())
    monitor.start()
    monitor.start()
    for (let second = 0; second < 15; second++) {
      monitor.handleMessage(message())
      vi.advanceTimersByTime(1000)
    }
    expect(monitor.isPlaying).toBe(true)
    expect(activity).toHaveBeenCalledTimes(2)
    monitor.handleMessage(message(false))
    vi.advanceTimersByTime(1000)
    expect(monitor.isPlaying).toBe(false)
    monitor.stop()
    monitor.handleMessage(message())
    vi.advanceTimersByTime(1000)
    expect(monitor.isPlaying).toBe(false)
    expect(activity).toHaveBeenCalledTimes(2)
  })

  it('recognizes advancing media in the page and same-origin frames, excluding stalled media', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const video = document.createElement('video')
    frame.contentDocument!.body.append(video)
    vi.spyOn(video, 'paused', 'get').mockReturnValue(false)
    vi.spyOn(video, 'readyState', 'get').mockReturnValue(2)
    const monitor = createPlaybackMonitor(() => true, vi.fn())
    monitor.check()
    expect(monitor.isPlaying).toBe(true)
    monitor.check()
    expect(monitor.isPlaying).toBe(false)
    video.currentTime = 1
    monitor.check()
    expect(monitor.isPlaying).toBe(true)
    video.playbackRate = 0
    video.currentTime = 2
    monitor.check()
    expect(monitor.isPlaying).toBe(false)
  })
})
