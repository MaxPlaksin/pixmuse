import { attachJpegMetadata, fittedSize, openBitmap } from './exportImage'
import { recipeIsIdentity, type EditRecipe } from './recipe'
import { renderRecipe } from './renderRecipe'

export type ChannelTriplet = [number, number, number]

export interface ColorStats {
  mean: ChannelTriplet
  deviation: ChannelTriplet
}

export interface RetouchAdjustments {
  exposure: number
  contrast: number
  saturation: number
  warmth: number
  skinSmoothing?: number
}

export function calculateStats(pixels: Uint8ClampedArray): ColorStats {
  const count = pixels.length / 4
  const sum: ChannelTriplet = [0, 0, 0]
  const squaredSum: ChannelTriplet = [0, 0, 0]

  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = pixels[index + channel]
      sum[channel] += value
      squaredSum[channel] += value * value
    }
  }

  const mean = sum.map((value) => value / count) as ChannelTriplet
  const deviation = squaredSum.map((value, channel) => {
    const variance = value / count - mean[channel] ** 2
    return Math.max(Math.sqrt(Math.max(variance, 0)), 0.001)
  }) as ChannelTriplet

  return { mean, deviation }
}

export function transferPixels(
  source: Uint8ClampedArray,
  sourceStats: ColorStats,
  referenceStats: ColorStats,
  strength: number,
): Uint8ClampedArray {
  const amount = Math.min(Math.max(strength, 0), 1)
  const result = new Uint8ClampedArray(source)

  for (let index = 0; index < source.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const normalized =
        (source[index + channel] - sourceStats.mean[channel]) /
        sourceStats.deviation[channel]
      const transferred =
        normalized * referenceStats.deviation[channel] +
        referenceStats.mean[channel]
      result[index + channel] =
        source[index + channel] * (1 - amount) + transferred * amount
    }
  }

  return result
}

export function applyAdjustments(
  source: Uint8ClampedArray,
  adjustments: Omit<RetouchAdjustments, 'skinSmoothing'>,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(source)
  const exposure = 2 ** adjustments.exposure
  const contrast = (100 + adjustments.contrast) / 100
  const saturation = 1 + adjustments.saturation / 100
  const warmth = adjustments.warmth * 0.55

  for (let index = 0; index < source.length; index += 4) {
    let red = source[index] * exposure
    let green = source[index + 1] * exposure
    let blue = source[index + 2] * exposure

    red = (red - 128) * contrast + 128
    green = (green - 128) * contrast + 128
    blue = (blue - 128) * contrast + 128

    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    red = luminance + (red - luminance) * saturation + warmth
    green = luminance + (green - luminance) * saturation + warmth * 0.12
    blue = luminance + (blue - luminance) * saturation - warmth

    result[index] = red
    result[index + 1] = green
    result[index + 2] = blue
  }

  return result
}

function isLikelySkin(red: number, green: number, blue: number): boolean {
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  return (
    red > 55 &&
    green > 30 &&
    blue > 20 &&
    max - min > 12 &&
    red > green &&
    red > blue
  )
}

function softenSkin(
  original: ImageData,
  blurred: ImageData,
  amount: number,
): void {
  const strength = Math.min(Math.max(amount / 100, 0), 0.75)
  if (strength === 0) return

  for (let index = 0; index < original.data.length; index += 4) {
    const red = original.data[index]
    const green = original.data[index + 1]
    const blue = original.data[index + 2]
    if (!isLikelySkin(red, green, blue)) continue

    original.data[index] = red * (1 - strength) + blurred.data[index] * strength
    original.data[index + 1] =
      green * (1 - strength) + blurred.data[index + 1] * strength
    original.data[index + 2] =
      blue * (1 - strength) + blurred.data[index + 2] * strength
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Операция отменена', 'AbortError')
  }
}

async function fileToImageData(
  file: Blob,
  signal?: AbortSignal,
): Promise<{
  bitmap: ImageBitmap
  imageData: ImageData
}> {
  throwIfAborted(signal)
  const bitmap = await openBitmap(file)
  if (signal?.aborted) {
    bitmap.close()
    throwIfAborted(signal)
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    bitmap.close()
    throw new Error('Браузер не поддерживает Canvas 2D')
  }

  context.drawImage(bitmap, 0, 0)
  return {
    bitmap,
    imageData: context.getImageData(0, 0, bitmap.width, bitmap.height),
  }
}

