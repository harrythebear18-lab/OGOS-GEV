interface HudProps {
  viewport: unknown
  imageryLayer: string
}

export default function Hud({ viewport, imageryLayer }: HudProps) {
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

  return (
    <div style={hudStyle.bar}>
      <div style={hudStyle.left}>
        <span style={hudStyle.label}>OSINT SENTINEL WORKSTATION</span>
      </div>
      <div style={hudStyle.center}>
        <span style={hudStyle.coord}>{latStr} {lngStr}</span>
        <span style={hudStyle.sep}>|</span>
        <span style={hudStyle.coord}>ALT {altStr}</span>
        <span style={hudStyle.sep}>|</span>
        <span style={hudStyle.coord}>HDG {heading.toFixed(0)}°</span>
        <span style={hudStyle.sep}>|</span>
        <span style={hudStyle.coord}>PCH {pitch.toFixed(0)}°</span>
      </div>
      <div style={hudStyle.right}>
        <span style={hudStyle.layer}>{imageryLayer.toUpperCase()}</span>
      </div>
    </div>
  )
}

const hudStyle = {
  bar: {
    position: 'absolute' as const,
    top: 0,
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
  center: { display: 'flex', alignItems: 'center', gap: 8 },
  right: { flex: 1, textAlign: 'right' as const },
  label: {
    color: '#4a9eff',
    letterSpacing: 2,
    fontWeight: 'bold' as const,
    fontSize: 11,
  },
  coord: { color: '#c0c8d0', fontSize: 11 },
  sep: { color: '#3a4a5a', margin: '0 4px' },
  layer: { color: '#6b7d92', fontSize: 10, letterSpacing: 1 },
}
