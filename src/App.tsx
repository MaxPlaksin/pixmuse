import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowCounterClockwise,
  Check,
  DownloadSimple,
  Images,
  MagicWand,
  Palette,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  Trash,
  UploadSimple,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import JSZip from 'jszip'
import { runQueue } from './lib/batchQueue'
import {
  processPhoto,
  readColorStats,
  type ColorStats,
  type RetouchAdjustments,
} from './lib/colorTransfer'
import { downloadBlob } from './lib/exportImage'
import { createHistory, historyPush, type History } from './lib/history'
import {
  buildProjectRecord,
  createIndexedDbRepository,
  fileFromStored,
  matchSourceFiles,
  packProject,
  REFERENCE_FILE_ID,
  unpackProject,
  type ProjectRecord,
  type ProjectRepository,
  type SavedReference,
} from './lib/projectStore'
import {
  applyPreset,
  defaultRecipe,
  readPresets,
  recipeIsIdentity,
  writePresets,
  type EditRecipe,
  type ProcessingPreset,
} from './lib/recipe'
import { PhotoEditor } from './studio/PhotoEditor'

type PhotoStatus = 'waiting' | 'processing' | 'done' | 'error'

interface PhotoItem {
  id: string
  file: File
  sourceUrl: string
  resultUrl?: string
  result?: Blob
  status: PhotoStatus
  missing?: boolean
  byteSize?: number
}

const missingPreview =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function revokeUrl(url?: string) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

