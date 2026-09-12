/**
 * DEM Slope Worker — runs on a real OS thread via worker_threads.
 *
 * Computes slope from an elevation grid using Horn's method.
 * This is the CPU fallback for when WebGPU compute is unavailable.
 *
 * Input (from worker pool):
 *   { elev: Float32Array, width: number, height: number, cellSizeX: number, cellSizeY: number }
 *
 * Output:
 *   { slope: Float32Array, width, height } — slope in degrees per cell
 *
 * Runs on a real OS thread — does not block the main process event loop.
 */

module.exports = async function demSlope(data) {
  const { elev, width, height, cellSizeX, cellSizeY } = data
  const slope = new Float32Array(width * height)
  const RAD_TO_DEG = 180 / Math.PI

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

      const dzdx = ((ne + 2 * e + se) - (nw + 2 * w + sw)) / (8 * cellSizeX)
      const dzdy = ((sw + 2 * s + se) - (nw + 2 * n + ne)) / (8 * cellSizeY)

      const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy))
      slope[idx] = slopeRad * RAD_TO_DEG
    }
  }

  return { slope, width, height }
}
