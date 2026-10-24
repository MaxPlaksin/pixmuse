import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowUUpLeft,
  ArrowUUpRight,
  Crop,
  DownloadSimple,
  FirstAid,
  FloppyDisk,
  Images,
  Moon,
  Plus,
  Stack,
  Sun,
  SunDim,
  Trash,
} from '@phosphor-icons/react'
import { decodePreview, downloadBlob, renderFileToBlob } from '../lib/exportImage'
import { historyRedo, historyUndo, type History } from '../lib/history'
import { renderPreview } from '../lib/previewClient'
import {
  applyPreset,
  cloneRecipe,
  defaultRecipe,
  hslBands,
  presetFromRecipe,
  type CurvePoint,
  type EditRecipe,
  type HslBand,
  type LocalStroke,
  type ProcessingPreset,
  type StrokeTool,
} from '../lib/recipe'
import type { Raster } from '../lib/renderRecipe'

type EditorTool = 'color' | 'crop' | StrokeTool

interface EditorPhoto {
  id: string
  file: File
  sourceUrl: string
  status: 'waiting' | 'processing' | 'done' | 'error'
}

const bandLabels: Record<HslBand, string> = {
  red: 'Красный',
  orange: 'Оранжевый',
  yellow: 'Жёлтый',
  green: 'Зелёный',
  aqua: 'Голубой',
  blue: 'Синий',
  purple: 'Фиолетовый',
  magenta: 'Пурпурный',
}

function paint(canvas: HTMLCanvasElement | null, raster: Raster) {
  if (!canvas) return
  canvas.width = raster.width
  canvas.height = raster.height
  const context = canvas.getContext('2d')
  if (!context) return
  const image = context.createImageData(raster.width, raster.height)
  image.data.set(raster.pixels)
  context.putImageData(image, 0, 0)
}

