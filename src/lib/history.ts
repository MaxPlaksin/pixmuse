export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

export function historyPush<T>(history: History<T>, next: T): History<T> {
  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
  }
}

export function historyUndo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history
  const present = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
  }
}

export function historyRedo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history
  const [present, ...future] = history.future
  return {
    past: [...history.past, history.present],
    present,
    future,
  }
}
