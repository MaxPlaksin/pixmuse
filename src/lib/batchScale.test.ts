import { describe, expect, it } from 'vitest'
import { runQueue } from './batchQueue'
import { defaultRecipe } from './recipe'
import { renderRecipe } from './renderRecipe'

interface RuntimeMemory {
  heapUsed: number
  rss: number
}

function memoryUsage(): RuntimeMemory {
  const runtime = globalThis as {
    process?: { memoryUsage?: () => RuntimeMemory }
  }
  return runtime.process?.memoryUsage?.() ?? { heapUsed: 0, rss: 0 }
}

function frame(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 180
    pixels[index + 1] = 140
    pixels[index + 2] = 120
    pixels[index + 3] = 255
  }
  return pixels
}

async function measure(count: number, width: number, height: number) {
  const before = memoryUsage()
  let peak = before.heapUsed
  let errors = 0
  const started = performance.now()
  const status = await runQueue({
    items: Array.from({ length: count }, (_, index) => index),
    control: { isPaused: () => false, isCancelled: () => false },
    shouldRun: () => true,
    wait: () => Promise.resolve(),
    work: async () => {
      try {
        const source = frame(width, height)
        const rendered = renderRecipe(source, width, height, defaultRecipe())
        if (rendered.width !== width || rendered.pixels.length === 0) {
          throw new Error('пустой результат')
        }
      } catch {
        errors += 1
      }
      peak = Math.max(peak, memoryUsage().heapUsed)
    },
  })
  const elapsed = performance.now() - started
  const after = memoryUsage()
  const report = {
    count,
    width,
    height,
    status,
    errors,
    elapsedMs: Math.round(elapsed),
    heapBeforeMb: Number((before.heapUsed / 1024 / 1024).toFixed(1)),
    heapAfterMb: Number((after.heapUsed / 1024 / 1024).toFixed(1)),
    heapPeakMb: Number((peak / 1024 / 1024).toFixed(1)),
    rssAfterMb: Number((after.rss / 1024 / 1024).toFixed(1)),
  }
  console.info(`batch-scale ${JSON.stringify(report)}`)
  expect(status).toBe('done')
  expect(errors).toBe(0)
  return report
}

describe('очередь на серии кадров', () => {
  it('обрабатывает 20, 100 и 500 фотографий 320×240', async () => {
    const reports = []
    for (const count of [20, 100, 500]) {
      reports.push(await measure(count, 320, 240))
    }
    expect(reports.map((report) => report.errors)).toEqual([0, 0, 0])
  }, 120_000)
})
