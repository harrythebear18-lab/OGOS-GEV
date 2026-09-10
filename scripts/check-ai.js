#!/usr/bin/env node
/**
 * Check AI services — Ollama + CLIP server.
 * Run: node scripts/check-ai.js
 */

const OLLAMA = 'http://localhost:11434'
const CLIP = 'http://localhost:9776'

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const models = (data.models || []).map(m => m.name)
    console.log(`  Ollama:  ONLINE  (${models.length} models: ${models.join(', ')})`)
    return true
  } catch (e) {
    console.log(`  Ollama:  OFFLINE  (${e.message})`)
    console.log(`    Start: ollama serve`)
    return false
  }
}

async function checkClip() {
  try {
    const res = await fetch(`${CLIP}/health`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(`  CLIP:    ONLINE  (${data.model || 'unknown'} on ${data.device || '?'})`)
    return true
  } catch (e) {
    console.log(`  CLIP:    OFFLINE  (${e.message})`)
    console.log(`    Start: pip install open_clip_torch torch fastapi uvicorn pillow`)
    console.log(`    Then:  python scripts/clip_server.py`)
    return false
  }
}

console.log('AI Services Check')
console.log('─────────────────')
checkOllama().then(() => checkClip()).then(() => {
  console.log('─────────────────')
})
