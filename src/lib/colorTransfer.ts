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

async function fileToImageData(file: Blob): Promise<{
  bitmap: ImageBitmap
  imageData: ImageData
}> {
  const bitmap = await createImageBitmap(file)
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

export async function processPhoto(
  file: Blob,
  referenceStats: ColorStats,
  strength: number,
  adjustments: RetouchAdjustments,
  quality = 0.92,
): Promise<Blob> {
  const { bitmap, imageData } = await fileToImageData(file)
  const sourceStats = calculateStats(imageData.data)
  const transferred = transferPixels(
    imageData.data,
    sourceStats,
    referenceStats,
    strength,
  )
  const pixels = applyAdjustments(transferred, adjustments)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')

  bitmap.close()
  if (!context) {
    throw new Error('Браузер не поддерживает Canvas 2D')
  }

  imageData.data.set(pixels)
  context.putImageData(imageData, 0, 0)

  if (adjustments.skinSmoothing && adjustments.skinSmoothing > 0) {
    const blurCanvas = document.createElement('canvas')
    blurCanvas.width = canvas.width
    blurCanvas.height = canvas.height
    const blurContext = blurCanvas.getContext('2d', { willReadFrequently: true })
    if (blurContext) {
      const radius = 0.6 + (adjustments.skinSmoothing / 100) * 2.4
      blurContext.filter = `blur(${radius}px)`
      blurContext.drawImage(canvas, 0, 0)
      const blurred = blurContext.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      )
      softenSkin(imageData, blurred, adjustments.skinSmoothing)
      context.putImageData(imageData, 0, 0)
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Не удалось создать JPEG')),
      'image/jpeg',
      quality,
    )
  })
}
