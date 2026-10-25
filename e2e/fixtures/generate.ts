import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const output = join(here, 'generated')

function scene(width: number, height: number, left: string, right: string) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="background"><stop stop-color="${left}"/><stop offset="1" stop-color="${right}"/></linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#background)"/>
      <circle cx="${width * 0.5}" cy="${height * 0.44}" r="${Math.min(width, height) * 0.22}" fill="#e9b79e"/>
      <rect x="${width * 0.34}" y="${height * 0.64}" width="${width * 0.32}" height="${height * 0.26}" rx="32" fill="#553f66"/>
      <circle cx="${width * 0.43}" cy="${height * 0.41}" r="10" fill="#302735"/>
      <circle cx="${width * 0.57}" cy="${height * 0.41}" r="10" fill="#302735"/>
    </svg>
  `)
}

async function generate() {
  await mkdir(output, { recursive: true })

  await sharp(scene(800, 600, '#f3c6a5', '#9f557f'))
    .jpeg({ quality: 88 })
    .withMetadata({ orientation: 1 })
    .toFile(join(output, 'reference-warm.jpg'))

  await sharp(scene(800, 600, '#7db2d8', '#534c8c'))
    .jpeg({ quality: 88 })
    .withMetadata({ orientation: 1 })
    .toFile(join(output, 'series-cool.jpg'))

  await sharp(scene(640, 480, '#81a7c9', '#d4b4c8'))
    .jpeg({ quality: 88 })
    .withMetadata({ orientation: 6 })
    .toFile(join(output, 'oriented-6.jpg'))

  const alphaSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
      <defs><radialGradient id="a"><stop stop-color="#ffb6cf"/><stop offset="1" stop-color="#8664aa"/></radialGradient></defs>
      <circle cx="256" cy="256" r="210" fill="url(#a)"/>
      <circle cx="210" cy="220" r="18" fill="#432f4f"/>
      <circle cx="302" cy="220" r="18" fill="#432f4f"/>
    </svg>
  `)
  await sharp(alphaSvg).png().toFile(join(output, 'alpha-cutout.png'))

  await sharp(scene(6000, 4000, '#6c91b5', '#d49bb4'))
    .jpeg({ quality: 82 })
    .withMetadata({ orientation: 1 })
    .toFile(join(output, 'stress-6000x4000.jpg'))

  await writeFile(
    join(output, 'manifest.json'),
    JSON.stringify(
      {
        'reference-warm.jpg': { width: 800, height: 600, orientation: 1 },
        'series-cool.jpg': { width: 800, height: 600, orientation: 1 },
        'oriented-6.jpg': { width: 640, height: 480, orientation: 6 },
        'alpha-cutout.png': { width: 512, height: 512, hasAlpha: true },
        'stress-6000x4000.jpg': { width: 6000, height: 4000, megapixels: 24 },
      },
      null,
      2,
    ),
  )
}

await generate()
