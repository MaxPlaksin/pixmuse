import JSZip from 'jszip'
import type { History } from './history'
import type { EditRecipe, ProcessingPreset } from './recipe'
import type { RetouchAdjustments } from './colorTransfer'

export const PROJECT_VERSION = 1
export const REFERENCE_FILE_ID = 'reference'
export const DEFAULT_PROJECT_ID = 'default'

export interface SavedPhoto {
  id: string
  name: string
  type: string
  size: number
  lastModified: number
  status: 'waiting'
}

export interface SavedReference {
  id: string
  name: string
  type: string
  size: number
  lastModified: number
}

export interface SavedSession {
  version: typeof PROJECT_VERSION
  name: string
  savedAt: string
  photos: SavedPhoto[]
  recipes: Record<string, History<EditRecipe>>
  selectedId?: string
  reference?: SavedReference
  strength: number
  adjustments: RetouchAdjustments
  exportFormat: 'jpeg' | 'png'
  jpegQuality: number
  exportMaxEdge: number
  filesStored: boolean
  presets: ProcessingPreset[]
}

export interface ProjectRecord {
  session: SavedSession
  files: Record<string, Blob>
}

export interface ProjectSaveOptions {
  includeFiles?: boolean
}

export interface ProjectRepository {
  save(
    record: ProjectRecord,
    options?: ProjectSaveOptions,
  ): Promise<{ saved: boolean; filesStored: boolean; warning?: string }>
  load(): Promise<ProjectRecord | null>
}

export interface ProjectSummary {
  id: string
  name: string
  savedAt: string
  filesStored: boolean
}

export interface ProjectLibraryRepository {
  list(): Promise<ProjectSummary[]>
  getActiveId(): Promise<string | null>
  setActiveId(id: string): Promise<void>
  create(name?: string): Promise<{ id: string; repository: ProjectRepository }>
  rename(id: string, name: string): Promise<void>
  delete(id: string): Promise<void>
  repository(id: string): ProjectRepository
}

export interface ProjectPhotoInput {
  id: string
  file: File
  missing?: boolean
  byteSize?: number
}

export interface ProjectInput {
  name?: string
  photos: ProjectPhotoInput[]
  recipes: Record<string, History<EditRecipe>>
  selectedId?: string
  reference?: File
  referenceMeta?: SavedReference
  strength: number
  adjustments: RetouchAdjustments
  exportFormat: 'jpeg' | 'png'
  jpegQuality: number
  exportMaxEdge: number
  presets: ProcessingPreset[]
}

const QUOTA_WARNING =
  'Не хватило места для оригиналов. Рецепты сохранены, файлы нужно привязать снова.'
const CHECKPOINT_WARNING =
  'Не хватило места. Последняя целостная версия проекта сохранена, текущие изменения остались только в открытой вкладке.'

export function buildProjectRecord(input: ProjectInput): ProjectRecord {
  const files: Record<string, Blob> = {}
  const photos: SavedPhoto[] = input.photos.map((photo) => {
    const size = photo.missing ? (photo.byteSize ?? photo.file.size) : photo.file.size
    if (!photo.missing && photo.file.size > 0) files[photo.id] = photo.file
    return {
      id: photo.id,
      name: photo.file.name,
      type: photo.file.type,
      size,
      lastModified: photo.file.lastModified,
      status: 'waiting',
    }
  })

  let reference = input.referenceMeta
  if (input.reference && input.reference.size > 0) {
    files[REFERENCE_FILE_ID] = input.reference
    reference = {
      id: REFERENCE_FILE_ID,
      name: input.reference.name,
      type: input.reference.type,
      size: input.reference.size,
      lastModified: input.reference.lastModified,
    }
  }

  return {
    session: {
      version: PROJECT_VERSION,
      name: input.name ?? 'Pixmuse',
      savedAt: new Date().toISOString(),
      photos,
      recipes: input.recipes,
      selectedId: input.selectedId,
      reference,
      strength: input.strength,
      adjustments: input.adjustments,
      exportFormat: input.exportFormat,
      jpegQuality: input.jpegQuality,
      exportMaxEdge: input.exportMaxEdge,
      filesStored: true,
      presets: input.presets,
    },
    files,
  }
}

