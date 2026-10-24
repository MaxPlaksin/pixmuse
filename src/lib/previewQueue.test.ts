import { describe, expect, it } from 'vitest'
import { createPreviewQueue, StalePreview } from './previewQueue'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('очередь предпросмотра', () => {
  it('пропускает устаревший запрос и считает только один кадр одновременно', async () => {
    const queue = createPreviewQueue<number>()
    const started: number[] = []
    const first = queue.submit(async () => {
      started.push(1)
      await delay(40)
      return 1
    })
    const firstSettled = first.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    const second = queue.submit(async () => {
      started.push(2)
      return 2
    })
    const secondSettled = second.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    const third = queue.submit(async () => {
      started.push(3)
      return 3
    })

    const [firstResult, secondResult] = await Promise.all([firstSettled, secondSettled])
    expect(firstResult.ok).toBe(false)
    expect(secondResult.ok).toBe(false)
    if (!firstResult.ok) expect(firstResult.error).toBeInstanceOf(StalePreview)
    if (!secondResult.ok) expect(secondResult.error).toBeInstanceOf(StalePreview)
    await expect(third).resolves.toBe(3)
    expect(started).toEqual([1, 3])
  })
})
