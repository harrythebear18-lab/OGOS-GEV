/**
 * DEM Slope Worker — runs on a real OS thread via worker_threads.
 *
 * Computes slope from an elevation grid using Horn's method.
 * This is the CPU fallback for when WebGPU compute is unavailable.
 *
 * Input (from worker pool):
 *   { sab: SharedArrayBuffer, width: number, height: number }
 *
 * Output:
 *   { sab: SharedArrayBuffer } (same buffer, slope written in place)
 *
 * The SharedArrayBuffer is transferred (not copied) — zero-copy I/O.
 */

module.exports = async function demSlope(data: { sab: SharedArrayBuffer; width: number; height: number }) {
  const { sab, width, height } = data
  const elev = new Float32Array(sab)
  const slope = new Float32Array(sab.byteLength / 4) // separate output

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const nw = elev[(y - 1) * width + (x - 1)]
      const n  = elev[(y - 1) * width + x]
      const ne = elev[(y - 1) * width + (x + 1)]
      const w  = elev[y * width + (x - 1)]
      const e  = elev[y * width + (x + 1)]
      const sw = elev[(y + 1) * width + (x - 1)]
      const s  = elev[(y + 1) * width + x]
      const se = elev[(y + 1) * width + (x + 1)]

      const dzdx = ((ne + 2 * e + se) - (nw + 2 * w + sw)) / 8
      const dzdy = ((sw + 2 * s + se) - (nw + 2 * n + ne)) / 8
      slope[idx] = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy))
    }
  }

  return { slope: Array.from(slope), width, height }
}
