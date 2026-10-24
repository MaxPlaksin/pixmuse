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

export function copyJpegMetadata(
  source: Uint8Array,
  rendered: Uint8Array,
): Uint8Array {
  const metadata = appSegments(source)
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
