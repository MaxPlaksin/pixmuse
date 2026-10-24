export interface GlobalAdjustments {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temperature: number
  tint: number
  saturation: number
  vibrance: number
  sharpness: number
  denoise: number
  skinSmoothing: number
  skinTexture: number
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Geometry {
  rotation: number
  scale: number
  crop: CropRect
}

export interface CurvePoint {
  x: number
  y: number
}

export const hslBands = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const

export type HslBand = (typeof hslBands)[number]

export interface HslAdjustment {
  hue: number
  saturation: number
  luminance: number
}

export type HslRecipe = Record<HslBand, HslAdjustment>

export type StrokeTool = 'heal' | 'dodge' | 'burn'

export interface LocalStroke {
  id: string
  tool: StrokeTool
  points: Array<{ x: number; y: number }>
  radius: number
  strength: number
}

export interface EditRecipe {
  adjustments: GlobalAdjustments
  geometry: Geometry
  curve: CurvePoint[]
  hsl: HslRecipe
  strokes: LocalStroke[]
}

export interface ProcessingPreset {
  id: string
  name: string
  adjustments: GlobalAdjustments
  curve: CurvePoint[]
  hsl: HslRecipe
}

const neutralHsl = (): HslAdjustment => ({
  hue: 0,
  saturation: 0,
  luminance: 0,
})

export function defaultRecipe(): EditRecipe {
  return {
    adjustments: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      temperature: 0,
      tint: 0,
      saturation: 0,
      vibrance: 0,
      sharpness: 0,
      denoise: 0,
      skinSmoothing: 0,
      skinTexture: 70,
    },
    geometry: {
      rotation: 0,
      scale: 1,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    },
    curve: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    hsl: {
      red: neutralHsl(),
      orange: neutralHsl(),
      yellow: neutralHsl(),
      green: neutralHsl(),
      aqua: neutralHsl(),
      blue: neutralHsl(),
      purple: neutralHsl(),
      magenta: neutralHsl(),
    },
    strokes: [],
  }
}

export function cloneRecipe(recipe: EditRecipe): EditRecipe {
  return structuredClone(recipe)
}

export function recipeIsIdentity(recipe: EditRecipe): boolean {
  const baseline = defaultRecipe()
  const current = cloneRecipe(recipe)
  current.adjustments.skinTexture = baseline.adjustments.skinTexture
  return JSON.stringify(current) === JSON.stringify(baseline)
}

export function presetFromRecipe(
  name: string,
  recipe: EditRecipe,
): ProcessingPreset {
  return {
    id: crypto.randomUUID(),
    name,
    adjustments: structuredClone(recipe.adjustments),
    curve: structuredClone(recipe.curve),
    hsl: structuredClone(recipe.hsl),
  }
}

export function applyPreset(
  recipe: EditRecipe,
  preset: ProcessingPreset,
): EditRecipe {
  const next = cloneRecipe(recipe)
  next.adjustments = structuredClone(preset.adjustments)
  next.curve = structuredClone(preset.curve)
  next.hsl = structuredClone(preset.hsl)
  return next
}

export function readPresets(storage: Pick<Storage, 'getItem'>): ProcessingPreset[] {
  const raw = storage.getItem('pixmuse-presets')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as ProcessingPreset[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writePresets(
  storage: Pick<Storage, 'setItem'>,
  presets: ProcessingPreset[],
): void {
  storage.setItem('pixmuse-presets', JSON.stringify(presets))
}
