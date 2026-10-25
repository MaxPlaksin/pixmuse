import { describe, expect, it } from 'vitest'
import { hashDistance, inspectQuality } from './qualityInspector'

function raster(width: number, height: number, value: (x: number, y: number) => number) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const channel = value(x, y)
      pixels[index] = channel
      pixels[index + 1] = channel
      pixels[index + 2] = channel
      pixels[index + 3] = 255
    }
  }
  return pixels
}

describe('Quality Inspector', () => {
  it('отличает ровный размытый кадр от детализированного', () => {
    const flat = inspectQuality(raster(64, 64, () => 120), 64, 64)
    const detailed = inspectQuality(
      raster(64, 64, (x, y) => ((x + y) % 2 === 0 ? 20 : 235)),
      64,
      64,
    )
    expect(flat.flags).toContain('blur')
    expect(detailed.sharpness).toBeGreaterThan(flat.sharpness)
    expect(detailed.flags).not.toContain('blur')
  })

  it('находит клиппинг и близкие perceptual hashes', () => {
    const white = inspectQuality(raster(32, 32, () => 255), 32, 32)
    const black = inspectQuality(raster(32, 32, () => 0), 32, 32)
    expect(white.flags).toContain('highlights')
    expect(black.flags).toContain('shadows')
    expect(hashDistance(white.perceptualHash, white.perceptualHash)).toBe(0)
    expect(hashDistance('0000', '0101')).toBe(2)
  })
})
