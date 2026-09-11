/**
 * HUD — Heads-Up Display overlay.
 *
 * Ported from GEV's HUD concept, expanded with:
 *   - MGRS (Military Grid Reference System) coordinate readout
 *   - GSD (Ground Sample Distance) — sensor resolution at current altitude
 *   - NIIRS (National Imagery Interpretability Rating Scale) — image quality
 *   - Classification banner (top/bottom bars for UNCLASSIFIED // REL TO)
 *   - Standard lat/lon/alt/heading/pitch readout
 *
 * MGRS conversion uses the USNG/MGRS algorithm (simplified — no external lib).
 */

interface HudProps {
  viewport: unknown
  imageryLayer: string
  onResetNorth?: () => void
}

// ── MGRS conversion (simplified) ──

const MGRS_BANDS = 'CDEFGHJKLMNPQRSTUVWXX'
const UTM_COLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const UTM_ROWS = 'ABCDEFGHJKLMNPQRSTUV'

function latLonToMGRS(lat: number, lon: number, precision = 5): string {
  // Simplified MGRS — good enough for display, not survey-grade.
  if (lat > 84 || lat < -80) return 'MGRS N/A'

  const zoneNum = Math.floor((lon + 180) / 6) + 1
  const bandIdx = Math.floor((lat + 80) / 8)
  const band = MGRS_BANDS[bandIdx] || 'X'

  // Column letter (100km grid)
  const colIdx = (zoneNum - 1) % 3
  const colLetter = UTM_COLS[colIdx * 8 + Math.floor(((lon + 180) % 6) / (6 / 8)) % 8] || 'A'

  // Row letter (100km grid)
  const rowIdx = (zoneNum - 1) % 2
  const rowLetter = UTM_ROWS[(Math.floor(lat / 8) + rowIdx) % 20] || 'A'

  // Easting/Northing within 100km cell (simplified linear approx)
  const easting = Math.floor((lon % 1) * 100000 / (6 / 100)) % 100000
  const northing = Math.floor((lat % 1) * 100000 / (8 / 100)) % 100000

  const eStr = String(easting).padStart(precision, '0').substring(0, precision)
  const nStr = String(northing).padStart(precision, '0').substring(0, precision)

  return `${zoneNum}${band} ${colLetter}${rowLetter} ${eStr} ${nStr}`
}

// ── GSD (Ground Sample Distance) ──

function calcGSD(heightM: number): string {
  // Simplified: GSD ≈ altitude × pixel_size / focal_length
  // For a typical satellite/aerial sensor at the given altitude.
  // At satellite alt (400km+): ~10-30m/px. At aerial (1-10km): ~0.1-5m/px.
  if (heightM < 100) return '<1 m/px'
  if (heightM < 1000) return `${(heightM * 0.001).toFixed(1)} m/px`
  if (heightM < 10000) return `${(heightM * 0.01).toFixed(1)} m/px`
  if (heightM < 100000) return `${(heightM * 0.1).toFixed(0)} m/px`
  if (heightM < 1000000) return `${(heightM * 0.0001 * 1000).toFixed(0)} m/px`
  return `${(heightM / 40000).toFixed(0)} m/px`
}

// ── NIIRS (image interpretability) ──

function calcNIIRS(heightM: number): string {
  // NIIRS 0-9 scale. Higher = more detail visible.
  // Derived from GSD: NIIRS ≈ 10 - 3.32 * log10(GSD_in_meters)
  let gsdM: number
  if (heightM < 100) gsdM = 0.5
  else if (heightM < 1000) gsdM = heightM * 0.001
  else if (heightM < 10000) gsdM = heightM * 0.01
  else if (heightM < 100000) gsdM = heightM * 0.1
  else if (heightM < 1000000) gsdM = heightM * 0.0001 * 1000
  else gsdM = heightM / 40000

  const niirs = Math.max(0, Math.min(9, 10 - 3.32 * Math.log10(Math.max(gsdM, 0.1))))
  return `NIIRS ${niirs.toFixed(1)}`
}

