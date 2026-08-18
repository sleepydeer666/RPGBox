import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'

function bundledDefaultPrompt() {
  return {
    name: 'bundle-default-prompt',
    generateBundle() {
      const sourcePath = resolve(process.cwd(), 'defaultprompt.txt')
      if (!existsSync(sourcePath)) return
      this.emitFile({
        type: 'asset',
        fileName: 'defaultprompt.txt',
        source: readFileSync(sourcePath),
      })
    },
  }
}

function bundledRpgAssets() {
  return {
    name: 'bundle-extracted-rpg-assets',
    async generateBundle() {
      const sourceDirectory = resolve(process.cwd(), 'src/assets/default-rpg')
      const fileNames = existsSync(sourceDirectory)
        ? readdirSync(sourceDirectory).filter((fileName) => fileName.toLowerCase().endsWith('.rpgbox')).sort()
        : []
      const packages = [] as Array<{
        key: string
        fileName: string
        title: string
        hasNsfw: boolean
        xmlUrl: string
        portraits: Record<string, string>
      }>

      for (const [index, fileName] of fileNames.entries()) {
        const zip = await JSZip.loadAsync(readFileSync(resolve(sourceDirectory, fileName)))
        const xml = zip.file('rpg.xml')
        if (!xml) throw new Error(`${fileName} is missing rpg.xml`)
        const xmlText = await xml.async('string')
        const packageDirectory = `bundled-rpg/package-${index + 1}`
        const xmlFileName = `${packageDirectory}/rpg.xml`
        this.emitFile({ type: 'asset', fileName: xmlFileName, source: xmlText })
        const portraits: Record<string, string> = {}
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !entry.name.startsWith('portraits/') || entry.name.includes('..')) continue
          const assetFileName = `${packageDirectory}/${entry.name}`
          this.emitFile({ type: 'asset', fileName: assetFileName, source: await entry.async('uint8array') })
          portraits[entry.name] = `/${assetFileName}`
        }
        packages.push({
          key: `file:${fileName}`,
          fileName,
          title: decodeXmlAttribute(xmlText.match(/<rpgbox\b[^>]*\btitle="([^"]*)"/u)?.[1] ?? fileName.replace(/\.rpgbox$/iu, '')),
          hasNsfw: /<section\s+name="nsfw"\s/u.test(xmlText),
          xmlUrl: `/${xmlFileName}`,
          portraits,
        })
      }

      this.emitFile({
        type: 'asset',
        fileName: 'bundled-rpg/manifest.json',
        source: JSON.stringify({ packages }),
      })
    },
  }
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
}

export default defineConfig({
  plugins: [react(), bundledDefaultPrompt(), bundledRpgAssets()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(process.cwd(), 'index.html'),
        builder: resolve(process.cwd(), 'builder.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
