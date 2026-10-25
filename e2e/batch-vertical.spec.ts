import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { readJpegOrientation } from '../src/lib/jpegMetadata'

const fixture = (name: string) =>
  join(import.meta.dirname, 'fixtures', 'generated', name)

async function waitForHydration(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByText('Открываю сохранённый проект')).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('pixmuse-project')
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  })
  await page.reload()
  await expect(page.getByText('Открываю сохранённый проект')).toBeHidden()
})

test('обрабатывает JPEG и прозрачный PNG, затем собирает ZIP', async ({
  page,
}) => {
  await page.getByTestId('reference-input').setInputFiles(fixture('reference-warm.jpg'))
  await page
    .getByTestId('batch-photo-input')
    .setInputFiles([fixture('series-cool.jpg'), fixture('alpha-cutout.png')])

  await page.getByRole('button', { name: 'Ретушь' }).click()
  await page.locator('#exposure').evaluate((element: HTMLInputElement) => {
    element.value = '1'
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await page.getByRole('button', { name: 'Обработать серию' }).click()

  await expect(page.getByText('Готово')).toHaveCount(2, { timeout: 120_000 })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Скачать готовые \(2\)/ }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).not.toBeNull()

  const zip = await JSZip.loadAsync(await readFile(path!))
  const first = zip.file('series-cool-pixmuse.png')
  const png = zip.file('alpha-cutout-pixmuse.png')
  expect(first).not.toBeNull()
  expect(png).not.toBeNull()
  const pngBytes = await png!.async('uint8array')
  expect(Array.from(pngBytes.slice(0, 8))).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])
  expect((await sharp(pngBytes).metadata()).hasAlpha).toBe(true)
  await page.getByRole('button', { name: 'Освободить результаты из памяти' }).click()
  await expect(page.getByRole('button', { name: /Скачать готовые \(0\)/ })).toBeDisabled()
})

test('нормализует EXIF Orientation при JPEG-экспорте', async ({ page }) => {
  await page.getByTestId('batch-photo-input').setInputFiles(fixture('oriented-6.jpg'))
  await page.getByRole('button', { name: 'Обработать серию' }).click()
  await expect(page.getByText('Готово')).toBeVisible({ timeout: 120_000 })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Скачать готовые \(1\)/ }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).not.toBeNull()
  const zip = await JSZip.loadAsync(await readFile(path!))
  const output = await zip.file('oriented-6-pixmuse.jpg')!.async('uint8array')
  expect(readJpegOrientation(output)).toBe(1)
})

test('восстанавливает сохранённую серию после перезагрузки', async ({ page }) => {
  await waitForHydration(page)
  await page.getByTestId('batch-photo-input').setInputFiles(fixture('series-cool.jpg'))
  await expect(page.getByText('series-cool.jpg').first()).toBeVisible()
  await expect(page.locator('.project-note')).toContainText('Сохранено', {
    timeout: 10_000,
  })

  await page.reload()
  await expect(page.getByText('Открываю сохранённый проект')).toBeHidden()
  await expect(page.getByText('series-cool.jpg').first()).toBeVisible()
})

test('обрабатывает настоящий JPEG 24 МП с экспортом 1280 px', async ({
  page,
}) => {
  test.slow()
  await page
    .getByTestId('batch-photo-input')
    .setInputFiles(fixture('stress-6000x4000.jpg'))
  await page.locator('#export-edge').selectOption('1280')
  await page.getByRole('button', { name: 'Обработать серию' }).click()
  await expect(page.getByText('Готово')).toBeVisible({ timeout: 180_000 })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Скачать готовые \(1\)/ }).click()
  const path = await (await downloadPromise).path()
  expect(path).not.toBeNull()
  const zip = await JSZip.loadAsync(await readFile(path!))
  const bytes = await zip.file('stress-6000x4000-pixmuse.jpg')!.async('uint8array')
  const metadata = await sharp(bytes).metadata()
  expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(1280)
})

test('создаёт и переключает независимые локальные проекты', async ({ page }) => {
  await page.getByTestId('batch-photo-input').setInputFiles(fixture('series-cool.jpg'))
  await expect(page.getByText('series-cool.jpg').first()).toBeVisible()
  await expect(page.locator('.project-note')).toContainText('Сохранено')

  page.once('dialog', (dialog) => dialog.accept('Вторая съёмка'))
  await page.getByRole('button', { name: 'Новый' }).click()
  await expect(page.getByLabel('Текущий проект')).toHaveValue(/.+/)
  await expect(page.getByText('series-cool.jpg')).toHaveCount(0)
  await page.getByTestId('batch-photo-input').setInputFiles(fixture('alpha-cutout.png'))
  await expect(page.getByText('alpha-cutout.png').first()).toBeVisible()

  await page.getByLabel('Текущий проект').selectOption({ label: 'Моя съёмка' })
  await expect(page.getByText('series-cool.jpg').first()).toBeVisible()
  await expect(page.getByText('alpha-cutout.png')).toHaveCount(0)

  await page.reload()
  await expect(page.getByText('Открываю сохранённый проект')).toBeHidden()
  await expect(page.getByText('series-cool.jpg').first()).toBeVisible()
})
