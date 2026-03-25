import { copyFileSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'fs'
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

// Merge package.json fields into manifest.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const manifest = JSON.parse(readFileSync('./src/manifest.json', 'utf-8'))

if (pkg.version) manifest.version = pkg.version
if (pkg.description) manifest.description = pkg.description
if (pkg.author) {
  const author = typeof pkg.author === 'string'
    ? { name: pkg.author }
    : pkg.author
  manifest.vendor = {
    ...manifest.vendor,
    ...(author.name && { name: author.name }),
    ...(author.email && { email: author.email }),
    ...(author.url && { url: author.url })
  }
}

writeFileSync('./dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log('✓ Copied package.json + settings.json → dist/')
console.log(`✓ Generated manifest.json (v${manifest.version})`)

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

