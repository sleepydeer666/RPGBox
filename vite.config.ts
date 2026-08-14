import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

export default defineConfig({
  plugins: [react(), bundledDefaultPrompt()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
