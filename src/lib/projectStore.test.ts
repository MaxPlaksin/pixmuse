import { describe, expect, it } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { createHistory, historyPush } from './history'
import { defaultRecipe } from './recipe'
import {
  buildProjectRecord,
  createIndexedDbProjectLibrary,
  createIndexedDbRepository,
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

function projectRecord(name: string, bytes: number[]) {
  return buildProjectRecord({
    name,
    photos: [{ id: 'photo-1', file: jpeg('portrait.jpg', bytes) }],
    recipes: { 'photo-1': createHistory(defaultRecipe()) },
    strength: 40,
    adjustments: {
      exposure: 0,
      contrast: 0,
      saturation: 0,
      warmth: 0,
      skinSmoothing: 0,
    },
    exportFormat: 'jpeg',
    jpegQuality: 0.92,
    exportMaxEdge: 0,
    presets: [],
  })
}

async function deleteStoredFile(id: string): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pixmuse-project', 2)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = database.transaction('files', 'readwrite')
  transaction.objectStore('files').delete(`default\u0000${id}`)
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  database.close()
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
    expect(result.saved).toBe(true)
    expect(result.filesStored).toBe(false)
    expect(result.warning).toContain('привязать')
    const withoutFiles = await limited.load()
    expect(withoutFiles?.session.filesStored).toBe(false)
    expect(withoutFiles?.files['photo-1']).toBeUndefined()
    expect(withoutFiles?.session.photos[0].name).toBe('portrait.jpg')
    expect(withoutFiles?.session.photos[0].size).toBe(5)
    expect(withoutFiles?.session.recipes['photo-1'].present.adjustments.exposure).toBe(0.4)

    const changedWithoutFiles = {
      ...record,
      session: { ...record.session, name: 'Новый рецепт' },
    }
    const nextResult = await limited.save(changedWithoutFiles)
    expect(nextResult.saved).toBe(true)
    expect(nextResult.filesStored).toBe(false)
    expect((await limited.load())?.session.name).toBe('Новый рецепт')
  })

  it('сохраняет последний целостный checkpoint при неудачной записи файлов', async () => {
    const portrait = jpeg('portrait.jpg', [1, 2, 3])
    const record = buildProjectRecord({
      name: 'Сохранённая версия',
      photos: [{ id: 'photo-1', file: portrait }],
      recipes: { 'photo-1': createHistory(defaultRecipe()) },
      strength: 40,
      adjustments: {
        exposure: 0,
        contrast: 0,
        saturation: 0,
        warmth: 0,
        skinSmoothing: 0,
      },
      exportFormat: 'jpeg',
      jpegQuality: 0.92,
      exportMaxEdge: 0,
      presets: [],
    })
    const limits = { rejectBlobs: false }
    const repository = createMemoryRepository(limits)
    await repository.save(record)

    limits.rejectBlobs = true
    const changed = {
      session: { ...record.session, name: 'Несохранённая версия' },
      files: { 'photo-1': jpeg('portrait.jpg', [9, 9, 9, 9]) },
    }
    const failed = await repository.save(changed)

    expect(failed.saved).toBe(false)
    expect(failed.warning).toContain('Последняя целостная версия')
    const restored = await repository.load()
    expect(restored?.session.name).toBe('Сохранённая версия')
    expect(new Uint8Array(await restored!.files['photo-1'].arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3]),
    )
  })

  it('восстанавливает предыдущий IndexedDB checkpoint после прерванной транзакции', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    })
    const repository = createIndexedDbRepository()
    await repository.save(projectRecord('До сбоя', [1, 2, 3]))

    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ): IDBRequest<IDBValidKey> {
      if (
        this.name === 'session' &&
        typeof value === 'object' &&
        value !== null &&
        'name' in value &&
        value.name === 'Во время сбоя'
      ) {
        this.transaction.abort()
        throw new Error('Имитация неожиданного закрытия')
      }
      return key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key)
    }

    try {
      await expect(
        repository.save(projectRecord('Во время сбоя', [9, 9, 9, 9])),
      ).rejects.toThrow('Имитация неожиданного закрытия')
    } finally {
      IDBObjectStore.prototype.put = originalPut
    }

    const restored = await repository.load()
    expect(restored?.session.name).toBe('До сбоя')
    expect(new Uint8Array(await restored!.files['photo-1'].arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3]),
    )
  })

  it('обнаруживает неполный набор файлов при восстановлении IndexedDB', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    })
    const repository = createIndexedDbRepository()
    await repository.save(projectRecord('Проект', [1, 2, 3]))
    await deleteStoredFile('photo-1')

    const restored = await repository.load()

    expect(restored?.session.filesStored).toBe(false)
    expect(restored?.files['photo-1']).toBeUndefined()
  })

  it('изолирует несколько проектов и удаляет только выбранный', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    })
    const library = createIndexedDbProjectLibrary()
    const first = await library.create('Первая съёмка')
    await first.repository.save(projectRecord('Первая съёмка', [1, 2, 3]))
    const second = await library.create('Вторая съёмка')
    await second.repository.save(projectRecord('Вторая съёмка', [7, 8]))

    expect((await library.list()).map((project) => project.name).sort()).toEqual([
      'Вторая съёмка',
      'Первая съёмка',
    ])
    expect((await first.repository.load())?.files['photo-1'].size).toBe(3)
    expect((await second.repository.load())?.files['photo-1'].size).toBe(2)

    await library.rename(first.id, 'Переименованная')
    expect((await first.repository.load())?.session.name).toBe('Переименованная')
    await library.delete(second.id)
    expect(await second.repository.load()).toBeNull()
    expect((await first.repository.load())?.files['photo-1'].size).toBe(3)
  })

  it('мигрирует legacy current и его файлы без потери данных', async () => {
    const legacyFactory = new IDBFactory()
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: legacyFactory,
    })
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pixmuse-project', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('session')
        request.result.createObjectStore('files')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = legacy.transaction(['session', 'files'], 'readwrite')
    transaction.objectStore('session').put(projectRecord('Старая съёмка', [4, 5]).session, 'current')
    transaction.objectStore('files').put(jpeg('portrait.jpg', [4, 5]), 'photo-1')
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    legacy.close()

    const library = createIndexedDbProjectLibrary()
    const projects = await library.list()
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('Старая съёмка')
    expect(await library.getActiveId()).toBe(projects[0].id)
    const restored = await library.repository(projects[0].id).load()
    expect(new Uint8Array(await restored!.files['photo-1'].arrayBuffer())).toEqual(
      Uint8Array.from([4, 5]),
    )
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
