import { copyFileSync, createWriteStream, mkdirSync } from 'fs'
import archiver from 'archiver'

const entries = [
  'src/auto-create-linked-issue.ts',
  'src/sync-state-to-issue.ts',
  'src/sync-comment-to-issue.ts'
]

mkdirSync('./dist', { recursive: true })

for (const entry of entries) {
  await Bun.build({
    entrypoints: [entry],
    outdir: './dist',
    target: 'node',
    format: 'cjs',
    minify: false,
    sourcemap: 'none',
    external: ['@jetbrains/youtrack-scripting-api']
  })
  console.log(`✓ Built ${entry}`)
}

copyFileSync('./package.json', './dist/package.json')
copyFileSync('./src/settings.json', './dist/settings.json')
copyFileSync('./src/manifest.json', './dist/manifest.json')
console.log('✓ Copied package.json + settings.json + manifest.json → dist/')

if (process.argv.includes('--zip')) {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream('./helpdesk-sync.zip')
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => {
      console.log(`✓ Created helpdesk-sync.zip (${archive.pointer()} bytes)`)
      resolve()
    })
    archive.on('error', reject)

    archive.pipe(output)
    archive.directory('./dist', false)
    archive.finalize()
  })
}

