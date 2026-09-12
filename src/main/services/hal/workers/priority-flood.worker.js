/**
 * Priority-Flood Worker — runs on a real OS thread via worker_threads.
 *
 * Barnes 2014 depression filling algorithm. This is the CPU-intensive
 * part of hydrology analysis — runs off the main process event loop.
 *
 * Input:
 *   { elev: Float32Array, width, height }
 *
 * Output:
 *   { filled: Float32Array, width, height } — depression-filled DEM
 *
 * Uses a simple priority queue (binary heap) for O(n log n) filling.
 */

module.exports = async function priorityFlood(data) {
  const { elev, width, height } = data
  const filled = new Float32Array(width * height)
  const closed = new Uint8Array(width * height)
  const INF = Infinity

  // Binary heap for priority queue
  const heap = []
  const heapVal = []

  function heapPush(idx, val) {
    const i = heap.length
    heap.push(idx)
    heapVal.push(val)
    // bubble up
    let c = i
    while (c > 0) {
      const p = (c - 1) >> 1
      if (heapVal[p] <= heapVal[c]) break
      ;[heap[p], heap[c]] = [heap[c], heap[p]]
      ;[heapVal[p], heapVal[c]] = [heapVal[c], heapVal[p]]
      c = p
    }
  }

  function heapPop() {
    const top = heap[0]
    const topVal = heapVal[0]
    const last = heap.length - 1
    heap[0] = heap[last]
    heapVal[0] = heapVal[last]
    heap.pop()
    heapVal.pop()
    // bubble down
    let c = 0
    const n = heap.length
    while (true) {
      let s = c
      const l = 2 * c + 1
      const r = 2 * c + 2
      if (l < n && heapVal[l] < heapVal[s]) s = l
      if (r < n && heapVal[r] < heapVal[s]) s = r
      if (s === c) break
      ;[heap[s], heap[c]] = [heap[c], heap[s]]
      ;[heapVal[s], heapVal[c]] = [heapVal[c], heapVal[s]]
      c = s
    }
    return { idx: top, val: topVal }
  }

  // Initialize: push edge cells, fill with their elevation
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      filled[idx] = elev[idx]
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        heapPush(idx, filled[idx])
        closed[idx] = 1
      }
    }
  }

  const dx = [-1, 1, 0, 0, -1, -1, 1, 1]
  const dy = [0, 0, -1, 1, -1, 1, -1, 1]

  while (heap.length > 0) {
    const { idx, val } = heapPop()
    const x = idx % width
    const y = (idx / width) | 0

    for (let d = 0; d < 8; d++) {
      const nx = x + dx[d]
      const ny = y + dy[d]
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const nidx = ny * width + nx
      if (closed[nidx]) continue
      closed[nidx] = 1
      // Fill: if neighbor is lower than current spill elevation, raise it
      if (filled[nidx] < val) filled[nidx] = val
      heapPush(nidx, filled[nidx])
    }
  }

  return { filled, width, height }
}
