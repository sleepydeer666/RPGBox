const { app, BrowserWindow, dialog, ipcMain, protocol, session } = require('electron')
const path = require('node:path')
const { PORTABLE_SCHEME, createPortableStorage } = require('./portable-storage.cjs')

const isDevelopment = process.argv.includes('--dev')
const developmentUrl = 'http://127.0.0.1:5173/index.html'
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) app.quit()

protocol.registerSchemesAsPrivileged([{
  scheme: PORTABLE_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

function portableRoot() {
  return isDevelopment ? path.join(app.getAppPath(), '.desktop-data') : path.dirname(process.execPath)
}

function registerPortableStorageHandlers(storage) {
  ipcMain.handle('portable-storage:read-value', (_event, key) => storage.readValue(key))
  ipcMain.handle('portable-storage:write-value', (_event, key, value) => storage.writeValue(key, value))
  ipcMain.handle('portable-storage:save-portrait', (_event, payload) => storage.savePortrait(payload))
  ipcMain.handle('portable-storage:read-portrait', (_event, uri) => storage.readPortrait(uri))
  ipcMain.handle('portable-storage:delete-portrait', (_event, uri) => storage.deletePortrait(uri))
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#111310',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.removeMenu()

  if (isDevelopment) {
    void window.loadURL(developmentUrl)
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  const storage = createPortableStorage(portableRoot())
  try {
    await storage.ensure()
  } catch (error) {
    dialog.showErrorBox('RPGBox 无法写入数据目录', `请将 RPGBox 解压到可写目录后重新运行。\n\n${error instanceof Error ? error.message : String(error)}`)
    app.quit()
    return
  }
  registerPortableStorageHandlers(storage)
  protocol.handle(PORTABLE_SCHEME, (request) => storage.portraitResponse(request.url))
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
