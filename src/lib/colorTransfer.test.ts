import { describe, expect, it } from 'vitest'
import {
  applyAdjustments,
  calculateStats,
  transferPixels,
} from './colorTransfer'

describe('calculateStats', () => {
  it('считает среднее и отклонение только по RGB-каналам', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 0,
      30, 40, 50, 255,
    ])

    expect(calculateStats(pixels)).toEqual({
      mean: [20, 30, 40],
      deviation: [10, 10, 10],
    })
  })
})

describe('transferPixels', () => {
  it('сохраняет исходник при нулевой интенсивности', () => {
    const source = new Uint8ClampedArray([20, 40, 60, 128])
    const result = transferPixels(
      source,
      { mean: [20, 40, 60], deviation: [1, 1, 1] },
      { mean: [100, 110, 120], deviation: [2, 2, 2] },
      0,
    )

    expect([...result]).toEqual([...source])
  })

  it('переносит цвет и сохраняет альфа-канал', () => {
    const source = new Uint8ClampedArray([20, 40, 60, 128])
    const result = transferPixels(
      source,
      { mean: [20, 40, 60], deviation: [10, 10, 10] },
      { mean: [100, 110, 120], deviation: [10, 10, 10] },
      1,
    )

    expect([...result]).toEqual([100, 110, 120, 128])
  })

  it('ограничивает значения диапазоном байта', () => {
    const source = new Uint8ClampedArray([255, 0, 100, 255])
    const result = transferPixels(
      source,
      { mean: [0, 255, 100], deviation: [1, 1, 1] },
      { mean: [255, 0, 100], deviation: [10, 10, 10] },
      1,
    )

    expect([...result]).toEqual([255, 0, 100, 255])
  })
})

describe('applyAdjustments', () => {
  it('увеличивает экспозицию на один стоп', () => {
    const source = new Uint8ClampedArray([50, 60, 70, 255])
    const result = applyAdjustments(source, {
      exposure: 1,
      contrast: 0,
      saturation: 0,
      warmth: 0,
    })

    expect([...result]).toEqual([100, 120, 140, 255])
  })

  it('делает кадр теплее и сохраняет прозрачность', () => {
    const source = new Uint8ClampedArray([100, 100, 100, 120])
    const result = applyAdjustments(source, {
      exposure: 0,
      contrast: 0,
      saturation: 0,
      warmth: 20,
    })

    expect(result[0]).toBeGreaterThan(100)
    expect(result[2]).toBeLessThan(100)
    expect(result[3]).toBe(120)
  })

  it('контраст уводит тёмный пиксель ещё темнее', () => {
    const source = new Uint8ClampedArray([50, 60, 70, 255])
    const result = applyAdjustments(source, {
      exposure: 0,
      contrast: 50,
      saturation: 0,
      warmth: 0,
    })
    expect(result[0]).toBeLessThan(50)
    expect(result[3]).toBe(255)
  })

  it('насыщенность усиливает уже цветной пиксель', () => {
    const source = new Uint8ClampedArray([200, 20, 20, 255])
    const result = applyAdjustments(source, {
      exposure: 0,
      contrast: 0,
      saturation: 80,
      warmth: 0,
    })
    expect(result[0] - result[1]).toBeGreaterThan(200 - 20)
  })
})