function formatSigned(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

function EditorSlider({
  label,
  value,
  min,
  max,
  step,
  digits = 0,
  suffix = '',
  signed = true,
  onPreview,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  digits?: number
  suffix?: string
  signed?: boolean
  onPreview: (value: number) => void
  onCommit: () => void
}) {
  const shown = signed ? formatSigned(value, digits) : Number(value.toFixed(digits))
  return (
    <div className="setting tool-setting">
      <div className="setting-label">
        <label>{label}</label>
        <output>
          {shown}
          {suffix}
        </output>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onPreview(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </div>
  )
}

function CurveEditor({
  points,
  onPreview,
  onCommit,
}: {
  points: CurvePoint[]
  onPreview: (points: CurvePoint[]) => void
  onCommit: () => void
}) {
  const dragIndex = useRef<number | null>(null)
  const path = [...points]
    .sort((a, b) => a.x - b.x)
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * 200} ${160 - point.y * 160}`)
    .join(' ')

  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (dragIndex.current === null) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height))
    const next = points.map((point, index) => {
      if (index !== dragIndex.current) return point
      const locked = index === 0 || index === points.length - 1
      return { x: locked ? point.x : x, y }
    })
    onPreview(next)
  }

  return (
    <svg
      className="curve-editor"
      viewBox="0 0 200 160"
      onPointerMove={move}
      onPointerUp={() => {
        dragIndex.current = null
        onCommit()
      }}
      onPointerLeave={() => {
        if (dragIndex.current === null) return
        dragIndex.current = null
        onCommit()
      }}
      onDoubleClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
        const y = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height))
        onPreview([...points, { x, y }].sort((a, b) => a.x - b.x))
        onCommit()
      }}
    >
      <path d={path} />
      {points.map((point, index) => (
        <circle
          key={`${point.x}-${point.y}-${index}`}
          cx={point.x * 200}
          cy={160 - point.y * 160}
          r="5"
          onPointerDown={(event) => {
            event.stopPropagation()
            dragIndex.current = index
          }}
          onDoubleClick={(event) => {
            event.stopPropagation()
            if (points.length <= 2) return
            onPreview(points.filter((_, pointIndex) => pointIndex !== index))
            onCommit()
          }}
        />
      ))}
    </svg>
  )
}

export function PhotoEditor({
  active,
  photos,
  selectedId,
  history,
  presets,
  onSelect,
  onAdd,
  onRemove,
  onChangeHistory,
  onSavePreset,
  onDeletePreset,
  onApplyToSeries,
}: {
  active: boolean
  photos: EditorPhoto[]
  selectedId?: string
  history?: History<EditRecipe>
  presets: ProcessingPreset[]
  onSelect: (id: string) => void
  onAdd: (files: FileList | File[]) => void
  onRemove: (id: string) => void
  onChangeHistory: (id: string, history: History<EditRecipe>) => void
  onSavePreset: (preset: ProcessingPreset) => void
  onDeletePreset: (id: string) => void
  onApplyToSeries: (preset: ProcessingPreset) => void
}) {
  const selected = photos.find((photo) => photo.id === selectedId) ?? photos[0]
  const recipe = history?.present ?? defaultRecipe()
  const [tool, setTool] = useState<EditorTool>('color')
  const [zoom, setZoom] = useState(1)
  const [compare, setCompare] = useState(false)
  const [comparison, setComparison] = useState(50)
  const [band, setBand] = useState<HslBand>('red')
  const [brushRadius, setBrushRadius] = useState(0.04)
  const [brushStrength, setBrushStrength] = useState(70)
  const [presetName, setPresetName] = useState('Мой стиль')
  const [frame, setFrame] = useState({ width: 1, height: 1 })
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
  const [rendering, setRendering] = useState(false)
  const [message, setMessage] = useState<string>()
  const afterRef = useRef<HTMLCanvasElement>(null)
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cache = useRef<
    { id: string; pixels: Uint8ClampedArray; width: number; height: number } | undefined
  >(undefined)
  const gesture = useRef<EditRecipe | null>(null)
  const latest = useRef(recipe)
  const stroke = useRef<LocalStroke | null>(null)
  const cropStart = useRef<{ x: number; y: number } | null>(null)
  latest.current = recipe

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const observer = new ResizeObserver(() => {
      setStageSize({ width: node.clientWidth, height: node.clientHeight })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [selected?.id])

  useEffect(() => {
    if (!active || !selected || !history) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setRendering(true)
      try {
        if (!cache.current || cache.current.id !== selected.id) {
          const decoded = await decodePreview(selected.file)
          cache.current = { id: selected.id, ...decoded }
        }
        if (cancelled || !cache.current) return
        const ignoreCrop = tool === 'crop'
        const after = await renderPreview(
          cache.current.pixels,
          cache.current.width,
          cache.current.height,
          recipe,
          ignoreCrop,
        )
        if (cancelled) return
        paint(afterRef.current, after)
        setFrame({ width: after.width, height: after.height })
        if (compare) {
          const neutral = defaultRecipe()
          const beforeRecipe = cloneRecipe(recipe)
          beforeRecipe.adjustments = neutral.adjustments
          beforeRecipe.curve = neutral.curve
          beforeRecipe.hsl = neutral.hsl
          beforeRecipe.strokes = []
          const before = await renderPreview(
            cache.current.pixels,
            cache.current.width,
            cache.current.height,
            beforeRecipe,
            ignoreCrop,
          )
          if (!cancelled) paint(beforeRef.current, before)
        }
      } catch {
        if (!cancelled) setMessage('Не удалось построить предпросмотр')
      } finally {
        if (!cancelled) setRendering(false)
      }
    }, 40)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, compare, history, recipe, selected, tool])

  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (!history || !selected) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      onChangeHistory(
        selected.id,
        event.shiftKey ? historyRedo(history) : historyUndo(history),
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, history, onChangeHistory, selected])

  function replacePresent(next: EditRecipe) {
    if (!selected || !history) return
    latest.current = next
    onChangeHistory(selected.id, { ...history, present: next })
  }

  function beginGesture() {
    if (!gesture.current) gesture.current = cloneRecipe(latest.current)
  }

  function commitGesture() {
    if (!selected || !history) return
    const base = gesture.current
    const next = latest.current
    gesture.current = null
    if (!base || JSON.stringify(base) === JSON.stringify(next)) return
    onChangeHistory(selected.id, {
      past: [...history.past, base],
      present: next,
      future: [],
    })
  }

  function changeAdjustment(
    key: keyof EditRecipe['adjustments'],
    value: number,
  ) {
    beginGesture()
    const next = cloneRecipe(gesture.current ?? latest.current)
    next.adjustments[key] = value
    replacePresent(next)
  }

  async function exportPhoto(format: 'jpeg' | 'png') {
    if (!selected) return
    setMessage(undefined)
    try {
      const blob = await renderFileToBlob(selected.file, latest.current, format)
      const baseName = selected.file.name.replace(/\.[^.]+$/, '')
      downloadBlob(blob, `${baseName}-pixmuse.${format === 'jpeg' ? 'jpg' : 'png'}`)
    } catch {
      setMessage('Не удалось экспортировать кадр')
    }
  }

  function pointerRatio(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  function orientedPoint(point: { x: number; y: number }) {
    if (tool === 'crop') return point
    const crop = latest.current.geometry.crop
    return {
      x: crop.x + point.x * crop.width,
      y: crop.y + point.y * crop.height,
    }
  }

  function onCanvasDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!selected || tool === 'color') return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Синтетическое событие не всегда позволяет захватить указатель.
    }
    const point = pointerRatio(event)
    if (tool === 'crop') {
      beginGesture()
      cropStart.current = point
      const next = cloneRecipe(gesture.current ?? latest.current)
      next.geometry.crop = { x: point.x, y: point.y, width: 0.02, height: 0.02 }
      replacePresent(next)
      return
    }
    if (tool !== 'heal' && tool !== 'dodge' && tool !== 'burn') return
    beginGesture()
    stroke.current = {
      id: crypto.randomUUID(),
      tool,
      points: [orientedPoint(point)],
      radius: brushRadius,
      strength: brushStrength,
    }
    const next = cloneRecipe(gesture.current ?? latest.current)
    next.strokes = [...next.strokes, stroke.current]
    replacePresent(next)
  }

  function onCanvasMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const captured = event.currentTarget.hasPointerCapture(event.pointerId)
    if (!captured && !stroke.current && !cropStart.current) return
    const point = pointerRatio(event)
    if (tool === 'crop' && cropStart.current) {
      const start = cropStart.current
      const x = Math.min(start.x, point.x)
      const y = Math.min(start.y, point.y)
      const next = cloneRecipe(gesture.current ?? latest.current)
      next.geometry.crop = {
        x,
        y,
        width: Math.max(0.02, Math.abs(point.x - start.x)),
        height: Math.max(0.02, Math.abs(point.y - start.y)),
      }
      replacePresent(next)
      return
    }
    if (!stroke.current) return
    stroke.current = {
      ...stroke.current,
      points: [...stroke.current.points, orientedPoint(point)],
    }
    const next = cloneRecipe(gesture.current ?? latest.current)
    next.strokes = [
      ...next.strokes.filter((item) => item.id !== stroke.current?.id),
      stroke.current,
    ]
    replacePresent(next)
  }

  function onCanvasUp() {
    cropStart.current = null
    stroke.current = null
    commitGesture()
  }

  const fit =
    frame.width > 0 && stageSize.width > 40
      ? Math.min(
          (stageSize.width - 28) / frame.width,
          (stageSize.height - 28) / frame.height,
        )
      : 1
  const displayScale = Math.max(0.05, fit * zoom)
  const tools: Array<{ id: EditorTool; label: string; icon: ReactNode }> = [
    { id: 'color', label: 'Цвет', icon: <Sun size={18} /> },
    { id: 'crop', label: 'Кадр', icon: <Crop size={18} /> },
    { id: 'heal', label: 'Лечение', icon: <FirstAid size={18} /> },
    { id: 'dodge', label: 'Свет', icon: <SunDim size={18} /> },
    { id: 'burn', label: 'Тень', icon: <Moon size={18} /> },
  ]

  return (
    <section className="editor-shell">
      <header className="editor-topbar">
        <div className="editor-title">
          <strong>{selected?.file.name ?? 'Нет кадра'}</strong>
          <span>
            {rendering ? 'Обновление предпросмотра' : 'Живой предпросмотр'}
            {' · '}
            {Math.round(displayScale * 100)}%
          </span>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Отменить"
            disabled={!history || history.past.length === 0}
            onClick={() =>
              selected &&
              history &&
              onChangeHistory(selected.id, historyUndo(history))
            }
          >
            <ArrowUUpLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Вернуть"
            disabled={!history || history.future.length === 0}
            onClick={() =>
              selected &&
              history &&
              onChangeHistory(selected.id, historyRedo(history))
            }
          >
            <ArrowUUpRight size={16} />
          </button>
          <button type="button" className="icon-button" aria-label="Уменьшить" onClick={() => setZoom((value) => Math.max(0.25, value / 1.25))}>
            <span>−</span>
          </button>
          <button type="button" className="text-button" onClick={() => setZoom(1)}>
            По кадру
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setZoom(fit > 0 ? 1 / fit : 1)}
          >
            100%
          </button>
          <button type="button" className="icon-button" aria-label="Увеличить" onClick={() => setZoom((value) => Math.min(8, value * 1.25))}>
            <span>+</span>
          </button>
          <button
            type="button"
            className={`text-button ${compare ? 'active' : ''}`}
            onClick={() => setCompare((value) => !value)}
          >
            До / после
          </button>
          <button type="button" className="text-button" disabled={!selected} onClick={() => exportPhoto('jpeg')}>
            <DownloadSimple size={15} /> JPG
          </button>
          <button type="button" className="text-button" disabled={!selected} onClick={() => exportPhoto('png')}>
            <DownloadSimple size={15} /> PNG
          </button>
        </div>
      </header>

      <aside className="editor-tools" aria-label="Инструменты редактора">
        {tools.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tool === item.id ? 'active' : ''}
            onClick={() => setTool(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </aside>

      <div className="editor-stage" ref={stageRef}>
        {selected ? (
          <div
            className="editor-canvas-wrap"
            style={{ width: frame.width * displayScale, height: frame.height * displayScale }}
          >
            <canvas
              ref={beforeRef}
              className="editor-canvas"
              style={{ visibility: compare ? 'visible' : 'hidden' }}
            />
            <canvas
              ref={afterRef}
              className={`editor-canvas ${tool === 'color' ? '' : 'interactive'}`}
              style={compare ? { clipPath: `inset(0 0 0 ${comparison}%)` } : undefined}
              onPointerDown={onCanvasDown}
              onPointerMove={onCanvasMove}
              onPointerUp={onCanvasUp}
            />
            {compare && (
              <>
                <div className="compare-line" style={{ left: `${comparison}%` }} />
                <input
                  className="compare-range"
                  type="range"
                  min="0"
                  max="100"
                  value={comparison}
                  aria-label="Сравнить до и после"
                  onChange={(event) => setComparison(Number(event.target.value))}
                />
              </>
            )}
            {tool === 'crop' && (
              <div
                className="crop-rect"
                style={{
                  left: `${recipe.geometry.crop.x * 100}%`,
                  top: `${recipe.geometry.crop.y * 100}%`,
                  width: `${recipe.geometry.crop.width * 100}%`,
                  height: `${recipe.geometry.crop.height * 100}%`,
                }}
              />
            )}
          </div>
        ) : (
          <div className="empty-preview">
            <Images size={36} />
            <h2>Выберите кадр для редактора</h2>
            <p>Фотографии общие с режимом «Серия». Оригинал не изменяется.</p>
            <button type="button" className="secondary-button inline" onClick={() => fileInput.current?.click()}>
              <Plus size={18} /> Добавить фотографии
            </button>
          </div>
        )}
      </div>

      <aside className="editor-params">
        {tool === 'color' && (
          <>
            <div className="panel-heading">
              <div>
                <span className="step">Цвет и свет</span>
                <h2>Глобальная коррекция</h2>
              </div>
            </div>
            {(
              [
                ['exposure', 'Экспозиция', -2, 2, 0.05, 2],
                ['contrast', 'Контраст', -100, 100, 1, 0],
                ['highlights', 'Света', -100, 100, 1, 0],
                ['shadows', 'Тени', -100, 100, 1, 0],
                ['whites', 'Белые', -100, 100, 1, 0],
                ['blacks', 'Чёрные', -100, 100, 1, 0],
                ['temperature', 'Температура', -100, 100, 1, 0],
                ['tint', 'Оттенок', -100, 100, 1, 0],
                ['saturation', 'Насыщенность', -100, 100, 1, 0],
                ['vibrance', 'Vibrance', -100, 100, 1, 0],
              ] as const
            ).map(([key, label, min, max, step, digits]) => (
              <EditorSlider
                key={key}
                label={label}
                value={recipe.adjustments[key]}
                min={min}
                max={max}
                step={step}
                digits={digits}
                onPreview={(value) => changeAdjustment(key, value)}
                onCommit={commitGesture}
              />
            ))}
            <div className="panel-heading compact">
              <div>
                <span className="step">HSL</span>
                <h2>{bandLabels[band]}</h2>
              </div>
            </div>
            <div className="band-list">
              {hslBands.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={band === item ? 'active' : ''}
                  onClick={() => setBand(item)}
                >
                  {bandLabels[item]}
                </button>
              ))}
            </div>
            {(
              [
                ['hue', 'Оттенок'],
                ['saturation', 'Насыщенность'],
                ['luminance', 'Яркость'],
              ] as const
            ).map(([key, label]) => (
              <EditorSlider
                key={key}
                label={label}
                value={recipe.hsl[band][key]}
                min={-100}
                max={100}
                step={1}
                onPreview={(value) => {
                  beginGesture()
                  const next = cloneRecipe(gesture.current ?? latest.current)
                  next.hsl[band][key] = value
                  replacePresent(next)
                }}
                onCommit={commitGesture}
              />
            ))}
            <div className="panel-heading compact">
              <div>
                <span className="step">Кривая</span>
                <h2>Тон</h2>
              </div>
            </div>
            <CurveEditor
              points={recipe.curve}
              onPreview={(points) => {
                beginGesture()
                const next = cloneRecipe(gesture.current ?? latest.current)
                next.curve = points
                replacePresent(next)
              }}
              onCommit={commitGesture}
            />
            <p className="beta-note">Двойной щелчок добавляет точку, двойной щелчок по точке удаляет её.</p>
            {(
              [
                ['sharpness', 'Резкость', 0, 100],
                ['denoise', 'Шумоподавление', 0, 100],
                ['skinSmoothing', 'Мягкость кожи', 0, 100],
                ['skinTexture', 'Сохранение текстуры', 0, 100],
              ] as const
            ).map(([key, label, min, max]) => (
              <EditorSlider
                key={key}
                label={label}
                value={recipe.adjustments[key]}
                min={min}
                max={max}
                step={1}
                suffix="%"
                signed={false}
                onPreview={(value) => changeAdjustment(key, value)}
                onCommit={commitGesture}
              />
            ))}
          </>
        )}

        {tool === 'crop' && (
          <>
            <div className="panel-heading">
              <div>
                <span className="step">Геометрия</span>
                <h2>Кадр</h2>
              </div>
            </div>
            <p className="beta-note">Потяните по холсту, чтобы задать кадрирование. Поворот и масштаб входят в рецепт.</p>
            <div className="geometry-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const next = cloneRecipe(recipe)
                  next.geometry.rotation -= 90
                  if (selected && history) {
                    onChangeHistory(selected.id, historyPushSafe(history, next))
                  }
                }}
              >
                <ArrowCounterClockwise size={16} /> −90°
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const next = cloneRecipe(recipe)
                  next.geometry.rotation += 90
                  if (selected && history) {
                    onChangeHistory(selected.id, historyPushSafe(history, next))
                  }
                }}
              >
                <ArrowClockwise size={16} /> +90°
              </button>
            </div>
            <EditorSlider
              label="Поворот"
              value={recipe.geometry.rotation}
              min={-180}
              max={180}
              step={1}
              suffix="°"
              onPreview={(value) => {
                beginGesture()
                const next = cloneRecipe(gesture.current ?? latest.current)
                next.geometry.rotation = value
                replacePresent(next)
              }}
              onCommit={commitGesture}
            />
            <EditorSlider
              label="Масштаб"
              value={Math.round(recipe.geometry.scale * 100)}
              min={25}
              max={200}
              step={1}
              suffix="%"
              signed={false}
              onPreview={(value) => {
                beginGesture()
                const next = cloneRecipe(gesture.current ?? latest.current)
                next.geometry.scale = value / 100
                replacePresent(next)
              }}
              onCommit={commitGesture}
            />
            <button
              type="button"
              className="reset-tools"
              onClick={() => {
                if (!selected || !history) return
                const next = cloneRecipe(recipe)
                next.geometry = defaultRecipe().geometry
                onChangeHistory(selected.id, historyPushSafe(history, next))
              }}
            >
              Сбросить кадр
            </button>
          </>
        )}

        {(tool === 'heal' || tool === 'dodge' || tool === 'burn') && (
          <>
            <div className="panel-heading">
              <div>
                <span className="step">Локально</span>
                <h2>
                  {tool === 'heal' ? 'Лечение' : tool === 'dodge' ? 'Осветление' : 'Затемнение'}
                </h2>
              </div>
            </div>
            <p className="beta-note">
              Мазки сохраняются только на этом кадре. В пресет и на другие фотографии они не копируются.
            </p>
            <EditorSlider
              label="Радиус"
              value={Math.round(brushRadius * 1000) / 10}
              min={1}
              max={12}
              step={0.5}
              digits={1}
              suffix="%"
              signed={false}
              onPreview={(value) => setBrushRadius(value / 100)}
              onCommit={() => undefined}
            />
            <EditorSlider
              label="Сила"
              value={brushStrength}
              min={1}
              max={100}
              step={1}
              suffix="%"
              signed={false}
              onPreview={setBrushStrength}
              onCommit={() => undefined}
            />
            <button
              type="button"
              className="reset-tools"
              onClick={() => {
                if (!selected || !history) return
                const next = cloneRecipe(recipe)
                next.strokes = []
                onChangeHistory(selected.id, historyPushSafe(history, next))
              }}
            >
              Удалить локальные мазки
            </button>
          </>
        )}

        <div className="panel-divider" />
        <div className="panel-heading compact">
          <div>
            <span className="step">Пресеты</span>
            <h2>Стиль серии</h2>
          </div>
        </div>
        <label className="preset-name">
          Название
          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={!selected}
          onClick={() =>
            onSavePreset(
              presetFromRecipe(presetName.trim() || 'Мой стиль', latest.current),
            )
          }
        >
          <FloppyDisk size={16} /> Сохранить пресет
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!selected || photos.length === 0}
          onClick={() =>
            onApplyToSeries(
              presetFromRecipe(presetName.trim() || 'Мой стиль', latest.current),
            )
          }
        >
          <Stack size={16} /> Применить к серии
        </button>
        <div className="preset-list">
          {presets.map((preset) => (
            <div key={preset.id} className="preset-row">
              <button
                type="button"
                onClick={() => {
                  if (!selected || !history) return
                  onChangeHistory(
                    selected.id,
                    historyPushSafe(history, applyPreset(history.present, preset)),
                  )
                }}
              >
                {preset.name}
              </button>
              <button
                type="button"
                aria-label={`Удалить пресет ${preset.name}`}
                onClick={() => onDeletePreset(preset.id)}
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
        {message && <p className="inline-message">{message}</p>}
      </aside>

      <footer className="editor-film" aria-label="Лента фотографий">
        <button type="button" className="film-add" onClick={() => fileInput.current?.click()}>
          <Plus size={18} />
        </button>
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            className={`film-item ${selected?.id === photo.id ? 'selected' : ''}`}
            onClick={() => onSelect(photo.id)}
          >
            <img src={photo.sourceUrl} alt="" />
            <span>{photo.file.name}</span>
            <span
              className="film-remove"
              role="button"
              tabIndex={0}
              aria-label={`Удалить ${photo.file.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onRemove(photo.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRemove(photo.id)
              }}
            >
              <Trash size={12} />
            </span>
          </button>
        ))}
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png"
          multiple
          onChange={(event) => event.target.files && onAdd(event.target.files)}
        />
      </footer>
    </section>
  )
}

function historyPushSafe(history: History<EditRecipe>, next: EditRecipe) {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history
  return {
    past: [...history.past, history.present],
    present: next,
    future: [] as EditRecipe[],
  }
}
