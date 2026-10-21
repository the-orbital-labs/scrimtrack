import { describe, expect, it, vi } from 'vitest'
import { enqueueStorageMutation, settleStorageWrites } from './storageMutations'

describe('storage mutation queue', () => {
  it('waits for pending sibling writes before starting the next operation after failure', async () => {
    let finishWrite!: () => void
    const pendingWrite = new Promise<void>((resolve) => { finishWrite = resolve })
    const first = enqueueStorageMutation(() => settleStorageWrites([
      Promise.reject(new Error('Write failed')), pendingWrite,
    ]))
    const failed = expect(first).rejects.toThrow('Write failed')
    const next = vi.fn(async () => 'saved')
    const second = enqueueStorageMutation(next)
    await Promise.resolve()
    await Promise.resolve()
    expect(next).not.toHaveBeenCalled()
    finishWrite()
    await failed
    expect(await second).toBe('saved')
  })
})
