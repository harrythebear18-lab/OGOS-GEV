import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { registerWindow } from './windows'
import { liveData } from './services/live/live-data'
import { vrManager } from './services/vr/vr-manager'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

console.log('═══════════════════════════════════════════════════')
console.log('  OSINT SENTINEL WORKSTATION — MAIN PROCESS START')
console.log('═══════════════════════════════════════════════════')
console.log(`[main] Electron: ${process.versions.electron}`)
console.log(`[main] Node: ${process.versions.node}`)
console.log(`[main] Chromium: ${process.versions.chrome}`)
console.log(`[main] Platform: ${process.platform} ${process.arch}`)
console.log(`[main] isDev: ${isDev}`)
console.log(`[main] ELECTRON_RENDERER_URL: ${process.env['ELECTRON_RENDERER_URL'] ?? '(not set)'}`)
console.log(`[main] ELECTRON_RUN_AS_NODE: ${process.env['ELECTRON_RUN_AS_NODE'] ?? '(not set)'}`)
console.log(`[main] __dirname: ${__dirname}`)
console.log(`[main] preload path: ${join(__dirname, '../preload/index.js')}`)
console.log(`[main] renderer path: ${isDev ? process.env['ELECTRON_RENDERER_URL'] + '/globe/index.html' : join(__dirname, '../renderer/globe/index.html')}`)

function createCockpitWindow(): BrowserWindow {
  console.log('[main] createCockpitWindow() — creating BrowserWindow...')

  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'OSINT Sentinel Workstation',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  console.log('[main] BrowserWindow created, id:', win.id)

  // Log all window events
  win.on('closed', () => console.log('[main] window closed'))
  win.on('unresponsive', () => console.error('[main] window UNRESPONSIVE'))
  win.on('responsive', () => console.log('[main] window responsive again'))
  win.on('show', () => console.log('[main] window shown'))
  win.on('hide', () => console.log('[main] window hidden'))

  // Log webContents lifecycle
  win.webContents.on('did-start-loading', () => console.log('[main] webContents: did-start-loading'))
  win.webContents.on('did-stop-loading', () => console.log('[main] webContents: did-stop-loading'))
  win.webContents.on('dom-ready', () => console.log('[main] webContents: dom-ready'))
  win.webContents.on('did-finish-load', () => console.log('[main] webContents: did-finish-load'))
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    console.error(`[main] webContents: did-fail-load code=${code} desc="${desc}" url=${url}`))
  win.webContents.on('render-gone' as any, (_e: any, details: any) =>
    console.error(`[main] webContents: RENDER GONE — ${JSON.stringify(details)}`))
  win.webContents.on('preload-error', (_e, path, err) =>
    console.error(`[main] webContents: PRELOAD ERROR in ${path}: ${err}`))

  // Log renderer console messages to main terminal with full detail
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['LOG', 'WARN', 'ERROR'][level] || `LVL${level}`
    console.log(`[renderer:${tag}] ${message} (${sourceId}:${line})`)
  })

  // Log crashes
  ;(win.webContents as any).on('crashed', () => console.error('[main] webContents: CRASHED'))
  ;(win.webContents as any).on('destroyed', () => console.error('[main] webContents: destroyed'))

  if (isDev) {
    const url = `${process.env['ELECTRON_RENDERER_URL']}/globe/index.html`
    console.log(`[main] loading dev URL: ${url}`)
    win.loadURL(url).then(() => console.log('[main] loadURL resolved')).catch((e) => console.error('[main] loadURL failed:', e))
    console.log('[main] opening devtools...')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    const file = join(__dirname, '../renderer/globe/index.html')
    console.log(`[main] loading file: ${file}`)
    win.loadFile(file).then(() => console.log('[main] loadFile resolved')).catch((e) => console.error('[main] loadFile failed:', e))
  }

  registerWindow(win.webContents)
  console.log('[main] window registered')

  return win
}

console.log('[main] waiting for app.whenReady()...')

// ── GPU ACCELERATION FLAGS FOR RTX 5060 BLACKWELL ──
// Force GPU acceleration, disable software fallback
app.commandLine.appendSwitch('enable-gpu')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers')
app.commandLine.appendSwitch('enable-features', 'Vulkan,WebGPU')
;(app as any).disableHardwareAcceleration = false
console.log('[main] GPU flags set — rasterization, zero-copy, Vulkan, WebGPU')

app.whenReady().then(() => {
  console.log('[main] app.whenReady() fired')
  console.log('[main] registering IPC handlers...')
  registerIpcHandlers()
  console.log('[main] IPC handlers registered')

  console.log('[main] creating cockpit window...')
  createCockpitWindow()

  console.log('[main] starting live data...')
  liveData.start()
  console.log('[main] live data started')

  console.log('[main] initializing VR manager...')
  vrManager.init()
  console.log('[main] VR manager initialized')
})

app.on('window-all-closed', () => {
  console.log('[main] window-all-closed — stopping live data and quitting')
  liveData.stop()
  vrManager.shutdown()
  if (process.platform !== 'darwin') app.quit()
})

// Catch uncaught errors in main process
process.on('uncaughtException', (err) => {
  console.error('[main] UNCAUGHT EXCEPTION:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] UNHANDLED REJECTION:', reason)
})
