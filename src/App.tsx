import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  composeRetouchPixels,
  paintRetouch,
  processPhoto,
  readColorStats,
  type ColorStats,
  type RetouchAdjustments,
} from './lib/colorTransfer'
import { decodePreview, downloadBlob } from './lib/exportImage'
import { createHistory, historyPush, type History } from './lib/history'
import {
  hashDistance,
  inspectQuality,
  type QualityReport,
} from './lib/qualityInspector'
import {
  buildProjectRecord,
  createIndexedDbProjectLibrary,
  fileFromStored,
  matchSourceFiles,
  packProject,
  REFERENCE_FILE_ID,
  unpackProject,
  type ProjectRecord,
  type ProjectLibraryRepository,
  type ProjectRepository,
  type ProjectSummary,
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

type PhotoStatus =
  | 'waiting'
  | 'processing'
  | 'done'
  | 'error'
  | 'cancelled'

interface PhotoItem {
  id: string
  file: File
  sourceUrl: string
  resultUrl?: string
  result?: Blob
  status: PhotoStatus
  missing?: boolean
  byteSize?: number
  quality?: QualityReport | null
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

function projectFilesKey(
  photos: PhotoItem[],
  reference?: File,
  missingReference?: SavedReference,
): string {
  return [
    photos
      .map(
        (photo) =>
          `${photo.id}:${photo.byteSize ?? photo.file.size}:${photo.missing ? 1 : 0}:${photo.file.name}`,
      )
      .join('|'),
    reference ? `${reference.name}:${reference.size}` : '',
    missingReference
      ? `${missingReference.name}:${missingReference.size}`
      : '',
  ].join('~')
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
  const [comparison, setComparison] = useState(0)
  const [livePhotoId, setLivePhotoId] = useState<string>()
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
  const [projectName, setProjectName] = useState('Pixmuse')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string>()
  const [referenceMissing, setReferenceMissing] = useState<SavedReference>()
  const [batchPaused, setBatchPaused] = useState(false)
  const batchControl = useRef<{
    paused: boolean
    cancelled: boolean
    activeController?: AbortController
  }>({ paused: false, cancelled: false })
  const recipesRef = useRef(recipes)
  const photoInput = useRef<HTMLInputElement>(null)
  const referenceInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const relinkInput = useRef<HTMLInputElement>(null)
  const repositoryRef = useRef<ProjectRepository | null>(null)
  const projectLibraryRef = useRef<ProjectLibraryRepository | null>(null)
  const filesStoredRef = useRef(true)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewCache = useRef<
    { id: string; pixels: Uint8ClampedArray; width: number; height: number } | null
  >(null)
  const filesKeyRef = useRef<string | null>(null)
  const photosRef = useRef<PhotoItem[]>([])
  const referenceUrlRef = useRef<string | undefined>(undefined)

  const selected = useMemo(
    () => photos.find((photo) => photo.id === selectedId) ?? photos[0],
    [photos, selectedId],
  )
  const completedCount = photos.filter((photo) => photo.status === 'done').length
  const duplicateIds = useMemo(() => {
    const duplicates = new Set<string>()
    for (let left = 0; left < photos.length; left += 1) {
      const first = photos[left].quality
      if (!first) continue
      for (let right = left + 1; right < photos.length; right += 1) {
        const second = photos[right].quality
        if (
          second &&
          hashDistance(first.perceptualHash, second.perceptualHash) <= 4
        ) {
          duplicates.add(photos[left].id)
          duplicates.add(photos[right].id)
        }
      }
    }
    return duplicates
  }, [photos])
  const qualityIssueCount = photos.filter(
    (photo) =>
      Boolean(photo.quality?.flags.length) || duplicateIds.has(photo.id),
  ).length

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

  const currentRecord = useCallback((): ProjectRecord => {
    return buildProjectRecord({
      name: projectName,
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
  }, [
    selectedId,
    reference,
    referenceMissing,
    strength,
    adjustments,
    exportFormat,
    jpegQuality,
    exportMaxEdge,
    presets,
    projectName,
  ])

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
    setProjectName(record.session.name)
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
    const hasMissingSources =
      nextPhotos.some((photo) => photo.missing) ||
      Boolean(record.session.reference && !referenceFile)
    filesStoredRef.current =
      record.session.filesStored && !hasMissingSources
    filesKeyRef.current = filesStoredRef.current
      ? projectFilesKey(nextPhotos, referenceFile)
      : null
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
    const library = createIndexedDbProjectLibrary()
    projectLibraryRef.current = library
    library
      .list()
      .then(async (available) => {
        let projectId = await library.getActiveId()
        if (!projectId || !available.some((project) => project.id === projectId)) {
          if (available[0]) {
            projectId = available[0].id
            await library.setActiveId(projectId)
          } else {
            const created = await library.create('Моя съёмка')
            projectId = created.id
            available = await library.list()
          }
        }
        if (cancelled) return null
        const repository = library.repository(projectId)
        repositoryRef.current = repository
        setProjects(available)
        setActiveProjectId(projectId)
        return repository.load()
      })
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
  }, [])

  const refreshProjects = useCallback(async () => {
    const library = projectLibraryRef.current
    if (!library) return
    setProjects(await library.list())
  }, [])

  async function switchProject(id: string) {
    if (!id || id === activeProjectId || isRunning) return
    const library = projectLibraryRef.current
    const currentRepository = repositoryRef.current
    if (!library || !currentRepository) return
    setProjectNote('Сохраняю текущий проект…')
    const record = currentRecord()
    if (hasMissingProjectSources) record.session.filesStored = filesStoredRef.current
    const saved = await currentRepository.save(record, {
      includeFiles: !hasMissingProjectSources,
    })
    if (!saved.saved) {
      setProjectNote(saved.warning ?? 'Не удалось сохранить текущий проект')
      return
    }
    const repository = library.repository(id)
    const next = await repository.load()
    if (!next) return
    await library.setActiveId(id)
    repositoryRef.current = repository
    setActiveProjectId(id)
    adoptRecord(next)
  }

  async function createProject() {
    if (isRunning) return
    const library = projectLibraryRef.current
    if (!library) return
    const requested = window.prompt('Название новой съёмки', 'Новая съёмка')
    if (!requested?.trim()) return
    const created = await library.create(requested.trim())
    const next = await created.repository.load()
    if (!next) return
    repositoryRef.current = created.repository
    setActiveProjectId(created.id)
    adoptRecord(next)
    await refreshProjects()
  }

  async function renameProject() {
    const library = projectLibraryRef.current
    if (!library || !activeProjectId) return
    const requested = window.prompt('Новое название проекта', projectName)
    if (!requested?.trim()) return
    await library.rename(activeProjectId, requested.trim())
    setProjectName(requested.trim())
    setProjectNote('Проект переименован')
    await refreshProjects()
  }

  async function deleteProject() {
    const library = projectLibraryRef.current
    if (!library || !activeProjectId || isRunning) return
    if (!window.confirm(`Удалить проект «${projectName}» с этого Mac?`)) return
    await library.delete(activeProjectId)
    const remaining = await library.list()
    if (remaining[0]) {
      const repository = library.repository(remaining[0].id)
      const next = await repository.load()
      if (next) {
        await library.setActiveId(remaining[0].id)
        repositoryRef.current = repository
        setActiveProjectId(remaining[0].id)
        adoptRecord(next)
      }
    } else {
      const created = await library.create('Моя съёмка')
      const next = await created.repository.load()
      if (next) {
        repositoryRef.current = created.repository
        setActiveProjectId(created.id)
        adoptRecord(next)
      }
    }
    await refreshProjects()
  }

  const projectSourceKey = projectFilesKey(
    photos,
    reference,
    referenceMissing,
  )
  const hasMissingProjectSources =
    photos.some((photo) => photo.missing) ||
    Boolean(referenceMissing && !reference)

  useEffect(() => {
    const targets = photosRef.current.filter(
      (photo) => !photo.missing && photo.quality === undefined,
    )
    if (targets.length === 0) return
    let cancelled = false
    void (async () => {
      const reports = new Map<string, QualityReport | null>()
      for (const photo of targets) {
        try {
          const raster = await decodePreview(photo.file, 320)
          reports.set(
            photo.id,
            inspectQuality(raster.pixels, raster.width, raster.height),
          )
        } catch {
          reports.set(photo.id, null)
        }
        if (cancelled) return
      }
      setPhotos((current) =>
        current.map((photo) =>
          reports.has(photo.id)
            ? { ...photo, quality: reports.get(photo.id) }
            : photo,
        ),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [projectSourceKey])

  useEffect(() => {
    if (!hydrated || !persistReady) return
    const repository = repositoryRef.current
    if (!repository) return
    const includeFiles = hasMissingProjectSources
      ? false
      : filesStoredRef.current
        ? projectSourceKey !== filesKeyRef.current
        : true
    const timer = window.setTimeout(() => {
      const record = currentRecord()
      if (!includeFiles) record.session.filesStored = filesStoredRef.current
      repository
        .save(record, { includeFiles })
        .then((result) => {
          if (!result.saved) {
            setProjectNote(
              result.warning ?? 'Текущие изменения не удалось сохранить',
            )
            return
          }
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
    currentRecord,
    hasMissingProjectSources,
  ])

  useEffect(() => {
    if (mode !== 'batch' || !selected || selected.missing) return
    const photoId = selected.id
    const file = selected.file
    const recipe = recipes[photoId]?.present
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        if (!previewCache.current || previewCache.current.id !== photoId) {
          const decoded = await decodePreview(file)
          previewCache.current = { id: photoId, ...decoded }
        }
        const cached = previewCache.current
        const canvas = liveCanvasRef.current
        if (!cached || !canvas || cancelled) return
        const composed = composeRetouchPixels(
          cached.pixels,
          cached.width,
          cached.height,
          referenceStats,
          strength / 100,
          adjustments,
          recipe,
        )
        if (cancelled) return
        paintRetouch(
          canvas,
          composed.pixels,
          composed.width,
          composed.height,
          adjustments.skinSmoothing ?? 0,
        )
        if (!cancelled) setLivePhotoId(photoId)
      } catch {
        if (!cancelled) setLivePhotoId(undefined)
      }
    }, 30)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mode, selected, recipes, referenceStats, strength, adjustments])

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
  const retouchActive =
    adjustments.exposure !== 0 ||
    adjustments.contrast !== 0 ||
    adjustments.saturation !== 0 ||
    adjustments.warmth !== 0 ||
    (adjustments.skinSmoothing ?? 0) > 0

  async function runBatch(onlyErrors = false) {
    if (photos.length === 0 || isRunning) return
    if (!referenceStats && !seriesHasRecipe && !retouchActive) return
    batchControl.current = { paused: false, cancelled: false }
    const batchReferenceStats = referenceStats
      ? structuredClone(referenceStats)
      : undefined
    const batchAdjustments = structuredClone(adjustments)
    const batchRecipes = structuredClone(recipesRef.current)
    const batchStrength = strength / 100
    const batchOptions = {
      format: exportFormat,
      quality: jpegQuality,
      maxEdge: exportMaxEdge,
    } as const
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
        const controller = new AbortController()
        batchControl.current.activeController = controller
        const timeout = window.setTimeout(
          () => controller.abort('timeout'),
          120_000,
        )
        setPhotos((current) =>
          current.map((item) =>
            item.id === photo.id ? { ...item, status: 'processing' } : item,
          ),
        )
        try {
          const result = await processPhoto(
            photo.file,
            batchReferenceStats,
            batchStrength,
            batchAdjustments,
            {
              ...batchOptions,
              recipe: batchRecipes[photo.id]?.present,
              signal: controller.signal,
            },
          )
          if (controller.signal.aborted || batchControl.current.cancelled) {
            throw new DOMException('Операция отменена', 'AbortError')
          }
          const resultUrl = URL.createObjectURL(result)
          setPhotos((current) =>
            current.map((item) => {
              if (item.id !== photo.id) return item
              if (item.resultUrl) URL.revokeObjectURL(item.resultUrl)
              return { ...item, result, resultUrl, status: 'done' }
            }),
          )
        } catch (error) {
          const cancelled =
            controller.signal.aborted &&
            controller.signal.reason !== 'timeout'
          setPhotos((current) =>
            current.map((item) =>
              item.id === photo.id
                ? { ...item, status: cancelled ? 'cancelled' : 'error' }
                : item,
            ),
          )
          if (
            controller.signal.reason === 'timeout' &&
            error instanceof Error
          ) {
            setMessage(`Обработка ${photo.file.name} превысила 2 минуты`)
          }
        } finally {
          window.clearTimeout(timeout)
          if (batchControl.current.activeController === controller) {
            batchControl.current.activeController = undefined
          }
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
    const archive = await zip.generateAsync({ type: 'blob', streamFiles: true })
    downloadBlob(archive, 'pixmuse-export.zip')
  }

  function releaseBatchResults() {
    setPhotos((current) =>
      current.map((photo) => {
        revokeUrl(photo.resultUrl)
        return {
          ...photo,
          result: undefined,
          resultUrl: undefined,
          status: photo.status === 'done' ? 'waiting' : photo.status,
        }
      }),
    )
    setMessage('Готовые Blob освобождены из памяти. Оригиналы и рецепты сохранены.')
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
        filesStoredRef.current = saved.saved && saved.filesStored
        filesKeyRef.current = null
        next = {
          session: {
            ...record.session,
            filesStored: saved.saved && saved.filesStored,
          },
          files: record.files,
        }
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
            <select
              className="project-switcher"
              aria-label="Текущий проект"
              value={activeProjectId ?? ''}
              disabled={!hydrated || isRunning}
              onChange={(event) => void switchProject(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button
              className="profile-button"
              type="button"
              disabled={!hydrated || isRunning}
              onClick={() => void createProject()}
            >
              <Plus size={16} />
              Новый
            </button>
            <button
              className="profile-button"
              type="button"
              disabled={!hydrated}
              onClick={() => void renameProject()}
            >
              Переименовать
            </button>
            <button
              className="profile-button"
              type="button"
              disabled={!hydrated || isRunning}
              onClick={() => void deleteProject()}
            >
              <Trash size={16} />
              Удалить проект
            </button>
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
        data-testid="project-input"
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
        data-testid="relink-input"
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
          jpegQuality={jpegQuality}
          exportMaxEdge={exportMaxEdge}
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
                <p>
                  {reference
                    ? 'Цвет и контраст адаптируются к каждому исходнику.'
                    : 'Сначала выберите эталон: без него сила переноса не меняет кадр.'}
                </p>
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
            data-testid="reference-input"
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
                      {photo.status === 'cancelled' && 'Отменено'}
                    </small>
                    {photo.quality &&
                      (photo.quality.flags.length > 0 ||
                        duplicateIds.has(photo.id)) && (
                        <small className="quality-warning">
                          {[
                            photo.quality.flags.includes('blur')
                              ? 'возможен смаз'
                              : '',
                            photo.quality.flags.includes('highlights')
                              ? 'пересвет'
                              : '',
                            photo.quality.flags.includes('shadows')
                              ? 'провал теней'
                              : '',
                            duplicateIds.has(photo.id) ? 'похожий кадр' : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      )}
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
            data-testid="batch-photo-input"
            className="visually-hidden"
            type="file"
            multiple
            accept="image/jpeg,image/png"
            onChange={(event) => event.target.files && addPhotos(event.target.files)}
          />

          {message && <p className="inline-message">{message}</p>}

          <div className="batch-extra">
            <div className="quality-summary">
              <strong>Quality Inspector</strong>
              <span>
                {photos.some((photo) => photo.quality === undefined)
                  ? 'Анализирует миниатюры…'
                  : qualityIssueCount > 0
                    ? `Проверить кадров: ${qualityIssueCount}`
                    : photos.length > 0
                      ? 'Явных проблем не найдено'
                      : 'Добавьте фотографии'}
              </span>
            </div>
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
            <p className="export-note">Цвет экспорта: sRGB</p>
            <label htmlFor="jpeg-quality">
              Качество JPEG {Math.round(jpegQuality * 100)}%
            </label>
            <input
              id="jpeg-quality"
              type="range"
              min={60}
              max={100}
              value={Math.round(jpegQuality * 100)}
              onChange={(event) => setJpegQuality(Number(event.target.value) / 100)}
            />
            <label htmlFor="export-edge">Длинная сторона</label>
            <select
              id="export-edge"
              value={exportMaxEdge}
              onChange={(event) => setExportMaxEdge(Number(event.target.value))}
            >
              <option value={0}>Как у оригинала</option>
              <option value={1280}>1280 px</option>
              <option value={2048}>2048 px</option>
              <option value={3840}>3840 px</option>
            </select>
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
              (!referenceStats && !seriesHasRecipe && !retouchActive)
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
          {completedCount > 0 && !isRunning && (
            <button
              className="secondary-button"
              type="button"
              onClick={releaseBatchResults}
            >
              <Trash size={17} />
              Освободить результаты из памяти
            </button>
          )}
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
                  batchControl.current.activeController?.abort('cancelled')
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
                    {livePhotoId === selected.id
                      ? 'Живой предпросмотр'
                      : 'Исходный кадр'}
                  </span>
                </div>
                <div className="compare-switch" role="group" aria-label="Что показывать">
                  <button
                    type="button"
                    className={comparison === 100 ? 'active' : ''}
                    aria-pressed={comparison === 100}
                    onClick={() => setComparison(100)}
                  >
                    До
                  </button>
                  <button
                    type="button"
                    className={comparison === 0 ? 'active' : ''}
                    aria-pressed={comparison === 0}
                    onClick={() => setComparison(0)}
                  >
                    После
                  </button>
                </div>
              </div>
              <div className="image-stage">
                <img
                  className="preview-image"
                  src={selected.sourceUrl}
                  alt="Исходная фотография"
                />
                <div
                  className="result-layer"
                  style={{ clipPath: `inset(0 0 0 ${comparison}%)` }}
                >
                  <canvas
                    ref={liveCanvasRef}
                    className="preview-image"
                    style={{
                      visibility: livePhotoId === selected.id ? 'visible' : 'hidden',
                    }}
                  />
                </div>
                {comparison > 0 && comparison < 100 && (
                  <div className="compare-line" style={{ left: `${comparison}%` }} />
                )}
                <input
                  className="compare-range"
                  type="range"
                  min="0"
                  max="100"
                  value={comparison}
                  aria-label="Сравнить до и после"
                  onChange={(event) => setComparison(Number(event.target.value))}
                />
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
