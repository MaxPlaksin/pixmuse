// @ts-nocheck
import { renderRecipe } from '../lib/renderRecipe'

let latestRequest = 0

self.onmessage = (event) => {
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
  self.postMessage(
    {
      requestId: event.data.requestId,
      width: rendered.width,
      height: rendered.height,
      buffer: pixels.buffer,
    },
    [pixels.buffer],
  )
}
