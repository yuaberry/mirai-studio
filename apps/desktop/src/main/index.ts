/**
 * Mirai Studio — main process entry.
 * Window management, app lifecycle, crash-safe shutdown.
 */
import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { bootstrap, type Container } from './bootstrap'
import { registerIpcHandlers } from './ipc/register'

// Security defaults — the renderer is untrusted.
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let mainWindow: BrowserWindow | null = null
let container: Container | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    // A boot failure must be a useful dialog, never an unhandled rejection (spec §26).
    try {
      container = bootstrap()
    } catch (err) {
      const message = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err)
      dialog.showErrorBox(
        'Mirai Studio failed to start',
        `The local database could not be initialized.\n\n${message}`,
      )
      app.quit()
      return
    }
    registerIpcHandlers(container)
    createWindow(container)
    app.on('activate', () => {
      // macOS: re-create the window on dock click.
      if (BrowserWindow.getAllWindows().length === 0 && container) createWindow(container)
    })
  })
}

function createWindow(c: Container): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#0a0c10',
    title: 'Mirai Studio',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  })

  c.emitter.attach(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
    c.emitter.detach()
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    c.logger.info('SYSTEM', 'Main window ready')
  })

  // External links open in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void import('electron').then(({ shell }) => shell.openExternal(url))
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Graceful shutdown: close project queue, flush logs, close DBs. */
let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown || !container) return
  shuttingDown = true
  event.preventDefault()
  void container
    .shutdown()
    .then(() => {
      app.exit(0)
    })
    .catch(() => {
      app.exit(0)
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
