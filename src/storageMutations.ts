// Only the service worker runs mutation implementations. Other extension
// contexts send commands so read/modify/write operations share one queue.
let storageHost = false
let mutationTail: Promise<unknown> = Promise.resolve()
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

export const enableStorageHost = () => { storageHost = true }

export const assertStorageHost = () => {
  if (!storageHost) throw new Error('Storage writes must run in the background worker.')
}

export const enqueueStorageMutation = <Result>(operation: () => Promise<Result>): Promise<Result> => {
  const result = mutationTail.then(operation)
  // A failed operation must not prevent subsequent saves.
  mutationTail = result.catch(() => {})
  return result
}

export const requestStorageMutation = <Result>(command: string, args: unknown[]): Promise<Result> =>
  new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'storage:mutate', command, args }, (response) => {
        const result = response as { ok?: boolean; value?: Result; error?: string } | undefined
        if (chrome.runtime.lastError || !result?.ok) {
          reject(new Error(chrome.runtime.lastError?.message ?? result?.error ?? 'Could not save local data.'))
        } else {
          resolve(result.value as Result)
        }
      })
    } catch (error) {
      reject(error)
    }
  })

export const defineStorageMutation = <Args extends unknown[], Result>(
  command: string,
  implementation: (...args: Args) => Promise<Result>,
): ((...args: Args) => Promise<Result>) => {
  handlers.set(command, implementation as (...args: unknown[]) => Promise<unknown>)
  return (...args) => storageHost
    ? implementation(...args)
    : requestStorageMutation<Result>(command, args)
}

export const executeStorageMutation = async (command: string, args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(command)
  if (!handler) throw new Error('Unknown storage mutation.')
  return handler(...args)
}

// Promise.all rejects early; keep the queue occupied until every started write
// finishes, including when one of its siblings fails.
export const settleStorageWrites = async <const Values extends readonly unknown[]>(values: Values): Promise<{
  -readonly [Key in keyof Values]: Awaited<Values[Key]>
}> => {
  const results = await Promise.allSettled(values)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as {
    -readonly [Key in keyof Values]: Awaited<Values[Key]>
  }
}
