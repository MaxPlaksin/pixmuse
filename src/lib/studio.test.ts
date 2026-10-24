import { describe, expect, it } from 'vitest'
import { copyJpegMetadata } from './jpegMetadata'
import {
  createHistory,
  historyPush,
  historyRedo,
  historyUndo,
} from './history'
import { runQueue } from './batchQueue'
import {
  applyPreset,
  defaultRecipe,
  presetFromRecipe,
  recipeIsIdentity,
} from './recipe'
import { renderRecipe } from './renderRecipe'

function pixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): number[] {
  const index = (y * width + x) * 4
  return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]]
}

describe('renderRecipe', () => {
  it('не меняет исходные пиксели и оставляет нейтральный рецепт без эффекта', () => {
    const source = new Uint8ClampedArray([20, 40, 60, 128, 250, 10, 10, 255])
    const snapshot = [...source]
    const result = renderRecipe(source, 2, 1, defaultRecipe())

    expect([...source]).toEqual(snapshot)
    expect([...result.pixels]).toEqual(snapshot)
    expect(result.width).toBe(2)
    expect(result.height).toBe(1)
    expect(recipeIsIdentity(defaultRecipe())).toBe(true)
  })

  it('повышает экспозицию на один стоп', () => {
    const source = new Uint8ClampedArray([50, 60, 70, 255])
    const recipe = defaultRecipe()
    recipe.adjustments.exposure = 1

    expect([...renderRecipe(source, 1, 1, recipe).pixels]).toEqual([
      100, 120, 140, 255,
    ])
  })

  it('поднимает тени и почти не трогает света', () => {
    const source = new Uint8ClampedArray([10, 10, 10, 255, 250, 250, 250, 255])
    const recipe = defaultRecipe()
    recipe.adjustments.shadows = 100
    const result = renderRecipe(source, 2, 1, recipe)

    expect(pixel(result.pixels, 2, 0, 0)[0]).toBeGreaterThan(40)
    expect(pixel(result.pixels, 2, 1, 0)[0]).toBeGreaterThan(245)
  })

  it('приглушает света и оставляет тени', () => {
    const source = new Uint8ClampedArray([10, 10, 10, 255, 250, 250, 250, 255])
    const recipe = defaultRecipe()
    recipe.adjustments.highlights = -100
    const result = renderRecipe(source, 2, 1, recipe)

    expect(pixel(result.pixels, 2, 0, 0)[0]).toBeLessThan(15)
    expect(pixel(result.pixels, 2, 1, 0)[0]).toBeLessThan(220)
  })

  it('сдвигает белую и чёрную точки по яркости', () => {
    const source = new Uint8ClampedArray([8, 8, 8, 255, 245, 245, 245, 255])
    const recipe = defaultRecipe()
    recipe.adjustments.whites = 100
    recipe.adjustments.blacks = -100
    const result = renderRecipe(source, 2, 1, recipe)

    expect(pixel(result.pixels, 2, 0, 0)[0]).toBeLessThan(8)
    expect(pixel(result.pixels, 2, 1, 0)[0]).toBe(255)
  })

  it('делает серый теплее и меняет оттенок в сторону пурпурного', () => {
    const warm = defaultRecipe()
    warm.adjustments.temperature = 100
    const warmed = renderRecipe(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1, warm)
      .pixels
    expect(warmed[0]).toBeGreaterThan(128)
    expect(warmed[2]).toBeLessThan(128)

    const tinted = defaultRecipe()
    tinted.adjustments.tint = 100
    const tint = renderRecipe(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1, tinted)
      .pixels
    expect(tint[1]).toBeLessThan(128)
    expect(tint[0]).toBeGreaterThan(128)
  })

  it('vibrance сильнее меняет слабо насыщенный цвет, чем чистый', () => {
    const recipe = defaultRecipe()
    recipe.adjustments.vibrance = 100
    const muted = renderRecipe(new Uint8ClampedArray([140, 130, 120, 255]), 1, 1, recipe)
      .pixels
    const pure = renderRecipe(new Uint8ClampedArray([220, 20, 20, 255]), 1, 1, recipe)
      .pixels
    const mutedSpread = Math.max(muted[0], muted[1], muted[2]) - Math.min(muted[0], muted[1], muted[2])
    const sourceSpread = 20
    const pureSpread = Math.max(pure[0], pure[1], pure[2]) - Math.min(pure[0], pure[1], pure[2])

    expect(mutedSpread).toBeGreaterThan(sourceSpread + 8)
    expect(pureSpread).toBeLessThan(210)
  })

  it('усиливает локальный контраст резкостью и сглаживает шум', () => {
    const edge = new Uint8ClampedArray(9 * 4)
    edge.fill(100)
    edge[4 * 4] = 180
    edge[4 * 4 + 1] = 180
    edge[4 * 4 + 2] = 180
    edge[4 * 4 + 3] = 255
    for (let index = 3; index < edge.length; index += 4) edge[index] = 255
    const sharp = defaultRecipe()
    sharp.adjustments.sharpness = 100
    const sharpened = renderRecipe(edge, 3, 3, sharp).pixels
    expect(pixel(sharpened, 3, 1, 1)[0]).toBeGreaterThan(180)

    const noisy = new Uint8ClampedArray(edge)
    const denoise = defaultRecipe()
    denoise.adjustments.denoise = 100
    const denoised = renderRecipe(noisy, 3, 3, denoise).pixels
    expect(pixel(denoised, 3, 1, 1)[0]).toBeLessThan(180)
  })

  it('поворачивает кадр на 90 градусов и обрезает правую половину', () => {
    const source = new Uint8ClampedArray([
      10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255,
    ])
    const rotated = defaultRecipe()
    rotated.geometry.rotation = 90
    const turned = renderRecipe(source, 2, 2, rotated)
    expect(turned.width).toBe(2)
    expect(turned.height).toBe(2)
    expect(pixel(turned.pixels, 2, 0, 0)).toEqual([30, 0, 0, 255])

    const cropped = defaultRecipe()
    cropped.geometry.crop = { x: 0.5, y: 0, width: 0.5, height: 1 }
    const crop = renderRecipe(source, 2, 2, cropped)
    expect(crop.width).toBe(1)
    expect(crop.height).toBe(2)
    expect(pixel(crop.pixels, 1, 0, 0)).toEqual([20, 0, 0, 255])
  })

  it('масштабирует кадр и сохраняет средний цвет', () => {
    const source = new Uint8ClampedArray([
      0, 0, 0, 255, 100, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    ])
    const recipe = defaultRecipe()
    recipe.geometry.scale = 0.5
    const scaled = renderRecipe(source, 2, 2, recipe)

    expect(scaled.width).toBe(1)
    expect(scaled.height).toBe(1)
    expect(pixel(scaled.pixels, 1, 0, 0)[0]).toBe(25)
  })

  it('применяет тоновую кривую и сдвиг красного тона', () => {
    const curved = defaultRecipe()
    curved.curve = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.8 },
      { x: 1, y: 1 },
    ]
    const lifted = renderRecipe(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1, curved)
    expect(lifted.pixels[0]).toBeGreaterThan(150)

    const hsl = defaultRecipe()
    hsl.hsl.red.hue = 100
    const shifted = renderRecipe(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1, hsl)
    expect(shifted.pixels[1]).toBeGreaterThan(20)
  })

  it('лечит точечный дефект и не переносит мазки через пресет', () => {
    const source = new Uint8ClampedArray(5 * 5 * 4)
    for (let index = 0; index < source.length; index += 4) {
      source[index] = 120
      source[index + 1] = 120
      source[index + 2] = 120
      source[index + 3] = 255
    }
    source[12 * 4] = 255
    source[12 * 4 + 1] = 0
    source[12 * 4 + 2] = 0
    const recipe = defaultRecipe()
    recipe.strokes = [
      {
        id: 'spot',
        tool: 'heal',
        points: [{ x: 0.5, y: 0.5 }],
        radius: 0.25,
        strength: 100,
      },
    ]
    const healed = renderRecipe(source, 5, 5, recipe)
    expect(pixel(healed.pixels, 5, 2, 2)[0]).toBeLessThan(180)

    const preset = presetFromRecipe('Портрет', recipe)
    const target = defaultRecipe()
    target.geometry.rotation = 90
    target.strokes = [
      {
        id: 'keep',
        tool: 'dodge',
        points: [{ x: 0.2, y: 0.2 }],
        radius: 0.1,
        strength: 40,
      },
    ]
    const applied = applyPreset(target, preset)

    expect(applied.adjustments).toEqual(recipe.adjustments)
    expect(applied.strokes).toEqual(target.strokes)
    expect(applied.geometry.rotation).toBe(90)
    expect('strokes' in preset).toBe(false)
  })

  it('осветляет и затемняет только область мазка', () => {
    const source = new Uint8ClampedArray([80, 80, 80, 255, 80, 80, 80, 255])
    const dodge = defaultRecipe()
    dodge.strokes = [
      {
        id: 'light',
        tool: 'dodge',
        points: [{ x: 0, y: 0.5 }],
        radius: 0.2,
        strength: 100,
      },
    ]
    const dodged = renderRecipe(source, 2, 1, dodge)
    expect(pixel(dodged.pixels, 2, 0, 0)[0]).toBeGreaterThan(80)
    expect(pixel(dodged.pixels, 2, 1, 0)[0]).toBe(80)

    const burn = defaultRecipe()
    burn.strokes = [
      {
        id: 'dark',
        tool: 'burn',
        points: [{ x: 1, y: 0.5 }],
        radius: 0.2,
        strength: 100,
      },
    ]
    const burned = renderRecipe(source, 2, 1, burn)
    expect(pixel(burned.pixels, 2, 1, 0)[0]).toBeLessThan(80)
  })
})

