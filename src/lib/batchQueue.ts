export interface QueueControl {
  isPaused: () => boolean
  isCancelled: () => boolean
}

export async function runQueue<T>(options: {
  items: T[]
  control: QueueControl
  shouldRun: (item: T) => boolean
  work: (item: T) => Promise<void>
  wait?: () => Promise<void>
}): Promise<'done' | 'cancelled'> {
  const wait =
    options.wait ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 80)))

  for (const item of options.items) {
    while (options.control.isPaused() && !options.control.isCancelled()) {
      await wait()
    }
    if (options.control.isCancelled()) return 'cancelled'
    if (!options.shouldRun(item)) continue
    await options.work(item)
  }

  return options.control.isCancelled() ? 'cancelled' : 'done'
}
