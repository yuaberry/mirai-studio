/**
 * Mirai Studio — main process entry.
 * Window management, app lifecycle, crash-safe shutdown.
 */
import { app, BrowserWindow, dialog, screen } from 'electron'
import { join } from 'node:path'
import { bootstrap, type Container } from './bootstrap'
import { registerIpcHandlers } from './ipc/register'
import { declareAssetScheme, registerAssetProtocol } from './assets/assetProtocol'

// Security defaults — the renderer is untrusted.
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

// Custom scheme must be declared before the app is ready.
declareAssetScheme()

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
    registerAssetProtocol(() => container?.projects.current()?.storyboard ?? null)
    createWindow(container)
    app.on('activate', () => {
      // macOS: re-create the window on dock click.
      if (BrowserWindow.getAllWindows().length === 0 && container) createWindow(container)
    })
  })
}

function createWindow(c: Container): void {
  // ADAPTIVE WINDOW: fit the user's actual screen. On laptops (1366×768 etc.)
  // the old fixed 1440×900 exceeded the display — the window was literally
  // larger than the screen. Now we clamp to the work area and lower minimums.
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const maxWidth = Math.max(720, workArea.width - 40)
  const maxHeight = Math.max(520, workArea.height - 40)
  const smallScreen = workArea.width < 1180 || workArea.height < 800

  mainWindow = new BrowserWindow({
    width: Math.min(1440, maxWidth),
    height: Math.min(900, maxHeight),
    minWidth: Math.min(1080, Math.min(940, maxWidth)),
    minHeight: Math.min(720, Math.min(600, maxHeight)),
    useContentSize: true,
    center: true,
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

  if (smallScreen) {
    mainWindow.maximize()
  }

  // HARD CLAMP: re-assert the bounds after creation — some window managers
  // restore previous-session sizes; this guarantees the window fits, always.
  mainWindow.once('ready-to-show', () => {
    const wa = screen.getPrimaryDisplay().workAreaSize
    const [w = 0, h = 0] = mainWindow!.getSize()
    if (w > wa.width || h > wa.height) {
      mainWindow!.setSize(Math.min(w, Math.max(720, wa.width - 24)), Math.min(h, Math.max(520, wa.height - 24)))
      mainWindow!.center()
    }
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
