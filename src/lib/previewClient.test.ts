import { afterEach, describe, expect, it } from 'vitest'
import { defaultRecipe } from './recipe'
import {
  disposePreviewWorker,
  renderPreview,
  StalePreview,
} from './previewClient'

class HangingWorker {
  static last?: HangingWorker
  terminated = false

  constructor() {
    HangingWorker.last = this
  }

  addEventListener() {}
  removeEventListener() {}
  postMessage() {}

  terminate() {
    this.terminated = true
  }
}

afterEach(() => {
  disposePreviewWorker()
  Reflect.deleteProperty(globalThis, 'Worker')
  HangingWorker.last = undefined
})

describe('ресурсы предпросмотра', () => {
  it('завершает Worker и отклоняет активную задачу при закрытии редактора', async () => {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: HangingWorker,
    })
    const active = renderPreview(
      new Uint8ClampedArray([20, 30, 40, 255]),
      1,
      1,
      defaultRecipe(),
    )
    const pending = renderPreview(
      new Uint8ClampedArray([50, 60, 70, 255]),
      1,
      1,
      defaultRecipe(),
    )
    const settled = Promise.allSettled([active, pending])

    disposePreviewWorker()

    const [activeResult, pendingResult] = await settled
    expect(activeResult.status).toBe('rejected')
    expect(pendingResult.status).toBe('rejected')
    if (activeResult.status === 'rejected') {
      expect(activeResult.reason).toBeInstanceOf(StalePreview)
    }
    if (pendingResult.status === 'rejected') {
      expect(pendingResult.reason).toBeInstanceOf(StalePreview)
    }
    expect(HangingWorker.last?.terminated).toBe(true)
  })
})