export function fileFromStored(
  meta: { name: string; type: string; lastModified: number },
  blob: Blob | undefined,
): File | undefined {
  if (!blob || blob.size === 0) return undefined
  return new File([blob], meta.name, {
    type: meta.type || blob.type,
    lastModified: meta.lastModified,
  })
}

export function matchSourceFiles(
  expected: Array<{ id: string; name: string; size: number }>,
  files: File[],
): { matched: Record<string, File>; missing: string[] } {
  const pool = [...files]
  const matched: Record<string, File> = {}
  const missing: string[] = []
  for (const item of expected) {
    const index = pool.findIndex(
      (file) => file.name === item.name && file.size === item.size,
    )
    if (index === -1) {
      missing.push(item.name)
      continue
    }
    matched[item.id] = pool[index]
    pool.splice(index, 1)
  }
  return { matched, missing }
}

export async function packProject(record: ProjectRecord): Promise<Blob> {
  const zip = new JSZip()
  zip.file('project.json', JSON.stringify(record.session))
  for (const [id, blob] of Object.entries(record.files)) {
    zip.file(`files/${id}`, blob)
  }
  return zip.generateAsync({ type: 'blob', streamFiles: true })
}

export async function unpackProject(source: Blob): Promise<ProjectRecord> {
  const zip = await JSZip.loadAsync(source)
  const manifest = zip.file('project.json')
  if (!manifest) throw new Error('В архиве нет описания проекта')
  const session = JSON.parse(await manifest.async('string')) as SavedSession
  if (session.version !== PROJECT_VERSION || !Array.isArray(session.photos)) {
    throw new Error('Этот файл проекта не поддерживается')
  }
  const files: Record<string, Blob> = {}
  const folder = zip.folder('files')
  if (folder) {
    const reads: Array<Promise<void>> = []
    folder.forEach((relativePath, entry) => {
      if (entry.dir) return
      reads.push(
        entry.async('blob').then((blob) => {
          files[relativePath] = blob
        }),
      )
    })
    await Promise.all(reads)
  }
  return { session, files }
}

export function createMemoryRepository(options?: {
  rejectBlobs?: boolean
}): ProjectRepository {
  let stored: ProjectRecord | null = null
  return {
    async save(record, saveOptions) {
      const includeFiles = saveOptions?.includeFiles !== false
      if (!includeFiles && stored) {
        stored = { ...stored, session: record.session }
        return { saved: true, filesStored: record.session.filesStored }
      }
      if (options?.rejectBlobs && includeFiles && Object.keys(record.files).length > 0) {
        if (stored?.session.filesStored) {
          return {
            saved: false,
            filesStored: stored.session.filesStored,
            warning: CHECKPOINT_WARNING,
          }
        }
        stored = {
          session: { ...record.session, filesStored: false },
          files: {},
        }
        return { saved: true, filesStored: false, warning: QUOTA_WARNING }
      }
      stored = {
        session: { ...record.session, filesStored: true },
        files: { ...record.files },
      }
      return { saved: true, filesStored: true }
    },
    async load() {
      if (!stored) return null
      return {
        session: stored.session,
        files: { ...stored.files },
      }
    },
  }
}

const DATABASE_VERSION = 2
const META_ACTIVE_PROJECT = 'activeProjectId'
const MIGRATED_PROJECT_ID = 'migrated-default'

function fileKey(projectId: string, id: string): string {
  return `${projectId}\u0000${id}`
}

