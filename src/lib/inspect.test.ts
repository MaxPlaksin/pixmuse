import { describe, expect, it } from 'vitest'
import { defaultRecipe } from './recipe'
import { inspectPixels, sampleRgb } from './inspect'
import { renderRecipe } from './renderRecipe'

describe('контроль кадра', () => {
  it('считает гистограмму и отмечает пересвет с провалом', () => {
    const pixels = new Uint8ClampedArray([
      255, 10, 10, 255,
      0, 0, 0, 255,
      20, 30, 40, 255,
    ])
    const report = inspectPixels(pixels)
    expect(report.red[255]).toBe(1)
    expect(report.green[0]).toBe(1)
    expect(report.blue[40]).toBe(1)
    expect(report.clippedHighlights).toBe(1)
    expect(report.clippedShadows).toBe(1)
    expect(sampleRgb(pixels, 3, 2, 0)).toEqual({ r: 20, g: 30, b: 40 })
  })

  it('два прохода одного рецепта совпадают до сжатия', () => {
    const source = new Uint8ClampedArray(8 * 6 * 4)
    for (let index = 0; index < source.length; index += 4) {
      source[index] = (index / 4) % 180
      source[index + 1] = 90
      source[index + 2] = 140
      source[index + 3] = 255
    }
    const recipe = defaultRecipe()
    recipe.adjustments.exposure = 0.3
    recipe.adjustments.contrast = 12
    const first = renderRecipe(source, 8, 6, recipe)
    const second = renderRecipe(source, 8, 6, recipe)
    expect([...first.pixels]).toEqual([...second.pixels])
  })
})
