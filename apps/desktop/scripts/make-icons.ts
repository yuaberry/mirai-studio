/**
 * Rasterizes build/icon.svg into the icon set electron-builder needs.
 * Uses sharp (librsvg) — full SVG gradient support.
 */
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

mkdirSync('build/icons', { recursive: true })

for (const size of [512, 256, 128, 64, 32]) {
  await sharp('build/icon.svg', { density: Math.max(72, (size * 72) / 512) })
    .resize(size, size)
    .png()
    .toFile(`build/icons/${size}x${size}.png`)
  console.log(`  ok ${size}x${size}.png`)
}

await sharp('build/icon.svg', { density: 72 })
  .resize(512, 512)
  .png()
  .toFile('build/icon.png')
console.log('  ok build/icon.png (512)')
console.log('done')
