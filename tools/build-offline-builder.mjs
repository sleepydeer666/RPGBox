import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDirectory = resolve(repositoryRoot, 'artifacts/offline-builder-build')
const sourceHtmlPath = resolve(buildDirectory, 'builder.html')
const packageDirectory = resolve(repositoryRoot, 'PackageBuilder')
const outputPath = resolve(packageDirectory, 'index.html')

let html = await readFile(sourceHtmlPath, 'utf8')

for (const match of Array.from(html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/gu))) {
  const cssPath = resolveAssetPath(match[1])
  const css = (await readFile(cssPath, 'utf8')).replace(/<\/style/giu, '<\\/style')
  html = html.replace(match[0], () => `<style>${css}</style>`)
}

html = html.replace(/\s*<link\b[^>]*\brel="modulepreload"[^>]*>/gu, '')

for (const match of Array.from(html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/gu))) {
  const scriptPath = resolveAssetPath(match[2])
  const script = (await readFile(scriptPath, 'utf8')).replace(/<\/script/giu, '<\\/script')
  html = html.replace(match[0], () => `<script type="module">${script}</script>`)
}

const documentResourceTags = html.match(/^[ \t]*<(?:script|link)\b[^>]*>/gmu) ?? []
if (documentResourceTags.some((tag) => /(?:src|href)="(?!data:|#)/iu.test(tag))) {
  throw new Error('Offline builder still contains an external resource reference')
}
if ((html.match(/<\/script>/giu) ?? []).length !== 1) {
  throw new Error('Offline builder contains an invalid script boundary')
}

await mkdir(packageDirectory, { recursive: true })
await writeFile(outputPath, html, 'utf8')
await rm(buildDirectory, { recursive: true, force: true })
console.log(`Created ${outputPath}`)

function resolveAssetPath(reference) {
  const relativePath = reference.replace(/^\.\//u, '').replace(/^\//u, '')
  const resolved = resolve(buildDirectory, relativePath)
  const pathFromBuildDirectory = relative(buildDirectory, resolved)
  if (pathFromBuildDirectory.startsWith('..') || isAbsolute(pathFromBuildDirectory)) {
    throw new Error(`Asset path escapes build directory: ${reference}`)
  }
  return resolved
}
