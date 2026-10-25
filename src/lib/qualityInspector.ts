export interface QualityReport {
  sharpness: number
  highlightClipping: number
  shadowClipping: number
  perceptualHash: string
  flags: Array<'blur' | 'highlights' | 'shadows'>
}

function luminance(pixels: Uint8ClampedArray, width: number, x: number, y: number) {
  const index = (y * width + x) * 4
  return (
    pixels[index] * 0.2126 +
    pixels[index + 1] * 0.7152 +
    pixels[index + 2] * 0.0722
  )
}

function differenceHash(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  let hash = ''
  let sum = 0
  let samples = 0
  for (let y = 0; y < 8; y += 1) {
    const sampleY = Math.min(height - 1, Math.round(((y + 0.5) / 8) * height))
    for (let x = 0; x < 8; x += 1) {
      const leftX = Math.min(width - 1, Math.round((x / 9) * width))
      const rightX = Math.min(width - 1, Math.round(((x + 1) / 9) * width))
      sum += luminance(pixels, width, leftX, sampleY)
      samples += 1
      hash +=
        luminance(pixels, width, leftX, sampleY) >
        luminance(pixels, width, rightX, sampleY)
          ? '1'
          : '0'
    }
  }
  const average = Math.round(sum / Math.max(1, samples))
    .toString(2)
    .padStart(8, '0')
  return average + hash
}

export function hashDistance(first: string, second: string): number {
  if (first.length !== second.length) return Number.POSITIVE_INFINITY
  let distance = 0
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) distance += 1
  }
  return distance
}

export function inspectQuality(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): QualityReport {
  if (width < 1 || height < 1 || pixels.length < width * height * 4) {
    throw new Error('Некорректный растр для анализа качества')
  }

  let highlights = 0
  let shadows = 0
  const pixelCount = width * height
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4
    const light = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2])
    const dark = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2])
    if (light >= 250) highlights += 1
    if (dark <= 5) shadows += 1
  }

  let laplacianSum = 0
  let laplacianSquareSum = 0
  let samples = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = luminance(pixels, width, x, y)
      const laplacian =
        luminance(pixels, width, x - 1, y) +
        luminance(pixels, width, x + 1, y) +
        luminance(pixels, width, x, y - 1) +
        luminance(pixels, width, x, y + 1) -
        center * 4
      laplacianSum += laplacian
      laplacianSquareSum += laplacian * laplacian
      samples += 1
    }
  }
  const mean = samples > 0 ? laplacianSum / samples : 0
  const sharpness =
    samples > 0 ? Math.max(0, laplacianSquareSum / samples - mean * mean) : 0
  const highlightClipping = highlights / pixelCount
  const shadowClipping = shadows / pixelCount
  const flags: QualityReport['flags'] = []
  if (sharpness < 120) flags.push('blur')
  if (highlightClipping > 0.05) flags.push('highlights')
  if (shadowClipping > 0.05) flags.push('shadows')

  return {
    sharpness,
    highlightClipping,
    shadowClipping,
    perceptualHash: differenceHash(pixels, width, height),
    flags,
  }
}
