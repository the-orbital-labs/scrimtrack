import type { TrackingReply, TrackingUpdate } from './trackingProtocol'

type Pending = {
  update: TrackingUpdate
  persisted: boolean
  persisting: Promise<void> | null
  resolve: (reply: TrackingReply) => void
}

// Each immutable outbox entry has one producer. The worker removes entries only
// after committing their receipts; ordinary shared storage still has one writer.
export const createTrackingDelivery = (
  onReply: (update: TrackingUpdate, reply: TrackingReply) => void,
  onFailure: () => void,
) => {
  const pending: Pending[] = []
  let busy = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0

  const persist = (entry: Pending): Promise<void> => {
    if (entry.persisted) return Promise.resolve()
    if (entry.persisting) return entry.persisting
    entry.persisting = new Promise<void>((resolve, reject) => {
      try {
        const update = entry.update
        chrome.storage.local.set({ [`tracking-outbox:${update.sessionId}:${update.sequence}`]: update }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
          else { entry.persisted = true; resolve() }
        })
      } catch (error) { reject(error) }
    }).finally(() => { entry.persisting = null })
    return entry.persisting
  }

  const pump = () => {
    if (busy || stopped || !pending.length) return
    busy = true
    const entry = pending[0]
    let finished = false
    const retry = () => {
      if (finished || pending[0] !== entry || stopped) return
      finished = true
      clearTimeout(timer)
      onFailure()
      timer = setTimeout(() => { busy = false; pump() }, Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)))
    }
    void persist(entry).then(() => {
      if (pending[0] !== entry || stopped) return
      timer = setTimeout(retry, 3_000)
      try {
        chrome.runtime.sendMessage(entry.update, (value) => {
          if (pending[0] !== entry || finished || stopped) return
          const reply = value as TrackingReply | undefined
          if (chrome.runtime.lastError || !reply ||
            (!reply.ok && reply.error !== 'tracking-reset' && reply.trackingEnabled !== false) ||
            (reply.ok && (reply.sequence !== entry.update.sequence || reply.epoch !== entry.update.epoch))) {
            retry()
            return
          }
          finished = true
          clearTimeout(timer)
          pending.shift()
          busy = false
          attempt = 0
          onReply(entry.update, reply)
          entry.resolve(reply)
          pump()
        })
      } catch { retry() }
    }).catch(retry)
  }

  return {
    send(update: TrackingUpdate): Promise<TrackingReply> {
      return new Promise((resolve) => {
        const entry: Pending = { update, resolve, persisted: false, persisting: null }
        pending.push(entry)
        // Persist all captured intervals immediately, including those waiting
        // behind a lost reply. They survive navigation or a worker restart.
        void persist(entry).catch(onFailure)
        pump()
      })
    },
    cancel() {
      clearTimeout(timer)
      busy = false
      attempt = 0
      for (const entry of pending.splice(0)) entry.resolve({ ok: false, error: 'tracking-reset' })
    },
    dispose() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
