export class StalePreview extends Error {
  constructor() {
    super('устаревший предпросмотр')
    this.name = 'StalePreview'
  }
}

interface PendingJob<T> {
  requestId: number
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

export function createPreviewQueue<T>() {
  let latest = 0
  let active = false
  let pending: PendingJob<T> | null = null

  async function pump() {
    if (active || !pending) return
    const job = pending
    pending = null
    if (job.requestId !== latest) {
      job.reject(new StalePreview())
      void pump()
      return
    }
    active = true
    try {
      const value = await job.run()
      if (job.requestId !== latest) job.reject(new StalePreview())
      else job.resolve(value)
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error('предпросмотр'))
    } finally {
      active = false
      void pump()
    }
  }

  return {
    submit(run: () => Promise<T>): Promise<T> {
      const requestId = ++latest
      return new Promise((resolve, reject) => {
        if (pending) pending.reject(new StalePreview())
        pending = { requestId, run, resolve, reject }
        void pump()
      })
    },
    cancelPending(): void {
      latest += 1
      if (pending) {
        pending.reject(new StalePreview())
        pending = null
      }
    },
  }
}
