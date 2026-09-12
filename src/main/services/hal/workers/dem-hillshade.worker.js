/**
 * DEM Hillshade Worker — runs on a real OS thread via worker_threads.
 *
 * Computes hillshade from an elevation grid using Horn's method.
 * CPU fallback for when WebGPU compute is unavailable.
 *
 * Input:
 *   { elev: Float32Array, width, height, cellSizeX, cellSizeY, azimuth, altitude }
 *     azimuth: sun direction in radians (default 315° = 5.4978 rad)
 *     altitude: sun elevation in radians (default 45° = 0.7854 rad)
 *
 * Output:
 *   { hillshade: Float32Array, width, height } — values 0-255
 */

module.exports = async function demHillshade(data) {
  const { elev, width, height, cellSizeX, cellSizeY } = data
  const azimuth = data.azimuth ?? (315 * Math.PI / 180)
  const altitude = data.altitude ?? (45 * Math.PI / 180)
  const zenith = Math.PI / 2 - altitude
  const shade = new Float32Array(width * height)

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

      const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy))
      const aspect = (dzdx === 0 && dzdy === 0) ? 0 : Math.atan2(dzdx, -dzdy)

      const h = Math.cos(slope) * Math.cos(zenith) +
                Math.sin(slope) * Math.sin(zenith) * Math.cos(azimuth - aspect)

      shade[idx] = Math.max(0, Math.min(255, h * 254 + 0.5))
    }
  }

  return { hillshade: shade, width, height }
}
