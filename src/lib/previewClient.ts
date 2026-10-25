import type { EditRecipe } from './recipe'
import { createPreviewQueue, StalePreview } from './previewQueue'
import type { Raster } from './renderRecipe'

let worker: Worker | null = null
let workerSequence = 0
const queue = createPreviewQueue<Raster>()
const pendingRejectors = new Set<(error: Error) => void>()

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), {
      type: 'module',
    })
    return worker
  } catch {
    worker = null
    return null
  }
}

function renderInWorker(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  recipe: EditRecipe,
  ignoreCrop: boolean,
): Promise<Raster> {
  const thread = getWorker()
  if (!thread) {
    return Promise.reject(new Error('Предпросмотр не запустился в фоновом потоке'))
  }
  const requestId = ++workerSequence
  return new Promise((resolve, reject) => {
    pendingRejectors.add(reject)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.requestId !== requestId) return
      cleanup()
      resolve({
        pixels: new Uint8ClampedArray(event.data.buffer),
        width: event.data.width,
        height: event.data.height,
      })
    }
    const onError = () => {
      cleanup()
      thread?.terminate()
      worker = null
      reject(new Error('Предпросмотр не запустился в фоновом потоке'))
    }
    function cleanup() {
      pendingRejectors.delete(reject)
      thread?.removeEventListener('message', onMessage)
      thread?.removeEventListener('error', onError)
    }
    thread.addEventListener('message', onMessage)
    thread.addEventListener('error', onError)
    const copy = source.slice()
    thread.postMessage(
      { requestId, buffer: copy.buffer, width, height, recipe, ignoreCrop },
      [copy.buffer],
    )
  })
}

export function disposePreviewWorker(): void {
  queue.cancelPending()
  worker?.terminate()
  worker = null
  workerSequence += 1
  const error = new StalePreview()
  pendingRejectors.forEach((reject) => reject(error))
  pendingRejectors.clear()
}

export function renderPreview(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  recipe: EditRecipe,
  ignoreCrop = false,
): Promise<Raster> {
  return queue.submit(() =>
    renderInWorker(source, width, height, recipe, ignoreCrop),
  )
}

export { StalePreview }
