import JSZip from 'jszip'
import type { History } from './history'
import type { EditRecipe, ProcessingPreset } from './recipe'
import type { RetouchAdjustments } from './colorTransfer'

export const PROJECT_VERSION = 1
export const REFERENCE_FILE_ID = 'reference'

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
  ): Promise<{ filesStored: boolean; warning?: string }>
  load(): Promise<ProjectRecord | null>
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
        return { filesStored: record.session.filesStored }
      }
      if (options?.rejectBlobs && includeFiles && Object.keys(record.files).length > 0) {
        stored = {
          session: { ...record.session, filesStored: false },
          files: {},
        }
        return { filesStored: false, warning: QUOTA_WARNING }
      }
      stored = {
        session: { ...record.session, filesStored: true },
        files: { ...record.files },
      }
      return { filesStored: true }
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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pixmuse-project', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session')
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files')
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

async function writeSession(db: IDBDatabase, session: SavedSession): Promise<void> {
  const transaction = db.transaction('session', 'readwrite')
  transaction.objectStore('session').put(session, 'current')
  await transactionDone(transaction)
}

async function replaceFiles(
  db: IDBDatabase,
  files: Record<string, Blob>,
): Promise<void> {
  const transaction = db.transaction('files', 'readwrite')
  const store = transaction.objectStore('files')
  store.clear()
  for (const [id, blob] of Object.entries(files)) store.put(blob, id)
  await transactionDone(transaction)
}

async function clearFiles(db: IDBDatabase): Promise<void> {
  const transaction = db.transaction('files', 'readwrite')
  transaction.objectStore('files').clear()
  await transactionDone(transaction)
}

async function readSession(db: IDBDatabase): Promise<SavedSession | undefined> {
  const transaction = db.transaction('session', 'readonly')
  const done = transactionDone(transaction)
  const request = transaction.objectStore('session').get('current')
  const value = await new Promise<SavedSession | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as SavedSession | undefined)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
  await done
  return value
}

async function readFiles(db: IDBDatabase): Promise<Record<string, Blob>> {
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
      if (typeof cursor.key === 'string' && cursor.value) {
        files[cursor.key] = cursor.value as Blob
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
  await done
  return files
}

export function createIndexedDbRepository(): ProjectRepository {
  return {
    async save(record, options) {
      const db = await openDatabase()
      const includeFiles = options?.includeFiles !== false
      try {
        if (!includeFiles) {
          await writeSession(db, record.session)
          return { filesStored: record.session.filesStored }
        }
        await replaceFiles(db, record.files)
        const session = { ...record.session, filesStored: true }
        await writeSession(db, session)
        return { filesStored: true }
      } catch (error) {
        if (!isQuotaError(error)) throw error
        await clearFiles(db)
        await writeSession(db, { ...record.session, filesStored: false })
        return { filesStored: false, warning: QUOTA_WARNING }
      } finally {
        db.close()
      }
    },
    async load() {
      const db = await openDatabase()
      try {
        const session = await readSession(db)
        if (!session) return null
        const files = session.filesStored ? await readFiles(db) : {}
        return { session, files }
      } finally {
        db.close()
      }
    },
  }
}
