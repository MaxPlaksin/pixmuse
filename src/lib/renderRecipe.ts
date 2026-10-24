import type { CurvePoint, EditRecipe, HslBand, LocalStroke } from './recipe'

export interface Raster {
  pixels: Uint8ClampedArray
  width: number
  height: number
}

const bandCenters: Record<HslBand, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 270,
  magenta: 300,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return amount * amount * (3 - 2 * amount)
}

function indexOf(width: number, x: number, y: number): number {
  return (y * width + x) * 4
}

function rotateOrthogonal(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  turns: number,
): Raster {
  if (turns === 180) {
    const pixels = new Uint8ClampedArray(source.length)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const from = indexOf(width, x, y)
        const to = indexOf(width, width - 1 - x, height - 1 - y)
        pixels.set(source.subarray(from, from + 4), to)
      }
    }
    return { pixels, width, height }
  }

  const pixels = new Uint8ClampedArray(source.length)
  const nextWidth = height
  const nextHeight = width
  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const sourceX = turns === 90 ? y : width - 1 - y
      const sourceY = turns === 90 ? height - 1 - x : x
      const from = indexOf(width, sourceX, sourceY)
      pixels.set(source.subarray(from, from + 4), indexOf(nextWidth, x, y))
    }
  }
  return { pixels, width: nextWidth, height: nextHeight }
}

function sampleBilinear(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = clamp(Math.floor(x), 0, width - 1)
  const y0 = clamp(Math.floor(y), 0, height - 1)
  const x1 = clamp(x0 + 1, 0, width - 1)
  const y1 = clamp(y0 + 1, 0, height - 1)
  const tx = x - Math.floor(x)
  const ty = y - Math.floor(y)
  const sample = (sx: number, sy: number) => {
    const index = indexOf(width, sx, sy)
    return [source[index], source[index + 1], source[index + 2], source[index + 3]]
  }
  const a = sample(x0, y0)
  const b = sample(x1, y0)
  const c = sample(x0, y1)
  const d = sample(x1, y1)
  return [0, 1, 2, 3].map((channel) => {
    const top = a[channel] * (1 - tx) + b[channel] * tx
    const bottom = c[channel] * (1 - tx) + d[channel] * tx
    return top * (1 - ty) + bottom * ty
  }) as [number, number, number, number]
}

function rotateBilinear(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  degrees: number,
): Raster {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const centerX = (width - 1) / 2
  const centerY = (height - 1) / 2
  const corners = [
    [-centerX, -centerY],
    [width - 1 - centerX, -centerY],
    [-centerX, height - 1 - centerY],
    [width - 1 - centerX, height - 1 - centerY],
  ].map(([x, y]) => [x * cos - y * sin, x * sin + y * cos])
  const minX = Math.min(...corners.map((point) => point[0]))
  const maxX = Math.max(...corners.map((point) => point[0]))
  const minY = Math.min(...corners.map((point) => point[1]))
  const maxY = Math.max(...corners.map((point) => point[1]))
  const nextWidth = Math.max(1, Math.round(maxX - minX + 1))
  const nextHeight = Math.max(1, Math.round(maxY - minY + 1))
  const pixels = new Uint8ClampedArray(nextWidth * nextHeight * 4)

  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const centeredX = x + minX
      const centeredY = y + minY
      const sourceX = centeredX * cos + centeredY * sin + centerX
      const sourceY = -centeredX * sin + centeredY * cos + centerY
      const index = indexOf(nextWidth, x, y)
      if (
        sourceX < -0.5 ||
        sourceY < -0.5 ||
        sourceX > width - 0.5 ||
        sourceY > height - 0.5
      ) {
        pixels[index + 3] = 0
        continue
      }
      const color = sampleBilinear(source, width, height, sourceX, sourceY)
      pixels[index] = color[0]
      pixels[index + 1] = color[1]
      pixels[index + 2] = color[2]
      pixels[index + 3] = color[3]
    }
  }

  return { pixels, width: nextWidth, height: nextHeight }
}

function rotatePixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  degrees: number,
): Raster {
  const turns = ((degrees % 360) + 360) % 360
  const quarter = Math.round(turns / 90) * 90
  if (Math.abs(turns - quarter) < 0.05 || Math.abs(turns - (quarter - 360)) < 0.05) {
    const snapped = ((quarter % 360) + 360) % 360
    if (snapped === 0) {
      return { pixels: new Uint8ClampedArray(source), width, height }
    }
    return rotateOrthogonal(source, width, height, snapped)
  }
  return rotateBilinear(source, width, height, turns)
}

function scalePixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): Raster {
  if (scale === 1) {
    return { pixels: new Uint8ClampedArray(source), width, height }
  }
  const nextWidth = Math.max(1, Math.round(width * scale))
  const nextHeight = Math.max(1, Math.round(height * scale))
  const pixels = new Uint8ClampedArray(nextWidth * nextHeight * 4)

  for (let y = 0; y < nextHeight; y += 1) {
    const y0 = (y * height) / nextHeight
    const y1 = ((y + 1) * height) / nextHeight
    for (let x = 0; x < nextWidth; x += 1) {
      const x0 = (x * width) / nextWidth
      const x1 = ((x + 1) * width) / nextWidth
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let count = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const safeX = clamp(sx, 0, width - 1)
          const safeY = clamp(sy, 0, height - 1)
          const index = indexOf(width, safeX, safeY)
          red += source[index]
          green += source[index + 1]
          blue += source[index + 2]
          alpha += source[index + 3]
          count += 1
        }
      }
      const index = indexOf(nextWidth, x, y)
      pixels[index] = red / count
      pixels[index + 1] = green / count
      pixels[index + 2] = blue / count
      pixels[index + 3] = alpha / count
    }
  }

  return { pixels, width: nextWidth, height: nextHeight }
}

function cropPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  crop: EditRecipe['geometry']['crop'],
): Raster {
  if (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1) {
    return { pixels: new Uint8ClampedArray(source), width, height }
  }
  const x0 = clamp(Math.round(crop.x * width), 0, width - 1)
  const y0 = clamp(Math.round(crop.y * height), 0, height - 1)
  const cropWidth = clamp(Math.round(crop.width * width), 1, width - x0)
  const cropHeight = clamp(Math.round(crop.height * height), 1, height - y0)
  const pixels = new Uint8ClampedArray(cropWidth * cropHeight * 4)
  for (let y = 0; y < cropHeight; y += 1) {
    const from = indexOf(width, x0, y0 + y)
    pixels.set(source.subarray(from, from + cropWidth * 4), y * cropWidth * 4)
  }
  return { pixels, width: cropWidth, height: cropHeight }
}

function boxBlur(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const blurred = new Float32Array(source.length)
  const window = radius * 2 + 1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0
      let green = 0
      let blue = 0
      for (let ky = -radius; ky <= radius; ky += 1) {
        const sy = clamp(y + ky, 0, height - 1)
        for (let kx = -radius; kx <= radius; kx += 1) {
          const sx = clamp(x + kx, 0, width - 1)
          const index = indexOf(width, sx, sy)
          red += source[index]
          green += source[index + 1]
          blue += source[index + 2]
        }
      }
      const index = indexOf(width, x, y)
      blurred[index] = red / (window * window)
      blurred[index + 1] = green / (window * window)
      blurred[index + 2] = blue / (window * window)
      blurred[index + 3] = source[index + 3]
    }
  }
  return blurred
}