export default function Hud({ viewport, imageryLayer, onResetNorth }: HudProps) {
  const vp = viewport as {
    center?: { lng: number; lat: number }
    height?: number
    heading?: number
    pitch?: number
    bbox?: { west: number; south: number; east: number; north: number }
  } | null

  const lat = vp?.center?.lat ?? 0
  const lng = vp?.center?.lng ?? 0
  const height = vp?.height ?? 0
  const heading = vp?.heading ?? 0
  const pitch = vp?.pitch ?? 0

  const latStr = Math.abs(lat).toFixed(4) + (lat >= 0 ? '°N' : '°S')
  const lngStr = Math.abs(lng).toFixed(4) + (lng >= 0 ? '°E' : '°W')
  const altStr = height > 1000 ? `${(height / 1000).toFixed(1)} km` : `${height.toFixed(0)} m`
  const mgrs = latLonToMGRS(lat, lng)
  const gsd = calcGSD(height)
  const niirs = calcNIIRS(height)

  return (
    <>
      {/* Classification banner — top */}
      <div style={hudStyle.classTop}>
        UNCLASSIFIED // REL TO FVEY
      </div>

      {/* Main HUD bar */}
      <div style={hudStyle.bar}>
        <div style={hudStyle.left}>
          <span style={hudStyle.label}>OSINT SENTINEL</span>
        </div>
        <div style={hudStyle.center}>
          <span style={hudStyle.coord}>{latStr} {lngStr}</span>
          <span style={hudStyle.sep}>|</span>
          <span style={hudStyle.mgrs} title="Military Grid Reference System">{mgrs}</span>
          <span style={hudStyle.sep}>|</span>
          <span style={hudStyle.coord}>ALT {altStr}</span>
          <span style={hudStyle.sep}>|</span>
          <span style={hudStyle.coord}>HDG {heading.toFixed(0)}°</span>
          <span style={hudStyle.sep}>|</span>
          <span style={hudStyle.coord}>PCH {pitch.toFixed(0)}°</span>
        </div>
        <div style={hudStyle.right}>
          <span style={hudStyle.metric} title="Ground Sample Distance">{gsd}</span>
          <span style={hudStyle.sep}>|</span>
          <span style={hudStyle.metric} title="National Imagery Interpretability Rating Scale">{niirs}</span>
          <span style={hudStyle.sep}>|</span>
          <span style={hudStyle.layer}>{imageryLayer.toUpperCase()}</span>
          {onResetNorth && (
            <button style={hudStyle.btn} onClick={onResetNorth} title="Reset camera to north (N)">
              N
            </button>
          )}
        </div>
      </div>

      {/* Classification banner — bottom */}
      <div style={hudStyle.classBottom}>
        UNCLASSIFIED // REL TO FVEY
      </div>
    </>
  )
}

const hudStyle = {
  classTop: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: 18,
    background: 'rgba(0, 100, 0, 0.85)',
    color: '#aaffaa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: 'bold' as const,
    letterSpacing: 2,
    zIndex: 21,
    borderBottom: '1px solid rgba(0, 200, 0, 0.3)',
  },
  classBottom: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 18,
    background: 'rgba(0, 100, 0, 0.85)',
    color: '#aaffaa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: 'bold' as const,
    letterSpacing: 2,
    zIndex: 21,
    borderTop: '1px solid rgba(0, 200, 0, 0.3)',
  },
  bar: {
    position: 'absolute' as const,
    top: 18,
    left: 0,
    right: 0,
    height: 36,
    background: 'rgba(11, 15, 20, 0.9)',
    borderBottom: '1px solid #1e2a3a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    zIndex: 20,
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#8b9dad',
  },
  left: { flex: 1 },
  center: { display: 'flex', alignItems: 'center', gap: 6 },
  right: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  label: {
    color: '#4a9eff',
    letterSpacing: 2,
    fontWeight: 'bold' as const,
    fontSize: 11,
  },
  coord: { color: '#c0c8d0', fontSize: 11 },
  mgrs: { color: '#4affd4', fontSize: 10, letterSpacing: 0.5 },
  metric: { color: '#ffea4a', fontSize: 10 },
  sep: { color: '#3a4a5a', margin: '0 2px' },
  layer: { color: '#6b7d92', fontSize: 10, letterSpacing: 1 },
  btn: {
    marginLeft: 8,
    background: 'rgba(74, 158, 255, 0.15)',
    border: '1px solid rgba(74, 158, 255, 0.4)',
    color: '#4a9eff',
    width: 22,
    height: 22,
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: 'bold' as const,
    padding: 0,
    lineHeight: '20px',
    transition: 'background 0.15s',
  },
}
