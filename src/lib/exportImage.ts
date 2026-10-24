import { copyJpegMetadata } from './jpegMetadata'
import type { EditRecipe } from './recipe'
import { renderRecipe, type Raster } from './renderRecipe'

export async function decodePreview(
  file: Blob,
  maxEdge = 1280,
): Promise<Raster> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    throw new Error('Браузер не поддерживает Canvas 2D')
  }
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const image = context.getImageData(0, 0, width, height)
  return {
    pixels: new Uint8ClampedArray(image.data),
    width,
    height,
  }
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось создать файл'))),
      type,
      quality,
    )
  })
}

export async function attachJpegMetadata(
  source: Blob,
  rendered: Blob,
): Promise<Blob> {
  if (!/jpe?g/i.test(source.type) || rendered.type !== 'image/jpeg') return rendered
  const [sourceBytes, renderedBytes] = await Promise.all([
    source.arrayBuffer(),
    rendered.arrayBuffer(),
  ])
  const merged = copyJpegMetadata(
    new Uint8Array(sourceBytes),
    new Uint8Array(renderedBytes),
  )
  const bytes = new ArrayBuffer(merged.byteLength)
  new Uint8Array(bytes).set(merged)
  return new Blob([bytes], { type: 'image/jpeg' })
}

export async function renderFileToBlob(
  file: Blob,
  recipe: EditRecipe,
  format: 'jpeg' | 'png',
  quality = 0.92,
): Promise<Blob> {
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
  bitmap.close()
  const source = context.getImageData(0, 0, canvas.width, canvas.height)
  const rendered = renderRecipe(source.data, canvas.width, canvas.height, recipe)
  const output = document.createElement('canvas')
  output.width = rendered.width
  output.height = rendered.height
  const outputContext = output.getContext('2d')
  if (!outputContext) throw new Error('Браузер не поддерживает Canvas 2D')
  const image = outputContext.createImageData(rendered.width, rendered.height)
  image.data.set(rendered.pixels)
  outputContext.putImageData(image, 0, 0)
  const blob = await canvasBlob(
    output,
    format === 'png' ? 'image/png' : 'image/jpeg',
    quality,
  )
  return format === 'jpeg' ? attachJpegMetadata(file, blob) : blob
}

export function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
