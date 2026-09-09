import type { WebContents } from 'electron'

const windows: WebContents[] = []

export function registerWindow(webContents: WebContents): void {
  windows.push(webContents)
  webContents.on('destroyed', () => {
    const i = windows.indexOf(webContents)
    if (i >= 0) windows.splice(i, 1)
  })
}

export function broadcastToWindows(channel: string, ...args: unknown[]): void {
  for (const w of windows) {
    if (!w.isDestroyed()) w.send(channel, ...args)
  }
}