export async function readColorStats(file: Blob): Promise<ColorStats> {
  const { bitmap, imageData } = await fileToImageData(file)
  const stats = calculateStats(imageData.data)
  bitmap.close()
  return stats
}

export function composeRetouchPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  referenceStats: ColorStats | undefined,
  strength: number,
  adjustments: RetouchAdjustments,
  recipe?: EditRecipe,
): { pixels: Uint8ClampedArray; width: number; height: number } {
  let pixels = source
  if (referenceStats && strength > 0) {
    pixels = transferPixels(pixels, calculateStats(pixels), referenceStats, strength)
  }
  pixels = applyAdjustments(pixels, adjustments)
  if (recipe && !recipeIsIdentity(recipe)) {
    return renderRecipe(pixels, width, height, recipe)
  }
  return { pixels, width, height }
}

export function paintRetouch(
  target: HTMLCanvasElement,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  skinSmoothing = 0,
) {
  const scratch = document.createElement('canvas')
  scratch.width = width
  scratch.height = height
  const scratchContext = scratch.getContext('2d', { willReadFrequently: true })
  if (!scratchContext) throw new Error('Браузер не поддерживает Canvas 2D')
  const output = scratchContext.createImageData(width, height)
  output.data.set(pixels)
  scratchContext.putImageData(output, 0, 0)

  if (skinSmoothing > 0) {
    const blurCanvas = document.createElement('canvas')
    blurCanvas.width = width
    blurCanvas.height = height
    const blurContext = blurCanvas.getContext('2d', { willReadFrequently: true })
    if (blurContext) {
      const radius = 0.6 + (skinSmoothing / 100) * 2.4
      blurContext.filter = `blur(${radius}px)`
      blurContext.drawImage(scratch, 0, 0)
      const blurred = blurContext.getImageData(0, 0, width, height)
      softenSkin(output, blurred, skinSmoothing)
      scratchContext.putImageData(output, 0, 0)
    }
  }

  target.width = width
  target.height = height
  const context = target.getContext('2d')
  if (!context) throw new Error('Браузер не поддерживает Canvas 2D')
  context.drawImage(scratch, 0, 0)
}

export async function processPhoto(
  file: Blob,
  referenceStats: ColorStats | undefined,
  strength: number,
  adjustments: RetouchAdjustments,
  options?: {
    quality?: number
    recipe?: EditRecipe
    format?: 'jpeg' | 'png'
    maxEdge?: number
    signal?: AbortSignal
  },
): Promise<Blob> {
  const quality = options?.quality ?? 0.92
  const format = options?.format ?? 'jpeg'
  const { bitmap, imageData } = await fileToImageData(file, options?.signal)
  let composed
  try {
    throwIfAborted(options?.signal)
    composed = composeRetouchPixels(
      new Uint8ClampedArray(imageData.data),
      bitmap.width,
      bitmap.height,
      referenceStats,
      strength,
      adjustments,
      options?.recipe,
    )
  } finally {
    bitmap.close()
  }
  throwIfAborted(options?.signal)
  const canvas = document.createElement('canvas')
  paintRetouch(
    canvas,
    composed.pixels,
    composed.width,
    composed.height,
    adjustments.skinSmoothing ?? 0,
  )
  throwIfAborted(options?.signal)

  const size = fittedSize(canvas.width, canvas.height, options?.maxEdge ?? 0)
  const encoded = document.createElement('canvas')
  encoded.width = size.width
  encoded.height = size.height
  const encodedContext = encoded.getContext('2d')
  if (!encodedContext) throw new Error('Браузер не поддерживает Canvas 2D')
  encodedContext.drawImage(canvas, 0, 0, size.width, size.height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    encoded.toBlob(
      (value) => {
        if (options?.signal?.aborted) {
          reject(new DOMException('Операция отменена', 'AbortError'))
        } else if (value) {
          resolve(value)
        } else {
          reject(new Error('Не удалось создать файл'))
        }
      },
      format === 'png' ? 'image/png' : 'image/jpeg',
      quality,
    )
  })
  throwIfAborted(options?.signal)
  const output =
    format === 'jpeg' ? await attachJpegMetadata(file, blob) : blob
  throwIfAborted(options?.signal)
  return output
}
