import { renderRecipe } from '../lib/renderRecipe'
import type { EditRecipe } from '../lib/recipe'

interface RenderRequest {
  requestId: number
  buffer: ArrayBuffer
  width: number
  height: number
  recipe: EditRecipe
  ignoreCrop: boolean
}

interface RenderResponse {
  requestId: number
  width: number
  height: number
  buffer: ArrayBuffer
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null
  postMessage: (message: RenderResponse, transfer: Transferable[]) => void
}

let latestRequest = 0

workerScope.onmessage = (event) => {
  const requestId = event.data.requestId
  latestRequest = requestId
  const rendered = renderRecipe(
    new Uint8ClampedArray(event.data.buffer),
    event.data.width,
    event.data.height,
    event.data.recipe,
    { ignoreCrop: event.data.ignoreCrop },
  )
  if (requestId !== latestRequest) return
  const pixels = new Uint8ClampedArray(rendered.pixels)
  workerScope.postMessage(
    {
      requestId: event.data.requestId,
      width: rendered.width,
      height: rendered.height,
      buffer: pixels.buffer,
    },
    [pixels.buffer],
  )
}
