#!/usr/bin/env node
/**
 * Compile WAT → WASM with SIMD support.
 *
 * Usage:  node scripts/compile-wasm.mjs
 *
 * Reads:  src/renderer/globe/hal/wasm/simd-kernels.wat
 * Writes: src/renderer/globe/hal/wasm/simd-kernels.wasm
 *
 * Requires the `wabt` npm package (devDependency).
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import wabtInit from 'wabt'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const watPath = resolve(root, 'src/renderer/globe/hal/wasm/simd-kernels.wat')
const wasmPath = resolve(root, 'src/renderer/globe/hal/wasm/simd-kernels.wasm')

async function main() {
  const wabt = await wabtInit()
  const watSource = readFileSync(watPath, 'utf8')

  // Parse WAT with SIMD feature enabled
  const module = wabt.parseWat(watPath, watSource, {
    features: {
      simd: true,
      bulk_memory: true,
      reference_types: true,
    },
  })

  // Validate and generate binary
  const { buffer } = module.toBinary({
    write_debug_names: false,
    relocatable: false,
  })

  writeFileSync(wasmPath, Buffer.from(buffer))
  console.log(`[compile-wasm] ${watPath} → ${wasmPath} (${buffer.length} bytes)`)
}

main().catch((err) => {
  console.error('[compile-wasm] FAILED:', err)
  process.exit(1)
})
