export interface RgbHistogram {
  red: number[]
  green: number[]
  blue: number[]
  clippedHighlights: number
  clippedShadows: number
  pixels: number
}

export function inspectPixels(pixels: Uint8ClampedArray): RgbHistogram {
  const red = Array.from({ length: 256 }, () => 0)
  const green = Array.from({ length: 256 }, () => 0)
  const blue = Array.from({ length: 256 }, () => 0)
  let clippedHighlights = 0
  let clippedShadows = 0
  const count = pixels.length / 4
  for (let index = 0; index < pixels.length; index += 4) {
    const redValue = pixels[index]
    const greenValue = pixels[index + 1]
    const blueValue = pixels[index + 2]
    red[redValue] += 1
    green[greenValue] += 1
    blue[blueValue] += 1
    if (Math.max(redValue, greenValue, blueValue) >= 250) clippedHighlights += 1
    if (Math.min(redValue, greenValue, blueValue) <= 5) clippedShadows += 1
  }
  return {
    red,
    green,
    blue,
    clippedHighlights,
    clippedShadows,
    pixels: count,
  }
}

export function sampleRgb(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): { r: number; g: number; b: number } | undefined {
  if (x < 0 || y < 0 || x >= width) return undefined
  const index = (y * width + x) * 4
  if (index + 2 >= pixels.length) return undefined
  return { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] }
}
