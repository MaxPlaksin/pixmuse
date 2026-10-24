import type { EditRecipe } from './recipe'
import { renderRecipe, type Raster } from './renderRecipe'

let worker: Worker | null = null
let sequence = 0

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

export function renderPreview(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  recipe: EditRecipe,
  ignoreCrop = false,
): Promise<Raster> {
  const requestId = ++sequence
  const fallback = () => renderRecipe(source, width, height, recipe, { ignoreCrop })
  const current = getWorker()
  if (!current) return Promise.resolve(fallback())

  return new Promise((resolve) => {
    let settled = false
    const finish = (raster: Raster) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      current.removeEventListener('message', onMessage)
      current.removeEventListener('error', onError)
      resolve(raster)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data.requestId !== requestId) return
      finish({
        pixels: new Uint8ClampedArray(event.data.buffer),
        width: event.data.width,
        height: event.data.height,
      })
    }
    const onError = () => finish(fallback())
    const timer = window.setTimeout(() => finish(fallback()), 1200)
    current.addEventListener('message', onMessage)
    current.addEventListener('error', onError)
    const copy = source.slice()
    current.postMessage(
      { requestId, buffer: copy.buffer, width, height, recipe, ignoreCrop },
      [copy.buffer],
    )
  })
}
