import { describe, expect, it } from 'vitest'
import { createHistory, historyPush } from './history'
import { defaultRecipe } from './recipe'
import {
  buildProjectRecord,
  createMemoryRepository,
  fileFromStored,
  matchSourceFiles,
  packProject,
  REFERENCE_FILE_ID,
  unpackProject,
} from './projectStore'

function jpeg(name: string, bytes: number[]) {
  return new File([Uint8Array.from(bytes)], name, {
    type: 'image/jpeg',
    lastModified: 1_700_000_000_000,
  })
}

describe('локальный проект', () => {
  it('сохраняет рецепт и оригиналы, а после квоты оставляет только рецепт', async () => {
    const recipe = defaultRecipe()
    recipe.adjustments.exposure = 0.4
    const history = historyPush(createHistory(defaultRecipe()), recipe)
    const portrait = jpeg('portrait.jpg', [1, 2, 3, 4, 5])
    const record = buildProjectRecord({
      photos: [{ id: 'photo-1', file: portrait }],
      recipes: { 'photo-1': history },
      selectedId: 'photo-1',
      reference: jpeg('reference.jpg', [9, 9]),
      strength: 72,
      adjustments: {
        exposure: 0,
        contrast: 0,
        saturation: 0,
        warmth: 0,
        skinSmoothing: 18,
      },
      exportFormat: 'jpeg',
      jpegQuality: 0.92,
      exportMaxEdge: 0,
      presets: [],
    })

    const repository = createMemoryRepository()
    await repository.save(record)
    const loaded = await repository.load()
    expect(loaded?.session.recipes['photo-1'].present.adjustments.exposure).toBe(0.4)
    expect(loaded?.session.selectedId).toBe('photo-1')
    expect(loaded?.files['photo-1']?.size).toBe(5)
    expect(loaded?.files[REFERENCE_FILE_ID]?.size).toBe(2)
    const restored = fileFromStored(loaded!.session.photos[0], loaded?.files['photo-1'])
    expect(restored?.name).toBe('portrait.jpg')
    expect(new Uint8Array(await restored!.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3, 4, 5]))

    const limited = createMemoryRepository({ rejectBlobs: true })
    const result = await limited.save(record)
    expect(result.filesStored).toBe(false)
    expect(result.warning).toContain('привязать')
    const withoutFiles = await limited.load()
    expect(withoutFiles?.session.filesStored).toBe(false)
    expect(withoutFiles?.files['photo-1']).toBeUndefined()
    expect(withoutFiles?.session.photos[0].name).toBe('portrait.jpg')
    expect(withoutFiles?.session.photos[0].size).toBe(5)
    expect(withoutFiles?.session.recipes['photo-1'].present.adjustments.exposure).toBe(0.4)
  })

  it('упаковывает проект в архив и собирает его обратно', async () => {
    const portrait = jpeg('portrait.jpg', [7, 8, 9])
    const record = buildProjectRecord({
      photos: [{ id: 'photo-1', file: portrait }],
      recipes: { 'photo-1': createHistory(defaultRecipe()) },
      strength: 40,
      adjustments: {
        exposure: 1,
        contrast: 0,
        saturation: 0,
        warmth: 0,
        skinSmoothing: 0,
      },
      exportFormat: 'png',
      jpegQuality: 0.8,
      exportMaxEdge: 1600,
      presets: [],
    })
    const archive = await packProject(record)
    const unpacked = await unpackProject(archive)
    expect(unpacked.session.exportFormat).toBe('png')
    expect(unpacked.session.exportMaxEdge).toBe(1600)
    expect(unpacked.session.adjustments.exposure).toBe(1)
    expect(new Uint8Array(await unpacked.files['photo-1'].arrayBuffer())).toEqual(
      Uint8Array.from([7, 8, 9]),
    )
  })

  it('привязывает файлы по имени и размеру и не путает одинаковые имена', () => {
    const small = jpeg('portrait.jpg', [1])
    const large = jpeg('portrait.jpg', [1, 2, 3])
    const other = jpeg('other.jpg', [4])
    const result = matchSourceFiles(
      [
        { id: 'a', name: 'portrait.jpg', size: 3 },
        { id: 'b', name: 'portrait.jpg', size: 1 },
        { id: 'c', name: 'missing.jpg', size: 9 },
      ],
      [other, small, large],
    )
    expect(result.matched.a).toBe(large)
    expect(result.matched.b).toBe(small)
    expect(result.missing).toEqual(['missing.jpg'])
  })
})