function parseFileKey(projectId: string, key: IDBValidKey): string | undefined {
  if (typeof key !== 'string') return undefined
  const prefix = `${projectId}\u0000`
  return key.startsWith(prefix) ? key.slice(prefix.length) : undefined
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pixmuse-project', DATABASE_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session')
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')

      if (event.oldVersion < 2) {
        const transaction = request.transaction
        if (!transaction) return
        const sessions = transaction.objectStore('session')
        const files = transaction.objectStore('files')
        const meta = transaction.objectStore('meta')
        const legacyRequest = sessions.get('current')
        legacyRequest.onsuccess = () => {
          const legacy = legacyRequest.result as SavedSession | undefined
          if (!legacy) return
          sessions.put(legacy, MIGRATED_PROJECT_ID)
          sessions.delete('current')
          meta.put(MIGRATED_PROJECT_ID, META_ACTIVE_PROJECT)
          const cursorRequest = files.openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (!cursor) return
            if (
              typeof cursor.key === 'string' &&
              !cursor.key.includes('\u0000')
            ) {
              files.put(cursor.value, fileKey(MIGRATED_PROJECT_ID, cursor.key))
              cursor.delete()
            }
            cursor.continue()
          }
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB'))
  })
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  )
}

async function writeSession(
  db: IDBDatabase,
  projectId: string,
  session: SavedSession,
): Promise<void> {
  const transaction = db.transaction('session', 'readwrite')
  transaction.objectStore('session').put(session, projectId)
  await transactionDone(transaction)
}

async function writeProjectAtomically(
  db: IDBDatabase,
  projectId: string,
  session: SavedSession,
  files: Record<string, Blob>,
): Promise<void> {
  const transaction = db.transaction(['session', 'files'], 'readwrite')
  const fileStore = transaction.objectStore('files')
  const cursor = fileStore.openCursor()
  await new Promise<void>((resolve, reject) => {
    cursor.onsuccess = () => {
      const current = cursor.result
      if (!current) {
        resolve()
        return
      }
      if (parseFileKey(projectId, current.key) !== undefined) current.delete()
      current.continue()
    }
    cursor.onerror = () => reject(cursor.error ?? new Error('IndexedDB'))
  })
  for (const [id, blob] of Object.entries(files)) {
    fileStore.put(blob, fileKey(projectId, id))
  }
  transaction.objectStore('session').put(session, projectId)
  await transactionDone(transaction)
}

async function readSession(
  db: IDBDatabase,
  projectId: string,
): Promise<SavedSession | undefined> {
  const transaction = db.transaction('session', 'readonly')
  const done = transactionDone(transaction)
  const request = transaction.objectStore('session').get(projectId)
  const value = await new Promise<SavedSession | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as SavedSession | undefined)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
  await done
  return value
}

async function readFiles(
  db: IDBDatabase,
  projectId: string,
): Promise<Record<string, Blob>> {
  const transaction = db.transaction('files', 'readonly')
  const done = transactionDone(transaction)
  const request = transaction.objectStore('files').openCursor()
  const files: Record<string, Blob> = {}
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }
      const id = parseFileKey(projectId, cursor.key)
      if (id !== undefined && cursor.value) {
        files[id] = cursor.value as Blob
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
  await done
  return files
}

export function createIndexedDbRepository(
  projectId = DEFAULT_PROJECT_ID,
): ProjectRepository {
  let saveChain = Promise.resolve()

  async function saveRecord(
    record: ProjectRecord,
    options?: ProjectSaveOptions,
  ): Promise<{ saved: boolean; filesStored: boolean; warning?: string }> {
    const db = await openDatabase()
    const includeFiles = options?.includeFiles !== false
    try {
      if (!includeFiles) {
        await writeSession(db, projectId, record.session)
        return { saved: true, filesStored: record.session.filesStored }
      }

      const session = { ...record.session, filesStored: true }
      await writeProjectAtomically(db, projectId, session, record.files)
      return { saved: true, filesStored: true }
    } catch (error) {
      if (!isQuotaError(error)) throw error

      const previousSession = await readSession(db, projectId)
      if (previousSession?.filesStored) {
        return {
          saved: false,
          filesStored: previousSession.filesStored,
          warning: CHECKPOINT_WARNING,
        }
      }

      await writeSession(db, projectId, {
        ...record.session,
        filesStored: false,
      })
      return { saved: true, filesStored: false, warning: QUOTA_WARNING }
    } finally {
      db.close()
    }
  }

  return {
    save(record, options) {
      const operation = saveChain.then(() => saveRecord(record, options))
      saveChain = operation.then(
        () => undefined,
        () => undefined,
      )
      return operation
    },
    async load() {
      const db = await openDatabase()
      try {
        const session = await readSession(db, projectId)
        if (!session) return null
        const files = session.filesStored ? await readFiles(db, projectId) : {}
        const requiredIds = session.photos.map((photo) => photo.id)
        if (session.reference) requiredIds.push(REFERENCE_FILE_ID)
        const filesComplete =
          !session.filesStored ||
          requiredIds.every((id) => files[id] && files[id].size > 0)
        return {
          session: filesComplete
            ? session
            : { ...session, filesStored: false },
          files,
        }
      } finally {
        db.close()
      }
    },
  }
}