const acceptedTypes = new Set(['image/jpeg', 'image/png'])
const colorPresets = ['#d96b98', '#9d7ad6', '#ef8b73', '#6f9f8d', '#557fc2']
const backgroundPresets = [
  '#f8f3f7',
  '#f7f2ec',
  '#eef4f2',
  '#f0f2f8',
  '#f6eff8',
]
const panelPresets = [
  '#fffafd',
  '#fff5f9',
  '#f8f4ff',
  '#f3f8f6',
  '#f4f7fc',
]
const fontOptions = [
  {
    id: 'system',
    name: 'Системный',
    value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  {
    id: 'avenir',
    name: 'Avenir',
    value: "'Avenir Next', Avenir, sans-serif",
  },
  {
    id: 'helvetica',
    name: 'Helvetica Neue',
    value: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  {
    id: 'arial',
    name: 'Arial',
    value: "Arial, Helvetica, sans-serif",
  },
  {
    id: 'trebuchet',
    name: 'Trebuchet',
    value: "'Trebuchet MS', sans-serif",
  },
  {
    id: 'verdana',
    name: 'Verdana',
    value: "Verdana, Geneva, sans-serif",
  },
  {
    id: 'tahoma',
    name: 'Tahoma',
    value: "Tahoma, Geneva, sans-serif",
  },
  {
    id: 'gill-sans',
    name: 'Gill Sans',
    value: "'Gill Sans', 'Gill Sans MT', sans-serif",
  },
  {
    id: 'optima',
    name: 'Optima',
    value: "Optima, Candara, sans-serif",
  },
  {
    id: 'futura',
    name: 'Futura',
    value: "Futura, 'Trebuchet MS', sans-serif",
  },
  {
    id: 'georgia',
    name: 'Georgia',
    value: "Georgia, 'Times New Roman', serif",
  },
  {
    id: 'palatino',
    name: 'Palatino',
    value: "Palatino, 'Palatino Linotype', serif",
  },
  {
    id: 'baskerville',
    name: 'Baskerville',
    value: "Baskerville, Georgia, serif",
  },
  {
    id: 'times',
    name: 'Times New Roman',
    value: "'Times New Roman', Times, serif",
  },
  {
    id: 'didot',
    name: 'Didot',
    value: "Didot, 'Bodoni 72', serif",
  },
  {
    id: 'copperplate',
    name: 'Copperplate',
    value: "Copperplate, 'Copperplate Gothic Light', fantasy",
  },
  {
    id: 'marker',
    name: 'Marker Felt',
    value: "'Marker Felt', 'Comic Sans MS', cursive",
  },
  {
    id: 'brush',
    name: 'Brush Script',
    value: "'Brush Script MT', 'Segoe Script', cursive",
  },
  {
    id: 'mono',
    name: 'SF Mono',
    value: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  },
  {
    id: 'courier',
    name: 'Courier New',
    value: "'Courier New', Courier, monospace",
  },
]

function makePhoto(file: File): PhotoItem {
  return {
    id: crypto.randomUUID(),
    file,
    sourceUrl: URL.createObjectURL(file),
    status: 'waiting',
  }
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function ToolSlider({
  id,
  label,
  value,
  min,
  max,
  suffix = '',
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="setting tool-setting">
      <div className="setting-label">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>
          {value > 0 ? '+' : ''}
          {value}
          {suffix}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export function App() {
  const [reference, setReference] = useState<File>()
  const [referenceUrl, setReferenceUrl] = useState<string>()
  const [referenceStats, setReferenceStats] = useState<ColorStats>()
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [strength, setStrength] = useState(72)
  const [comparison, setComparison] = useState(50)
  const [isRunning, setIsRunning] = useState(false)
  const [message, setMessage] = useState<string>()
  const [activePanel, setActivePanel] = useState<'style' | 'retouch'>('style')
  const [profileOpen, setProfileOpen] = useState(false)
  const [accent, setAccent] = useState(
    () => localStorage.getItem('pixmuse-accent') ?? colorPresets[0],
  )
  const [background, setBackground] = useState(
    () => localStorage.getItem('pixmuse-background') ?? backgroundPresets[0],
  )
  const [panelBackground, setPanelBackground] = useState(
    () => localStorage.getItem('pixmuse-panel') ?? panelPresets[0],
  )
  const [fontId, setFontId] = useState(
    () => localStorage.getItem('pixmuse-font') ?? fontOptions[0].id,
  )
  const [adjustments, setAdjustments] = useState<RetouchAdjustments>({
    exposure: 0,
    contrast: 0,
    saturation: 0,
    warmth: 0,
    skinSmoothing: 18,
  })
  const [mode, setMode] = useState<'batch' | 'editor'>('batch')
  const [recipes, setRecipes] = useState<Record<string, History<EditRecipe>>>({})
  const [presets, setPresets] = useState<ProcessingPreset[]>(() =>
    readPresets(localStorage),
  )
  const [presetId, setPresetId] = useState('')
  const [exportFormat, setExportFormat] = useState<'jpeg' | 'png'>('jpeg')
  const [jpegQuality, setJpegQuality] = useState(0.92)
  const [exportMaxEdge, setExportMaxEdge] = useState(0)
  const [hydrated, setHydrated] = useState(false)
  const [persistReady, setPersistReady] = useState(false)
  const [projectNote, setProjectNote] = useState<string>()
  const [referenceMissing, setReferenceMissing] = useState<SavedReference>()
  const [batchPaused, setBatchPaused] = useState(false)
  const batchControl = useRef({ paused: false, cancelled: false })
  const recipesRef = useRef(recipes)
  const photoInput = useRef<HTMLInputElement>(null)
  const referenceInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const relinkInput = useRef<HTMLInputElement>(null)
  const repositoryRef = useRef<ProjectRepository | null>(null)
  const filesStoredRef = useRef(true)
  const filesKeyRef = useRef<string | null>(null)
  const photosRef = useRef<PhotoItem[]>([])
  const referenceUrlRef = useRef<string | undefined>(undefined)

  const selected = useMemo(
    () => photos.find((photo) => photo.id === selectedId) ?? photos[0],
    [photos, selectedId],
  )
  const completedCount = photos.filter((photo) => photo.status === 'done').length

  photosRef.current = photos
  referenceUrlRef.current = referenceUrl
  recipesRef.current = recipes

  useEffect(() => {
    return () => {
      revokeUrl(referenceUrlRef.current)
      photosRef.current.forEach((photo) => {
        revokeUrl(photo.sourceUrl)
        revokeUrl(photo.resultUrl)
      })
    }
  }, [])

  useEffect(() => {
    const hex = accent.replace('#', '')
    const red = Number.parseInt(hex.slice(0, 2), 16)
    const green = Number.parseInt(hex.slice(2, 4), 16)
    const blue = Number.parseInt(hex.slice(4, 6), 16)
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000
    document.documentElement.style.setProperty('--accent', accent)
    document.documentElement.style.setProperty(
      '--accent-ink',
      luminance > 145 ? '#3a1725' : '#fff9fc',
    )
    localStorage.setItem('pixmuse-accent', accent)
  }, [accent])

  useEffect(() => {
    const hex = background.replace('#', '')
    const red = Number.parseInt(hex.slice(0, 2), 16)
    const green = Number.parseInt(hex.slice(2, 4), 16)
    const blue = Number.parseInt(hex.slice(4, 6), 16)
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000
    document.documentElement.style.setProperty('--app-background', background)
    document.documentElement.style.setProperty(
      '--workspace-text',
      luminance > 145 ? '#442d38' : '#fff9fc',
    )
    localStorage.setItem('pixmuse-background', background)
  }, [background])

  useEffect(() => {
    const hex = panelBackground.replace('#', '')
    const red = Number.parseInt(hex.slice(0, 2), 16)
    const green = Number.parseInt(hex.slice(2, 4), 16)
    const blue = Number.parseInt(hex.slice(4, 6), 16)
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000
    const isLight = luminance > 145
    document.documentElement.style.setProperty(
      '--panel-background',
      panelBackground,
    )
    document.documentElement.style.setProperty(
      '--panel-text',
      isLight ? '#442d38' : '#fff9fc',
    )
    document.documentElement.style.setProperty(
      '--panel-muted',
      isLight ? '#8b7180' : '#dacbd3',
    )
    localStorage.setItem('pixmuse-panel', panelBackground)
  }, [panelBackground])

  useEffect(() => {
    const selectedFont =
      fontOptions.find((option) => option.id === fontId) ?? fontOptions[0]
    document.documentElement.style.setProperty('--app-font', selectedFont.value)
    localStorage.setItem('pixmuse-font', selectedFont.id)
  }, [fontId])

  function currentRecord(): ProjectRecord {
    return buildProjectRecord({
      photos: photosRef.current.map((photo) => ({
        id: photo.id,
        file: photo.file,
        missing: photo.missing,
        byteSize: photo.byteSize,
      })),
      recipes: recipesRef.current,
      selectedId,
      reference,
      referenceMeta: reference ? undefined : referenceMissing,
      strength,
      adjustments,
      exportFormat,
      jpegQuality,
      exportMaxEdge,
      presets,
    })
  }

  function adoptRecord(record: ProjectRecord) {
    photosRef.current.forEach((photo) => {
      revokeUrl(photo.sourceUrl)
      revokeUrl(photo.resultUrl)
    })
    revokeUrl(referenceUrlRef.current)

    const nextPhotos: PhotoItem[] = record.session.photos.map((meta) => {
      const file = fileFromStored(meta, record.files[meta.id])
      const missing = !file
      const usable =
        file ??
        new File([], meta.name, { type: meta.type, lastModified: meta.lastModified })
      return {
        id: meta.id,
        file: usable,
        sourceUrl: missing ? missingPreview : URL.createObjectURL(usable),
        status: 'waiting',
        missing,
        byteSize: meta.size,
      }
    })
    const nextRecipes = { ...record.session.recipes }
    nextPhotos.forEach((photo) => {
      nextRecipes[photo.id] ??= createHistory(defaultRecipe())
    })
    setPhotos(nextPhotos)
    setRecipes(nextRecipes)
    setSelectedId(
      record.session.selectedId &&
        nextPhotos.some((photo) => photo.id === record.session.selectedId)
        ? record.session.selectedId
        : nextPhotos[0]?.id,
    )
    setStrength(record.session.strength)
    setAdjustments(record.session.adjustments)
    setExportFormat(record.session.exportFormat)
    setJpegQuality(record.session.jpegQuality ?? 0.92)
    setExportMaxEdge(record.session.exportMaxEdge ?? 0)
    setPresets(record.session.presets ?? [])
    writePresets(localStorage, record.session.presets ?? [])

    const referenceFile = record.session.reference
      ? fileFromStored(record.session.reference, record.files[REFERENCE_FILE_ID])
      : undefined
    if (referenceFile) {
      setReference(referenceFile)
      setReferenceUrl(URL.createObjectURL(referenceFile))
      setReferenceMissing(undefined)
      readColorStats(referenceFile)
        .then(setReferenceStats)
        .catch(() => setReferenceStats(undefined))
    } else {
      setReference(undefined)
      setReferenceUrl(undefined)
      setReferenceStats(undefined)
      setReferenceMissing(record.session.reference)
    }
    const missingNames = nextPhotos.filter((photo) => photo.missing).map((photo) => photo.file.name)
    if (record.session.reference && !referenceFile) missingNames.push(record.session.reference.name)
    setProjectNote(
      missingNames.length > 0
        ? 'Рецепты восстановлены. Привяжите исходные файлы заново.'
        : 'Проект открыт с этого Mac',
    )
  }

  useEffect(() => {
    let cancelled = false
    const repository = createIndexedDbRepository()
    repositoryRef.current = repository
    repository
      .load()
      .then((record) => {
        if (cancelled) return
        if (record) adoptRecord(record)
        setPersistReady(true)
      })
      .catch(() => {
        if (!cancelled) setProjectNote('Локальный проект не открылся')
      })
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
    }
    // Загрузка один раз при старте. Повторный запуск затёр бы несохранённые правки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projectSourceKey = [
    photos
      .map(
        (photo) =>
          `${photo.id}:${photo.byteSize ?? photo.file.size}:${photo.missing ? 1 : 0}:${photo.file.name}`,
      )
      .join('|'),
    reference ? `${reference.name}:${reference.size}` : '',
    referenceMissing ? `${referenceMissing.name}:${referenceMissing.size}` : '',
  ].join('~')

  useEffect(() => {
    if (!hydrated || !persistReady) return
    const repository = repositoryRef.current
    if (!repository) return
    const includeFiles = filesStoredRef.current
      ? projectSourceKey !== filesKeyRef.current
      : true
    const timer = window.setTimeout(() => {
      const record = currentRecord()
      if (!includeFiles) record.session.filesStored = filesStoredRef.current
      repository
        .save(record, { includeFiles })
        .then((result) => {
          filesStoredRef.current = result.filesStored
          if (result.filesStored) filesKeyRef.current = projectSourceKey
          setProjectNote(
            result.warning ??
              (photosRef.current.some((photo) => photo.missing) || referenceMissing
                ? 'Рецепты сохранены. Исходные файлы нужно привязать.'
                : 'Сохранено на этом Mac'),
          )
        })
        .catch(() => setProjectNote('Не удалось сохранить проект'))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [
    hydrated,
    projectSourceKey,
    recipes,
    reference,
    referenceMissing,
    strength,
    adjustments,
    exportFormat,
    jpegQuality,
    exportMaxEdge,
    selectedId,
    presets,
    persistReady,
  ])

  function updateAdjustment(
    name: keyof RetouchAdjustments,
    value: number,
  ) {
    setAdjustments((current) => ({ ...current, [name]: value }))
  }

  async function chooseReference(file?: File) {
    if (!file) return
    if (!acceptedTypes.has(file.type)) {
      setMessage('Эталон должен быть в формате JPEG или PNG')
      return
    }

    setMessage(undefined)
    try {
      const stats = await readColorStats(file)
      if (referenceUrl) URL.revokeObjectURL(referenceUrl)
      setReference(file)
      setReferenceUrl(URL.createObjectURL(file))
      setReferenceStats(stats)
      setReferenceMissing(undefined)
      setPersistReady(true)
    } catch {
      setMessage('Не удалось прочитать эталонное изображение')
    }
  }

  function removeReference() {
    if (referenceUrl) URL.revokeObjectURL(referenceUrl)
    setReference(undefined)
    setReferenceUrl(undefined)
    setReferenceStats(undefined)
    setReferenceMissing(undefined)
    setMessage(undefined)
    setPersistReady(true)
    if (referenceInput.current) referenceInput.current.value = ''
  }

  function addPhotos(files: FileList | File[]) {
    const valid = Array.from(files).filter((file) => acceptedTypes.has(file.type))
    if (valid.length === 0) {
      setMessage('Выберите фотографии JPEG или PNG')
      return
    }

    const next = valid.map(makePhoto)
    setPhotos((current) => [...current, ...next])
    setRecipes((current) => {
      const recipesNext = { ...current }
      next.forEach((photo) => {
        recipesNext[photo.id] = createHistory(defaultRecipe())
      })
      return recipesNext
    })
    setSelectedId((current) => current ?? next[0].id)
    setPersistReady(true)
    setMessage(
      valid.length === Array.from(files).length
        ? undefined
        : 'Файлы других форматов были пропущены',
    )
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id)
      if (target) {
        revokeUrl(target.sourceUrl)
        revokeUrl(target.resultUrl)
      }
      return current.filter((photo) => photo.id !== id)
    })
    setRecipes((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    if (selectedId === id) setSelectedId(undefined)
  }

  const seriesHasRecipe = photos.some((photo) => {
    const present = recipes[photo.id]?.present
    return present ? !recipeIsIdentity(present) : false
  })

  async function runBatch(onlyErrors = false) {
    if (photos.length === 0 || isRunning) return
    if (!referenceStats && !seriesHasRecipe) return
    batchControl.current = { paused: false, cancelled: false }
    setBatchPaused(false)
    setIsRunning(true)
    setMessage(undefined)

    await runQueue({
      items: photos,
      control: {
        isPaused: () => batchControl.current.paused,
        isCancelled: () => batchControl.current.cancelled,
      },
      shouldRun: (photo) =>
        !photo.missing && (onlyErrors ? photo.status === 'error' : true),
      work: async (photo) => {
        setPhotos((current) =>
          current.map((item) =>
            item.id === photo.id ? { ...item, status: 'processing' } : item,
          ),
        )
        try {
          const result = await processPhoto(
            photo.file,
            referenceStats,
            strength / 100,
            adjustments,
            {
              format: exportFormat,
              recipe: recipesRef.current[photo.id]?.present,
            },
          )
          const resultUrl = URL.createObjectURL(result)
          setPhotos((current) =>
            current.map((item) => {
              if (item.id !== photo.id) return item
              if (item.resultUrl) URL.revokeObjectURL(item.resultUrl)
              return { ...item, result, resultUrl, status: 'done' }
            }),
          )
        } catch {
          setPhotos((current) =>
            current.map((item) =>
              item.id === photo.id ? { ...item, status: 'error' } : item,
            ),
          )
        }
      },
    })

    setIsRunning(false)
    setBatchPaused(false)
  }

  function rememberPresets(next: ProcessingPreset[]) {
    setPresets(next)
    writePresets(localStorage, next)
  }

  function applyLookToSeries(preset: ProcessingPreset) {
    setRecipes((current) => {
      const next = { ...current }
      photos.forEach((photo) => {
        const history = next[photo.id] ?? createHistory(defaultRecipe())
        const applied = applyPreset(history.present, preset)
        next[photo.id] =
          JSON.stringify(applied) === JSON.stringify(history.present)
            ? history
            : historyPush(history, applied)
      })
      return next
    })
  }

  async function downloadAll() {
    const ready = photos.filter((photo) => photo.result)
    if (ready.length === 0) return

    const zip = new JSZip()
    const extension = exportFormat === 'png' ? 'png' : 'jpg'
    ready.forEach((photo) => {
      const baseName = photo.file.name.replace(/\.[^.]+$/, '')
      zip.file(`${baseName}-pixmuse.${extension}`, photo.result!)
    })
    const archive = await zip.generateAsync({ type: 'blob' })
    downloadBlob(archive, 'pixmuse-export.zip')
  }

  async function downloadProject() {
    try {
      const archive = await packProject(currentRecord())
      downloadBlob(archive, 'pixmuse-project.zip')
    } catch {
      setProjectNote('Не удалось собрать архив проекта')
    }
  }

  async function openProjectFile(file?: File) {
    if (!file) return
    try {
      const record = await unpackProject(file)
      const repository = repositoryRef.current
      let next = record
      if (repository) {
        const saved = await repository.save(record)
        filesStoredRef.current = saved.filesStored
        filesKeyRef.current = null
        if (!saved.filesStored) next = { session: { ...record.session, filesStored: false }, files: {} }
        if (saved.warning) setProjectNote(saved.warning)
      }
      setPersistReady(true)
      adoptRecord(next)
    } catch (error) {
      setProjectNote(error instanceof Error ? error.message : 'Не удалось открыть проект')
    }
  }

  function relinkFiles(list: FileList | File[]) {
    const incoming = Array.from(list)
    const expected = photos.map((photo) => ({
      id: photo.id,
      name: photo.file.name,
      size: photo.byteSize ?? photo.file.size,
    }))
    if (reference) {
      expected.push({
        id: REFERENCE_FILE_ID,
        name: reference.name,
        size: reference.size,
      })
    } else if (referenceMissing) {
      expected.push({
        id: REFERENCE_FILE_ID,
        name: referenceMissing.name,
        size: referenceMissing.size,
      })
    }
    const { matched, missing } = matchSourceFiles(expected, incoming)
    setPhotos((current) =>
      current.map((photo) => {
        const file = matched[photo.id]
        if (!file) return photo
        revokeUrl(photo.sourceUrl)
        revokeUrl(photo.resultUrl)
        return {
          ...photo,
          file,
          sourceUrl: URL.createObjectURL(file),
          resultUrl: undefined,
          result: undefined,
          status: 'waiting',
          missing: false,
          byteSize: file.size,
        }
      }),
    )
    const linkedReference = matched[REFERENCE_FILE_ID]
    if (linkedReference) void chooseReference(linkedReference)
    filesKeyRef.current = null
    setPersistReady(true)
    setProjectNote(
      missing.length > 0
        ? `Не найдены файлы: ${missing.join(', ')}`
        : 'Исходные файлы привязаны',
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Pixmuse">
          <span className="brand-mark">
            <MagicWand size={18} weight="fill" />
          </span>
          <span>pixmuse</span>
        </a>
        <nav className="mode-switch" aria-label="Рабочие пространства">
          <button
            type="button"
            className={mode === 'batch' ? 'active' : ''}
            onClick={() => setMode('batch')}
          >
            Серия
          </button>
          <button
            type="button"
            className={mode === 'editor' ? 'active' : ''}
            onClick={() => setMode('editor')}
          >
            Редактор
          </button>
        </nav>
        <div className="topbar-actions">
          <div className="project-actions">
            <button
              className="profile-button"
              type="button"
              disabled={!hydrated}
              onClick={() => void downloadProject()}
            >
              <DownloadSimple size={16} />
              Скачать проект
            </button>
            <button
              className="profile-button"
              type="button"
              disabled={!hydrated}
              onClick={() => projectInput.current?.click()}
            >
              <UploadSimple size={16} />
              Открыть проект
            </button>
            <button
              className="profile-button"
              type="button"
              disabled={!hydrated}
              onClick={() => relinkInput.current?.click()}
            >
              Привязать файлы
            </button>
            {projectNote && <span className="project-note">{projectNote}</span>}
          </div>
          <div className="privacy-note">
            <ShieldCheck size={17} />
            Фото остаются на этом Mac
          </div>
          <button
            className="profile-button"
            type="button"
            onClick={() => setProfileOpen(true)}
          >
            <UserCircle size={20} weight="duotone" />
            Мой профиль
          </button>
        </div>
      </header>

      <input
        ref={projectInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          void openProjectFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <input
        ref={relinkInput}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) relinkFiles(event.target.files)
          event.target.value = ''
        }}
      />

      {!hydrated ? (
        <p className="project-status">Открываю сохранённый проект</p>
      ) : mode === 'editor' ? (
        <PhotoEditor
          active={mode === 'editor'}
          photos={photos}
          selectedId={selected?.id}
          history={selected ? recipes[selected.id] : undefined}
          presets={presets}
          onSelect={setSelectedId}
          onAdd={addPhotos}
          onRemove={removePhoto}
          onChangeHistory={(id, next) =>
            setRecipes((current) => ({ ...current, [id]: next }))
          }
          onSavePreset={(preset) => rememberPresets([...presets, preset])}
          onDeletePreset={(id) =>
            rememberPresets(presets.filter((preset) => preset.id !== id))
          }
          onApplyToSeries={applyLookToSeries}
        />
      ) : (
      <section className="workspace">
        <aside className="control-panel">
          <div className="tool-tabs" aria-label="Инструменты обработки">
            <button
              className={activePanel === 'style' ? 'active' : ''}
              type="button"
              onClick={() => setActivePanel('style')}
            >
              <Palette size={17} />
              Стиль
            </button>
            <button
              className={activePanel === 'retouch' ? 'active' : ''}
              type="button"
              onClick={() => setActivePanel('retouch')}
            >
              <SlidersHorizontal size={17} />
              Ретушь
            </button>
          </div>

          {activePanel === 'style' ? (
            <>
              <div className="panel-heading">
                <div>
                  <span className="step">Эталон</span>
                  <h1>Стиль серии</h1>
                </div>
                {reference && <Check className="success-icon" size={19} />}
              </div>

              <div className="reference-media">
                <button
                  className="reference-picker"
                  type="button"
                  onClick={() => referenceInput.current?.click()}
                >
                  {referenceUrl ? (
                    <img src={referenceUrl} alt="Выбранный эталон" />
                  ) : (
                    <span>
                      <UploadSimple size={23} />
                      Выбрать обработанный кадр
                      <small>JPEG или PNG</small>
                    </span>
                  )}
                </button>
                {referenceUrl && (
                  <button
                    className="delete-reference"
                    type="button"
                    aria-label="Удалить эталонную фотографию"
                    title="Удалить фотографию"
                    onClick={removeReference}
                  >
                    <Trash size={17} weight="bold" />
                  </button>
                )}
              </div>

              <div className="setting">
                <div className="setting-label">
                  <label htmlFor="strength">Сила переноса</label>
                  <output htmlFor="strength">{strength}%</output>
                </div>
                <input
                  id="strength"
                  type="range"
                  min="0"
                  max="100"
                  value={strength}
                  onChange={(event) => setStrength(Number(event.target.value))}
                />
                <p>Цвет и контраст адаптируются к каждому исходнику.</p>
              </div>
            </>
          ) : (
            <div className="retouch-tools">
              <div className="panel-heading">
                <div>
                  <span className="step">Коррекция</span>
                  <h1>Инструменты ретуши</h1>
                </div>
                <Sparkle className="success-icon" size={19} />
              </div>
              <ToolSlider
                id="exposure"
                label="Экспозиция"
                value={adjustments.exposure}
                min={-2}
                max={2}
                onChange={(value) => updateAdjustment('exposure', value)}
              />
              <ToolSlider
                id="contrast"
                label="Контраст"
                value={adjustments.contrast}
                min={-50}
                max={50}
                onChange={(value) => updateAdjustment('contrast', value)}
              />
              <ToolSlider
                id="saturation"
                label="Насыщенность"
                value={adjustments.saturation}
                min={-100}
                max={100}
                onChange={(value) => updateAdjustment('saturation', value)}
              />
              <ToolSlider
                id="warmth"
                label="Теплота"
                value={adjustments.warmth}
                min={-50}
                max={50}
                onChange={(value) => updateAdjustment('warmth', value)}
              />
              <ToolSlider
                id="skin"
                label="Мягкость кожи"
                value={adjustments.skinSmoothing ?? 0}
                min={0}
                max={70}
                suffix="%"
                onChange={(value) => updateAdjustment('skinSmoothing', value)}
              />
              <p className="beta-note">
                Мягкость кожи работает по цветовой маске. Для точного удаления
                дефектов добавим распознавание лица отдельным модулем.
              </p>
              <button
                className="reset-tools"
                type="button"
                onClick={() =>
                  setAdjustments({
                    exposure: 0,
                    contrast: 0,
                    saturation: 0,
                    warmth: 0,
                    skinSmoothing: 18,
                  })
                }
              >
                Сбросить настройки
              </button>
            </div>
          )}

          <input
            ref={referenceInput}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png"
            onChange={(event) => chooseReference(event.target.files?.[0])}
          />

          <div className="panel-divider" />
          <div className="panel-heading compact">
            <div>
              <span className="step">Серия</span>
              <h2>{photos.length ? `${photos.length} фото` : 'Добавьте фото'}</h2>
            </div>
            {photos.length > 0 && (
              <button
                className="icon-button"
                type="button"
                title="Добавить фотографии"
                onClick={() => photoInput.current?.click()}
              >
                <Plus size={18} />
              </button>
            )}
          </div>

          {photos.length === 0 ? (
            <button
              className="photo-dropzone"
              type="button"
              onClick={() => photoInput.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                addPhotos(event.dataTransfer.files)
              }}
            >
              <Images size={26} />
              Перетащите серию сюда
              <small>Можно выбрать сразу много файлов</small>
            </button>
          ) : (
            <div className="photo-list" aria-label="Очередь фотографий">
              {photos.map((photo) => (
                <button
                  className={`photo-row ${selected?.id === photo.id ? 'selected' : ''}`}
                  type="button"
                  key={photo.id}
                  onClick={() => setSelectedId(photo.id)}
                >
                  <img src={photo.sourceUrl} alt="" />
                  <span className="photo-meta">
                    <strong>{photo.file.name}</strong>
                    <small>
                      {photo.status === 'waiting' && formatSize(photo.file.size)}
                      {photo.status === 'processing' && 'Обрабатывается'}
                      {photo.status === 'done' && 'Готово'}
                      {photo.status === 'error' && 'Ошибка'}
                    </small>
                  </span>
                  <span
                    className="remove-button"
                    role="button"
                    tabIndex={0}
                    aria-label={`Удалить ${photo.file.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      removePhoto(photo.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') removePhoto(photo.id)
                    }}
                  >
                    {photo.status === 'done' ? (
                      <Check size={16} />
                    ) : (
                      <Trash size={15} />
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={photoInput}
            className="visually-hidden"
            type="file"
            multiple
            accept="image/jpeg,image/png"
            onChange={(event) => event.target.files && addPhotos(event.target.files)}
          />

          {message && <p className="inline-message">{message}</p>}

          <div className="batch-extra">
            <label htmlFor="series-preset">Пресет редактора</label>
            <select
              id="series-preset"
              value={presetId}
              onChange={(event) => setPresetId(event.target.value)}
            >
              <option value="">Не выбран</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              type="button"
              disabled={!presetId || photos.length === 0 || isRunning}
              onClick={() => {
                const preset = presets.find((item) => item.id === presetId)
                if (preset) applyLookToSeries(preset)
              }}
            >
              Применить пресет к серии
            </button>
            <div className="format-switch" aria-label="Формат экспорта">
              <button
                type="button"
                className={exportFormat === 'jpeg' ? 'active' : ''}
                onClick={() => setExportFormat('jpeg')}
              >
                JPG
              </button>
              <button
                type="button"
                className={exportFormat === 'png' ? 'active' : ''}
                onClick={() => setExportFormat('png')}
              >
                PNG
              </button>
            </div>
            <p>Глобальный рецепт каждого кадра добавляется к эталону. Локальные мазки остаются на своём фото.</p>
          </div>

          <button
            className="primary-button"
            type="button"
            disabled={
              photos.length === 0 ||
              isRunning ||
              (!referenceStats && !seriesHasRecipe)
            }
            onClick={() => runBatch(false)}
          >
            {isRunning ? (
              <>
                <ArrowCounterClockwise className="spin" size={18} />
                Обработка {completedCount}/{photos.length}
              </>
            ) : (
              <>
                <MagicWand size={18} weight="fill" />
                Обработать серию
              </>
            )}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={completedCount === 0 || isRunning}
            onClick={downloadAll}
          >
            <DownloadSimple size={18} />
            Скачать готовые ({completedCount})
          </button>
          {isRunning && (
            <div className="queue-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  batchControl.current.paused = !batchControl.current.paused
                  setBatchPaused(batchControl.current.paused)
                }}
              >
                {batchPaused ? 'Продолжить' : 'Пауза'}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  batchControl.current.cancelled = true
                  batchControl.current.paused = false
                  setBatchPaused(false)
                }}
              >
                Отмена
              </button>
            </div>
          )}
          {!isRunning && photos.some((photo) => photo.status === 'error') && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => runBatch(true)}
            >
              Повторить ошибки
            </button>
          )}
        </aside>

        <section className="preview-panel">
          {selected ? (
            <>
              <div className="preview-toolbar">
                <div>
                  <strong>{selected.file.name}</strong>
                  <span>
                    {selected.resultUrl ? 'До и после' : 'Исходный кадр'}
                  </span>
                </div>
                {selected.resultUrl && (
                  <div className="comparison-legend">
                    <span>До</span>
                    <span>После</span>
                  </div>
                )}
              </div>
              <div className="image-stage">
                <img
                  className="preview-image"
                  src={selected.sourceUrl}
                  alt="Исходная фотография"
                />
                {selected.resultUrl && (
                  <>
                    <div
                      className="result-layer"
                      style={{ clipPath: `inset(0 0 0 ${comparison}%)` }}
                    >
                      <img
                        className="preview-image"
                        src={selected.resultUrl}
                        alt="Обработанная фотография"
                      />
                    </div>
                    <div
                      className="compare-line"
                      style={{ left: `${comparison}%` }}
                    />
                    <input
                      className="compare-range"
                      type="range"
                      min="0"
                      max="100"
                      value={comparison}
                      aria-label="Сравнить до и после"
                      onChange={(event) =>
                        setComparison(Number(event.target.value))
                      }
                    />
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="empty-preview">
              <Images size={36} />
              <h2>Здесь появится ваша серия</h2>
              <p>
                Добавьте эталон и фотографии. После обработки можно сравнить
                каждый кадр и скачать всю серию архивом.
              </p>
              <button
                type="button"
                className="secondary-button inline"
                onClick={() => photoInput.current?.click()}
              >
                <Plus size={18} />
                Добавить фотографии
              </button>
            </div>
          )}
        </section>
      </section>
      )}

      {profileOpen && (
        <div
          className="profile-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setProfileOpen(false)
          }}
        >
          <section
            className="profile-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-title"
          >
            <div className="profile-heading">
              <div>
                <span className="step">Личный кабинет</span>
                <h2 id="profile-title">Оформление Pixmuse</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Закрыть профиль"
                onClick={() => setProfileOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="profile-avatar">
              <UserCircle size={42} weight="duotone" />
              <div>
                <strong>Моя студия</strong>
                <span>Локальный профиль</span>
              </div>
            </div>
            <div className="color-control">
              <label htmlFor="accent-color">Главный цвет интерфейса</label>
              <p>Выберите готовый оттенок или установите любой свой цвет.</p>
              <div className="color-presets">
                {colorPresets.map((color) => (
                  <button
                    key={color}
                    className={accent === color ? 'selected' : ''}
                    type="button"
                    style={{ background: color }}
                    aria-label={`Выбрать цвет ${color}`}
                    onClick={() => setAccent(color)}
                  />
                ))}
                <label className="custom-color" title="Свой цвет">
                  <Palette size={18} />
                  <input
                    id="accent-color"
                    type="color"
                    value={accent}
                    onChange={(event) => setAccent(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="color-control background-control">
              <label htmlFor="background-color">Фон рабочего пространства</label>
              <p>Настройка не влияет на фотографии и экспорт.</p>
              <div className="color-presets">
                {backgroundPresets.map((color) => (
                  <button
                    key={color}
                    className={background === color ? 'selected' : ''}
                    type="button"
                    style={{ background: color }}
                    aria-label={`Выбрать фон ${color}`}
                    onClick={() => setBackground(color)}
                  />
                ))}
                <label className="custom-color" title="Свой цвет фона">
                  <Palette size={18} />
                  <input
                    id="background-color"
                    type="color"
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="color-control background-control">
              <label htmlFor="panel-color">Панель инструментов</label>
              <p>Отдельный фон области «Стиль» и «Ретушь».</p>
              <div className="color-presets">
                {panelPresets.map((color) => (
                  <button
                    key={color}
                    className={panelBackground === color ? 'selected' : ''}
                    type="button"
                    style={{ background: color }}
                    aria-label={`Выбрать цвет панели ${color}`}
                    onClick={() => setPanelBackground(color)}
                  />
                ))}
                <label className="custom-color" title="Свой цвет панели">
                  <Palette size={18} />
                  <input
                    id="panel-color"
                    type="color"
                    value={panelBackground}
                    onChange={(event) => setPanelBackground(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="color-control background-control font-control">
              <label htmlFor="interface-font">Шрифт интерфейса</label>
              <p>Применяется ко всему рабочему пространству Pixmuse.</p>
              <select
                id="interface-font"
                value={fontId}
                onChange={(event) => setFontId(event.target.value)}
              >
                {fontOptions.map((font) => (
                  <option
                    key={font.id}
                    value={font.id}
                    style={{ fontFamily: font.value }}
                  >
                    {font.name}
                  </option>
                ))}
              </select>
              <div
                className="font-preview"
                style={{
                  fontFamily:
                    fontOptions.find((font) => font.id === fontId)?.value,
                }}
              >
                Pixmuse · Профессиональная ретушь
              </div>
            </div>
            <p className="saved-note">
              Оформление сохраняется автоматически только на этом устройстве.
            </p>
          </section>
        </div>
      )}
    </main>
  )
}
