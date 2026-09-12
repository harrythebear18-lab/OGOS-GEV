/**
 * Anomaly Box-Blur Worker — runs on a real OS thread via worker_threads.
 *
 * Computes box-blur smoothed grid + residuals from elevation grid.
 * This is the CPU-intensive part of anomaly detection (O(n * radius^2)).
 *
 * Input:
 *   { elev: Float32Array, width, height, blurRadius }
 *
 * Output:
 *   { residuals: Float32Array, width, height, mean, stdDev }
 */

module.exports = async function anomalyBlur(data) {
  const { elev, width, height, blurRadius } = data
  const r = blurRadius || 5
  const smoothed = new Float32Array(width * height)
  const residuals = new Float32Array(width * height)

  // Box blur
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          sum += elev[ny * width + nx]
          count++
        }
      }
      smoothed[y * width + x] = count > 0 ? sum / count : 0
    }
  }

  // Residuals + stats
  let sumAll = 0
  for (let i = 0; i < width * height; i++) {
    residuals[i] = elev[i] - smoothed[i]
    sumAll += residuals[i]
  }
  const mean = sumAll / (width * height)

  let varSum = 0
  for (let i = 0; i < width * height; i++) {
    varSum += (residuals[i] - mean) ** 2
  }
  const stdDev = Math.sqrt(varSum / (width * height))

  return { residuals, width, height, mean, stdDev }
}
