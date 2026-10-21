import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChromeMock, uninstallChromeMock, failNextStorageOperation } from './test/chromeMock'
import { createTrackingDelivery } from './trackingDelivery'
import { applyTrackingUpdate, deliverTrackingUpdate, replayTrackingOutbox } from './tracking'
import type { TrackingUpdate } from './trackingProtocol'

describe('tracking delivery', () => {
  let store: ReturnType<typeof installChromeMock>
  const update = (sequence: number, kind: TrackingUpdate['kind'] = 'pulse', from = 0, at = 5): TrackingUpdate => ({
    type: 'scrimba:tracking-update', epoch: 'initial', sessionId: 'client-session',
    sequence, kind, from: new Date(100_000 + from * 1000).toISOString(),
    at: new Date(100_000 + at * 1000).toISOString(),
    url: 'https://scrimba.com/lesson', title: null, isMediaPlaying: false,
  })
  const seconds = () => Object.values(store.data.dailyActivities).reduce((sum, day) => sum + day.activeSeconds, 0)
  const clients: ReturnType<typeof createTrackingDelivery>[] = []
  const client = (reply = vi.fn(), failure = vi.fn()) => {
    const delivery = createTrackingDelivery(reply, failure)
    clients.push(delivery)
    return delivery
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    store = installChromeMock()
    await applyTrackingUpdate(update(1, 'start', 0, 0))
  })
  afterEach(() => {
    clients.splice(0).forEach((delivery) => delivery.dispose())
    vi.useRealTimers()
    uninstallChromeMock()
  })

  it.each([false, true])('retries the same interval when a reply is lost (committed=%s)', async (committed) => {
    const acknowledged = vi.fn()
    let first = true
    const send = vi.fn((message, callback) => {
      if (first) {
        first = false
        if (committed) void deliverTrackingUpdate(message)
        return // The message or its reply is interrupted.
      }
      void deliverTrackingUpdate(message).then(callback)
    })
    Object.assign(chrome.runtime, { sendMessage: send })
    const pulse = update(2)
    const saved = client(acknowledged).send(pulse)
    await vi.advanceTimersByTimeAsync(0)
    expect(acknowledged).not.toHaveBeenCalled()
    expect(seconds()).toBe(committed ? 5 : 0)
    await vi.advanceTimersByTimeAsync(4_000)
    await saved
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map(([message]) => message)).toEqual([pulse, pulse])
    expect(acknowledged).toHaveBeenCalledTimes(1)
    expect(seconds()).toBe(5)
  })

  it('persists queued final time before navigation even when an earlier reply is missing', async () => {
    Object.assign(chrome.runtime, { sendMessage: vi.fn() })
    const delivery = client()
    void delivery.send(update(2))
    void delivery.send(update(3, 'stop', 5, 7))
    await vi.advanceTimersByTimeAsync(0)
    delivery.dispose() // The content document goes away.
    expect(Reflect.has(store.data, 'tracking-outbox:client-session:3')).toBe(true)
    await replayTrackingOutbox()
    await replayTrackingOutbox()
    expect(seconds()).toBe(7)
    expect(store.data.currentScrimbaPage).toMatchObject({ isActive: false })
    expect(Object.keys(store.data).filter((key) => key.startsWith('tracking-outbox:'))).toEqual([])
  })

  it('retries outbox persistence failures before sending or acknowledging the interval', async () => {
    const send = vi.fn((message, callback) => { void deliverTrackingUpdate(message).then(callback) })
    Object.assign(chrome.runtime, { sendMessage: send })
    const acknowledged = vi.fn()
    failNextStorageOperation('set')
    const saved = client(acknowledged).send(update(2))
    await vi.advanceTimersByTimeAsync(0)
    expect(send).not.toHaveBeenCalled()
    expect(acknowledged).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    await saved
    expect(acknowledged).toHaveBeenCalledTimes(1)
    expect(seconds()).toBe(5)
  })

  it('does not acknowledge a mismatched receipt and retries with backoff', async () => {
    const acknowledged = vi.fn()
    const send = vi.fn((_, callback) => callback({ ok: true, epoch: 'initial', sequence: 99 }))
    Object.assign(chrome.runtime, { sendMessage: send })
    void client(acknowledged).send(update(2))
    await vi.advanceTimersByTimeAsync(999)
    expect(send).toHaveBeenCalledTimes(1)
    expect(acknowledged).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('ignores an old callback after reset instead of acknowledging the new queue head', async () => {
    const callbacks: ((reply: unknown) => void)[] = []
    Object.assign(chrome.runtime, { sendMessage: vi.fn((_, callback) => callbacks.push(callback)) })
    const acknowledged = vi.fn()
    const delivery = client(acknowledged)
    void delivery.send(update(2))
    await vi.advanceTimersByTimeAsync(0)
    delivery.cancel()
    void delivery.send({ ...update(1, 'start', 10, 10), epoch: 'after-reset' })
    await vi.advanceTimersByTimeAsync(0)
    callbacks[0]({ ok: true, epoch: 'initial', sequence: 2 })
    expect(acknowledged).not.toHaveBeenCalled()
    callbacks[1]({ ok: true, epoch: 'after-reset', sequence: 1 })
    expect(acknowledged).toHaveBeenCalledTimes(1)
  })
})
