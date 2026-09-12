/**
 * CLIP Manager — auto-starts the Python CLIP embedding server on :9776.
 * Spawns the FastAPI/uvicorn process and monitors it.
 */

import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { checkClipHealth } from './clip-service'

// Common Python locations — dynamic, no hardcoded user paths
const PYTHON_PATHS = [
  'python',
  'python3',
  // Windows: check common install locations relative to LocalAppData
  ...(process.env.LOCALAPPDATA
    ? [
      `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python313\\python.exe`,
      `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python312\\python.exe`,
      `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python311\\python.exe`,
    ]
    : []),
]

let clipProcess: ChildProcess | null = null
let started = false
let healthCheckTimer: ReturnType<typeof setInterval> | null = null

function findPython(): string {
  for (const p of PYTHON_PATHS) {
    if (p === 'python' || p === 'python3') return p
    if (existsSync(p)) return p
  }
  return 'python'
}

export function startClipServer(): void {
  if (started) return
  started = true

  const scriptPath = join(process.cwd(), 'scripts', 'clip_server.py')
  if (!existsSync(scriptPath)) {
    console.warn('[clip-manager] clip_server.py not found at', scriptPath)
    return
  }

  const pythonBin = findPython()
  console.log(`[clip-manager] starting CLIP server: ${pythonBin} ${scriptPath}`)

  try {
    clipProcess = spawn(pythonBin, [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: process.cwd(),
    })

    clipProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) console.log(`[clip-server] ${text}`)
    })

    clipProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) console.error(`[clip-server] ${text}`)
    })

    clipProcess.on('exit', (code) => {
      console.log(`[clip-manager] CLIP server exited (code ${code})`)
      clipProcess = null
    })

    clipProcess.on('error', (err) => {
      console.error('[clip-manager] failed to spawn CLIP server:', err.message)
      console.error('[clip-manager] Make sure Python + open_clip_torch + fastapi + uvicorn are installed')
      clipProcess = null
    })

    // Poll health until the server is ready (model load takes time)
    healthCheckTimer = setInterval(async () => {
      const health = await checkClipHealth()
      if (health.running) {
        console.log(`[clip-manager] CLIP server online on :9776 (model: ${health.model})`)
        if (healthCheckTimer) clearInterval(healthCheckTimer)
        healthCheckTimer = null
      }
    }, 5000)
  } catch (err) {
    console.error('[clip-manager] spawn failed:', err)
    started = false
  }
}

export function stopClipServer(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
  if (clipProcess) {
    console.log('[clip-manager] stopping CLIP server...')
    clipProcess.kill()
    clipProcess = null
  }
  started = false
}

export function isClipServerRunning(): boolean {
  return clipProcess !== null && !clipProcess.killed
}