function applyTone(pixels: Uint8ClampedArray, adjustments: EditRecipe['adjustments']) {
  const exposure = 2 ** adjustments.exposure
  const contrast = (100 + adjustments.contrast) / 100
  const toneActive =
    adjustments.highlights !== 0 ||
    adjustments.shadows !== 0 ||
    adjustments.whites !== 0 ||
    adjustments.blacks !== 0
  const colorActive =
    adjustments.temperature !== 0 ||
    adjustments.tint !== 0 ||
    adjustments.saturation !== 0 ||
    adjustments.vibrance !== 0

  if (
    adjustments.exposure === 0 &&
    adjustments.contrast === 0 &&
    !toneActive &&
    !colorActive
  ) {
    return
  }

  for (let index = 0; index < pixels.length; index += 4) {
    let red = pixels[index] * exposure
    let green = pixels[index + 1] * exposure
    let blue = pixels[index + 2] * exposure

    if (adjustments.contrast !== 0) {
      red = (red - 128) * contrast + 128
      green = (green - 128) * contrast + 128
      blue = (blue - 128) * contrast + 128
    }

    if (toneActive) {
      const luma =
        (clamp(red, 0, 255) * 0.2126 +
          clamp(green, 0, 255) * 0.7152 +
          clamp(blue, 0, 255) * 0.0722) /
        255
      const shadow = smoothstep(0.62, 0, luma) * adjustments.shadows * 1.7
      const highlight = smoothstep(0.5, 1, luma) * adjustments.highlights * 1.7
      const black = smoothstep(0.35, 0, luma) * adjustments.blacks
      const white = smoothstep(0.7, 1, luma) * adjustments.whites
      const lift = shadow + highlight + black + white
      red += lift
      green += lift
      blue += lift
    }

    red += adjustments.temperature * 0.45
    blue -= adjustments.temperature * 0.45
    red += adjustments.tint * 0.25
    blue += adjustments.tint * 0.25
    green -= adjustments.tint * 0.35

    if (adjustments.saturation !== 0 || adjustments.vibrance !== 0) {
      const max = Math.max(red, green, blue)
      const min = Math.min(red, green, blue)
      const saturation = max <= 0 ? 0 : (max - min) / max
      const vibrance =
        (adjustments.vibrance / 100) * (1 - saturation) * (1 - saturation)
      const factor = 1 + adjustments.saturation / 100 + vibrance
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
      red = luminance + (red - luminance) * factor
      green = luminance + (green - luminance) * factor
      blue = luminance + (blue - luminance) * factor
    }

    pixels[index] = red
    pixels[index + 1] = green
    pixels[index + 2] = blue
  }
}

function curveValue(points: CurvePoint[], x: number): number {
  const sorted = [...points].sort((a, b) => a.x - b.x)
  if (x <= sorted[0].x) return sorted[0].y
  const last = sorted[sorted.length - 1]
  if (x >= last.x) return last.y
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]
    const end = sorted[index + 1]
    if (x >= start.x && x <= end.x) {
      const amount = (x - start.x) / (end.x - start.x || 1)
      return start.y + (end.y - start.y) * amount
    }
  }
  return x
}

function applyCurve(pixels: Uint8ClampedArray, points: CurvePoint[]) {
  const identity =
    points.length === 2 &&
    points[0].x === 0 &&
    points[0].y === 0 &&
    points[1].x === 1 &&
    points[1].y === 1
  if (identity) return
  const lut = new Uint8Array(256)
  for (let value = 0; value < 256; value += 1) {
    lut[value] = Math.round(clamp(curveValue(points, value / 255), 0, 1) * 255)
  }
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = lut[pixels[index]]
    pixels[index + 1] = lut[pixels[index + 1]]
    pixels[index + 2] = lut[pixels[index + 2]]
  }
}

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const luminance = (max + min) / 2
  if (max === min) return { hue: 0, saturation: 0, luminance }
  const delta = max - min
  const saturation =
    luminance > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0)
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return { hue: hue * 60, saturation, luminance }
}

