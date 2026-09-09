/**
 * CLIP Service — client for the local CLIP embedding server.
 * Ported from OSINT-Global-OS. Connects to Python FastAPI server (open_clip).
 * Default: http://localhost:9776
 */

import type { ClipHealthResponse } from '@shared/types'

const CLIP_BASE = 'http://localhost:9776'

export async function checkClipHealth(): Promise<ClipHealthResponse> {
  try {
    const res = await fetch(`${CLIP_BASE}/health`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { running: false }
    const data = await res.json()
    return { running: true, model: data.model }
  } catch {
    return { running: false }
  }
}

export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${CLIP_BASE}/embed/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`CLIP text embed failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return data.embedding
}

export async function embedImage(imagePath: string): Promise<number[]> {
  const res = await fetch(`${CLIP_BASE}/embed/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath }),
  })
  if (!res.ok) throw new Error(`CLIP image embed failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return data.embedding
}

export async function similarity(a: number[], b: number[]): Promise<number> {
  const res = await fetch(`${CLIP_BASE}/similarity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a, b }),
  })
  if (!res.ok) throw new Error(`CLIP similarity failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return data.similarity
}