function emptyProject(name: string): ProjectRecord {
  return buildProjectRecord({
    name,
    photos: [],
    recipes: {},
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
}

export function createIndexedDbProjectLibrary(): ProjectLibraryRepository {
  return {
    repository(id) {
      return createIndexedDbRepository(id)
    },
    async list() {
      const db = await openDatabase()
      try {
        const transaction = db.transaction('session', 'readonly')
        const done = transactionDone(transaction)
        const request = transaction.objectStore('session').openCursor()
        const projects: ProjectSummary[] = []
        await new Promise<void>((resolve, reject) => {
          request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) {
              resolve()
              return
            }
            if (typeof cursor.key === 'string' && cursor.key !== 'current') {
              const session = cursor.value as SavedSession
              projects.push({
                id: cursor.key,
                name: session.name,
                savedAt: session.savedAt,
                filesStored: session.filesStored,
              })
            }
            cursor.continue()
          }
          request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
        })
        await done
        return projects.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      } finally {
        db.close()
      }
    },
    async getActiveId() {
      const db = await openDatabase()
      try {
        const transaction = db.transaction('meta', 'readonly')
        const done = transactionDone(transaction)
        const request = transaction.objectStore('meta').get(META_ACTIVE_PROJECT)
        const value = await new Promise<string | undefined>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result as string | undefined)
          request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
        })
        await done
        return value ?? null
      } finally {
        db.close()
      }
    },
    async setActiveId(id) {
      const db = await openDatabase()
      try {
        const transaction = db.transaction('meta', 'readwrite')
        transaction.objectStore('meta').put(id, META_ACTIVE_PROJECT)
        await transactionDone(transaction)
      } finally {
        db.close()
      }
    },
    async create(name = 'Новый проект') {
      const id = crypto.randomUUID()
      const repository = createIndexedDbRepository(id)
      await repository.save(emptyProject(name))
      await this.setActiveId(id)
      return { id, repository }
    },
    async rename(id, name) {
      const repository = createIndexedDbRepository(id)
      const record = await repository.load()
      if (!record) throw new Error('Проект не найден')
      await repository.save({
        ...record,
        session: { ...record.session, name, savedAt: new Date().toISOString() },
      }, { includeFiles: false })
    },
    async delete(id) {
      const db = await openDatabase()
      try {
        const transaction = db.transaction(
          ['session', 'files', 'meta'],
          'readwrite',
        )
        transaction.objectStore('session').delete(id)
        const files = transaction.objectStore('files')
        const cursor = files.openCursor()
        cursor.onsuccess = () => {
          const current = cursor.result
          if (!current) return
          if (parseFileKey(id, current.key) !== undefined) current.delete()
          current.continue()
        }
        const meta = transaction.objectStore('meta')
        const activeRequest = meta.get(META_ACTIVE_PROJECT)
        activeRequest.onsuccess = () => {
          if (activeRequest.result === id) meta.delete(META_ACTIVE_PROJECT)
        }
        await transactionDone(transaction)
      } finally {
        db.close()
      }
    },
  }
}