function hslToRgb(hue: number, saturation: number, luminance: number) {
  const c = (1 - Math.abs(2 * luminance - 1)) * saturation
  const hp = (((hue % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = luminance - c / 2
  let red = 0
  let green = 0
  let blue = 0
  if (hp < 1) [red, green, blue] = [c, x, 0]
  else if (hp < 2) [red, green, blue] = [x, c, 0]
  else if (hp < 3) [red, green, blue] = [0, c, x]
  else if (hp < 4) [red, green, blue] = [0, x, c]
  else if (hp < 5) [red, green, blue] = [x, 0, c]
  else [red, green, blue] = [c, 0, x]
  return [(red + m) * 255, (green + m) * 255, (blue + m) * 255]
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360
  return Math.min(distance, 360 - distance)
}

function applyHsl(pixels: Uint8ClampedArray, recipe: EditRecipe) {
  const active = Object.values(recipe.hsl).some(
    (band) => band.hue !== 0 || band.saturation !== 0 || band.luminance !== 0,
  )
  if (!active) return

  for (let index = 0; index < pixels.length; index += 4) {
    const hsl = rgbToHsl(pixels[index], pixels[index + 1], pixels[index + 2])
    if (hsl.saturation < 0.04) continue
    let hue = hsl.hue
    let saturation = hsl.saturation
    let luminance = hsl.luminance
    for (const band of Object.keys(bandCenters) as HslBand[]) {
      const adjustment = recipe.hsl[band]
      const weight = 1 - hueDistance(hsl.hue, bandCenters[band]) / 42
      if (weight <= 0) continue
      hue += adjustment.hue * 0.4 * weight
      saturation = clamp(saturation + (adjustment.saturation / 100) * weight, 0, 1)
      luminance = clamp(luminance + (adjustment.luminance / 140) * weight, 0, 1)
    }
    const rgb = hslToRgb(hue, saturation, luminance)
    pixels[index] = rgb[0]
    pixels[index + 1] = rgb[1]
    pixels[index + 2] = rgb[2]
  }
}

function applySharpness(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
) {
  const blurred = boxBlur(source, width, height, 1)
  const gain = (amount / 100) * 1.4
  for (let index = 0; index < source.length; index += 4) {
    source[index] = source[index] + (source[index] - blurred[index]) * gain
    source[index + 1] =
      source[index + 1] + (source[index + 1] - blurred[index + 1]) * gain
    source[index + 2] =
      source[index + 2] + (source[index + 2] - blurred[index + 2]) * gain
  }
}

function applyDenoise(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
) {
  const blurred = boxBlur(source, width, height, 1)
  const blend = (amount / 100) * 0.85
  for (let index = 0; index < source.length; index += 4) {
    source[index] = source[index] * (1 - blend) + blurred[index] * blend
    source[index + 1] =
      source[index + 1] * (1 - blend) + blurred[index + 1] * blend
    source[index + 2] =
      source[index + 2] * (1 - blend) + blurred[index + 2] * blend
  }
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

function applySkin(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  smoothing: number,
  texture: number,
) {
  const blurred = boxBlur(source, width, height, 2)
  const strength = clamp(smoothing / 100, 0, 0.75)
  const keep = clamp(texture / 100, 0, 1)
  for (let index = 0; index < source.length; index += 4) {
    const red = source[index]
    const green = source[index + 1]
    const blue = source[index + 2]
    if (!isLikelySkin(red, green, blue)) continue
    const smooth = (channel: number, blurredChannel: number) =>
      channel * (1 - strength) + blurredChannel * strength
    const detail = keep * strength
    source[index] =
      smooth(red, blurred[index]) + (red - blurred[index]) * detail
    source[index + 1] =
      smooth(green, blurred[index + 1]) + (green - blurred[index + 1]) * detail
    source[index + 2] =
      smooth(blue, blurred[index + 2]) + (blue - blurred[index + 2]) * detail
  }
}

function strokeInfluence(
  stroke: LocalStroke,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const nx = width === 1 ? 0.5 : x / (width - 1)
  const ny = height === 1 ? 0.5 : y / (height - 1)
  let influence = 0
  for (const point of stroke.points) {
    const distance = Math.hypot(nx - point.x, ny - point.y)
    if (distance < stroke.radius) {
      influence = Math.max(influence, 1 - distance / stroke.radius)
    }
  }
  return influence
}

export function strokeBounds(
  stroke: LocalStroke,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } | undefined {
  if (stroke.points.length === 0 || width < 1 || height < 1) return undefined
  const xDenom = width === 1 ? 1 : width - 1
  const yDenom = height === 1 ? 1 : height - 1
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of stroke.points) {
    const x = point.x * (width === 1 ? 0 : width - 1)
    const y = point.y * (height === 1 ? 0 : height - 1)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const brushPad = Math.ceil(stroke.radius * Math.max(xDenom, yDenom))
  const samplePad =
    stroke.tool === 'heal'
      ? Math.ceil(Math.max(2, stroke.radius * Math.min(width, height)))
      : 0
  const pad = brushPad + samplePad + 1
  return {
    x0: Math.max(0, Math.floor(minX) - pad),
    y0: Math.max(0, Math.floor(minY) - pad),
    x1: Math.min(width - 1, Math.ceil(maxX) + pad),
    y1: Math.min(height - 1, Math.ceil(maxY) + pad),
  }
}

function sampleOutsideSpot(
  source: Uint8ClampedArray,
  bufferWidth: number,
  x: number,
  y: number,
  radius: number,
  imageWidth: number,
  imageHeight: number,
  originX: number,
  originY: number,
  bufferHeight: number,
): [number, number, number] | undefined {
  const radiusPx = Math.max(2, radius * Math.min(imageWidth, imageHeight))
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  for (let step = 0; step < 8; step += 1) {
    const angle = (Math.PI * 2 * step) / 8
    const sx = Math.round(x + Math.cos(angle) * radiusPx)
    const sy = Math.round(y + Math.sin(angle) * radiusPx)
    const localX = sx - originX
    const localY = sy - originY
    if (
      sx < 0 ||
      sy < 0 ||
      sx >= imageWidth ||
      sy >= imageHeight ||
      localX < 0 ||
      localY < 0 ||
      localX >= bufferWidth ||
      localY >= bufferHeight
    ) {
      continue
    }
    const index = indexOf(bufferWidth, localX, localY)
    red += source[index]
    green += source[index + 1]
    blue += source[index + 2]
    count += 1
  }
  if (count === 0) return undefined
  return [red / count, green / count, blue / count]
}

function applyStrokes(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  strokes: LocalStroke[],
) {
  for (const stroke of strokes) {
    const bounds = strokeBounds(stroke, width, height)
    if (!bounds) continue
    const regionWidth = bounds.x1 - bounds.x0 + 1
    const regionHeight = bounds.y1 - bounds.y0 + 1
    const reference = new Uint8ClampedArray(regionWidth * regionHeight * 4)
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      const from = (y * width + bounds.x0) * 4
      const to = (y - bounds.y0) * regionWidth * 4
      reference.set(source.subarray(from, from + regionWidth * 4), to)
    }
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      for (let x = bounds.x0; x <= bounds.x1; x += 1) {
        const influence = strokeInfluence(stroke, x, y, width, height)
        if (influence === 0) continue
        const amount = (stroke.strength / 100) * influence
        const index = indexOf(width, x, y)
        if (stroke.tool === 'heal') {
          const sampled = sampleOutsideSpot(
            reference,
            regionWidth,
            x,
            y,
            stroke.radius,
            width,
            height,
            bounds.x0,
            bounds.y0,
            regionHeight,
          )
          if (!sampled) continue
          source[index] = source[index] * (1 - amount) + sampled[0] * amount
          source[index + 1] =
            source[index + 1] * (1 - amount) + sampled[1] * amount
          source[index + 2] =
            source[index + 2] * (1 - amount) + sampled[2] * amount
        } else {
          const delta = 255 * 0.55 * amount * (stroke.tool === 'dodge' ? 1 : -1)
          source[index] += delta
          source[index + 1] += delta
          source[index + 2] += delta
        }
      }
    }
  }
}

export function renderRecipe(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  recipe: EditRecipe,
  options?: { ignoreCrop?: boolean },
): Raster {
  let raster = rotatePixels(source, width, height, recipe.geometry.rotation)
  raster = scalePixels(raster.pixels, raster.width, raster.height, recipe.geometry.scale)
  applyTone(raster.pixels, recipe.adjustments)
  applyCurve(raster.pixels, recipe.curve)
  applyHsl(raster.pixels, recipe)
  if (recipe.adjustments.sharpness > 0) {
    applySharpness(
      raster.pixels,
      raster.width,
      raster.height,
      recipe.adjustments.sharpness,
    )
  }
  if (recipe.adjustments.denoise > 0) {
    applyDenoise(raster.pixels, raster.width, raster.height, recipe.adjustments.denoise)
  }
  if (recipe.adjustments.skinSmoothing > 0) {
    applySkin(
      raster.pixels,
      raster.width,
      raster.height,
      recipe.adjustments.skinSmoothing,
      recipe.adjustments.skinTexture,
    )
  }
  if (recipe.strokes.length > 0) {
    applyStrokes(raster.pixels, raster.width, raster.height, recipe.strokes)
  }
  if (!options?.ignoreCrop) {
    raster = cropPixels(
      raster.pixels,
      raster.width,
      raster.height,
      recipe.geometry.crop,
    )
  }
  return raster
}