describe('history', () => {
  it('отменяет и возвращает изменение рецепта', () => {
    const initial = defaultRecipe()
    const edited = defaultRecipe()
    edited.adjustments.exposure = 0.4
    const saved = historyPush(createHistory(initial), edited)

    expect(saved.present.adjustments.exposure).toBe(0.4)
    const undone = historyUndo(saved)
    expect(undone.present.adjustments.exposure).toBe(0)
    expect(historyRedo(undone).present.adjustments.exposure).toBe(0.4)
  })
})

describe('runQueue', () => {
  it('ждёт снятия паузы, пропускает готовые кадры и умеет отменяться', async () => {
    let paused = true
    let cancelled = false
    const seen: number[] = []
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const running = runQueue({
      items: [1, 2, 3],
      control: {
        isPaused: () => paused,
        isCancelled: () => cancelled,
      },
      shouldRun: (item) => item !== 2,
      work: async (item) => {
        seen.push(item)
      },
      wait: () => gate,
    })

    await Promise.resolve()
    expect(seen).toEqual([])
    paused = false
    release()
    await running
    expect(seen).toEqual([1, 3])

    cancelled = true
    const status = await runQueue({
      items: [1],
      control: {
        isPaused: () => false,
        isCancelled: () => cancelled,
      },
      shouldRun: () => true,
      work: async () => {
        throw new Error('не должно запуститься')
      },
    })
    expect(status).toBe('cancelled')
  })
})

describe('copyJpegMetadata', () => {
  it('переносит EXIF и ICC из исходного JPEG в новый', () => {
    const source = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, 0xff, 0xd9,
    ])
    const rendered = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02,
      0x00, 0xff, 0xd9,
    ])
    const merged = copyJpegMetadata(source, rendered)

    expect([...merged.slice(0, 10)]).toEqual([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66,
    ])
    expect(merged.includes(0xda)).toBe(true)
  })
})
