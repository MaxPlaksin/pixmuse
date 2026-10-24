// @ts-nocheck
import { renderRecipe } from '../lib/renderRecipe'

self.onmessage = (event) => {
  const rendered = renderRecipe(
    new Uint8ClampedArray(event.data.buffer),
    event.data.width,
    event.data.height,
    event.data.recipe,
    { ignoreCrop: event.data.ignoreCrop },
  )
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
