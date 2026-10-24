function appSegments(jpeg: Uint8Array): Uint8Array[] {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return []
  const segments: Uint8Array[] = []
  let offset = 2

  while (offset + 4 <= jpeg.length && jpeg[offset] === 0xff) {
    const marker = jpeg[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = (jpeg[offset + 2] << 8) | jpeg[offset + 3]
    const size = 2 + length
    if (length < 2 || offset + size > jpeg.length) break
    if (marker === 0xe1 || marker === 0xe2) {
      segments.push(jpeg.slice(offset, offset + size))
    }
    offset += size
  }

  return segments
}

function stripAppMetadata(jpeg: Uint8Array): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg
  const parts: Uint8Array[] = [jpeg.slice(0, 2)]
  let offset = 2

  while (offset + 4 <= jpeg.length && jpeg[offset] === 0xff) {
    const marker = jpeg[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = (jpeg[offset + 2] << 8) | jpeg[offset + 3]
    const size = 2 + length
    if (length < 2 || offset + size > jpeg.length) break
    if (marker !== 0xe1 && marker !== 0xe2) parts.push(jpeg.slice(offset, offset + size))
    offset += size
  }

  parts.push(jpeg.slice(offset))
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    output.set(part, cursor)
    cursor += part.length
  }
  return output
}

function exifView(segment: Uint8Array):
  | { view: DataView; little: boolean; tiff: number }
  | undefined {
  if (segment.length < 16 || segment[1] !== 0xe1) return undefined
  const payload = 4
  const exif =
    segment[payload] === 0x45 &&
    segment[payload + 1] === 0x78 &&
    segment[payload + 2] === 0x69 &&
    segment[payload + 3] === 0x66 &&
    segment[payload + 4] === 0 &&
    segment[payload + 5] === 0
  if (!exif) return undefined
  const tiff = payload + 6
  const little = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49
  const big = segment[tiff] === 0x4d && segment[tiff + 1] === 0x4d
  if (!little && !big) return undefined
  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength)
  if (view.getUint16(tiff + 2, little) !== 42) return undefined
  return { view, little, tiff }
}

function orientationEntry(segment: Uint8Array): number | undefined {
  const parsed = exifView(segment)
  if (!parsed) return undefined
  const { view, little, tiff } = parsed
  const ifd = tiff + view.getUint32(tiff + 4, little)
  if (ifd + 2 > segment.length) return undefined
  const count = view.getUint16(ifd, little)
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > segment.length) return undefined
    const tag = view.getUint16(entry, little)
    const type = view.getUint16(entry + 2, little)
    const components = view.getUint32(entry + 4, little)
    if (tag === 0x0112 && type === 3 && components === 1) return entry
  }
  return undefined
}

export function readJpegOrientation(jpeg: Uint8Array): number {
  const segment = appSegments(jpeg).find((item) => item[1] === 0xe1)
  if (!segment) return 1
  const entry = orientationEntry(segment)
  const parsed = exifView(segment)
  if (entry === undefined || !parsed) return 1
  return parsed.view.getUint16(entry + 8, parsed.little)
}

function normalizeOrientation(segment: Uint8Array): Uint8Array {
  const entry = orientationEntry(segment)
  const parsed = exifView(segment)
  if (entry === undefined || !parsed) return segment
  if (parsed.view.getUint16(entry + 8, parsed.little) === 1) return segment
  const copy = segment.slice()
  new DataView(copy.buffer, copy.byteOffset, copy.byteLength).setUint16(
    entry + 8,
    1,
    parsed.little,
  )
  return copy
}

export function copyJpegMetadata(
  source: Uint8Array,
  rendered: Uint8Array,
): Uint8Array {
  const metadata = appSegments(source)
    .filter((segment) => segment[1] !== 0xe2)
    .map((segment) => normalizeOrientation(segment))
  if (
    metadata.length === 0 ||
    rendered.length < 2 ||
    rendered[0] !== 0xff ||
    rendered[1] !== 0xd8
  ) {
    return rendered
  }

  const stripped = stripAppMetadata(rendered)
  const total =
    stripped.length + metadata.reduce((sum, segment) => sum + segment.length, 0)
  const output = new Uint8Array(total)
  output.set(stripped.subarray(0, 2), 0)
  let cursor = 2
  for (const segment of metadata) {
    output.set(segment, cursor)
    cursor += segment.length
  }
  output.set(stripped.subarray(2), cursor)
  return output
}
