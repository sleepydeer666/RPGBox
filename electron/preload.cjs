const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('rpgboxDesktop', {
  platform: 'desktop',
  version: process.versions.electron,
  readValue: (key) => ipcRenderer.invoke('portable-storage:read-value', key),
  writeValue: (key, value) => ipcRenderer.invoke('portable-storage:write-value', key, value),
  readDataFile: (path) => ipcRenderer.invoke('portable-storage:read-data-file', path),
  writeDataFile: (path, value) => ipcRenderer.invoke('portable-storage:write-data-file', path, value),
  savePortrait: (gameId, characterId, fileName, base64) => ipcRenderer.invoke('portable-storage:save-portrait', { gameId, characterId, fileName, base64 }),
  readPortrait: (uri) => ipcRenderer.invoke('portable-storage:read-portrait', uri),
  deletePortrait: (uri) => ipcRenderer.invoke('portable-storage:delete-portrait', uri),
})
