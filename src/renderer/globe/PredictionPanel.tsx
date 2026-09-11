/**
 * PredictionPanel — 7-model prediction engine display.
 *
 * Elegant floating overlay showing:
 *  - Summary stats (total, high risk, critical, avg confidence)
 *  - Severe weather alerts (expandable, severity/radius/area)
 *  - Storm track predictions (expandable, with track points)
 *  - Climate anomaly predictions (expandable, SST/pressure/etc.)
 *  - Sensor failure predictions (expandable, failure probability)
 *  - Precipitation forecast (expandable, probability/intensity)
 *  - Teleconnection indices (ENSO, NAO, etc.)
 *
 * Subscribes to PREDICTION_UPDATE IPC channel.
 */

import { useState, useEffect } from 'react'
import type { PredictionUpdate, PredictionAlert, StormTrackPrediction, SstAnomaly } from '@shared/types'

interface PredictionPanelProps {
  onClose: () => void
}

export default function PredictionPanel({ onClose }: PredictionPanelProps) {
  const [prediction, setPrediction] = useState<PredictionUpdate | null>(null)

  useEffect(() => {
    // Request current state immediately (don't wait for next broadcast)
    window.api.predictions.getCurrent().then((update: unknown) => {
      if (update) setPrediction(update as PredictionUpdate)
    }).catch((err: unknown) => {
      console.warn('[prediction-panel] getCurrent failed:', err)
    })

    const unsub = window.api.predictions.onUpdate((update: unknown) => {
      setPrediction(update as PredictionUpdate)
    })
    return () => unsub()
  }, [])

  if (!prediction) {
    return (
      <div style={panelStyle.container}>
        <div style={panelStyle.header}>
          <span style={panelStyle.title}>🧠 PREDICTIONS</span>
          <button style={panelStyle.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={panelStyle.waiting}>
          <div style={panelStyle.waitingIcon}>🧠</div>
          <div>Waiting for prediction data…</div>
          <div style={panelStyle.waitingSub}>Engine starts ~5s after climate data loads</div>
        </div>
      </div>
    )
  }

  const s = prediction.summary
  const ageSec = Math.floor((Date.now() - prediction.timestamp) / 1000)
  const ageLabel = ageSec < 60 ? `${ageSec}s ago` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago` : `${Math.floor(ageSec / 3600)}h ago`

  return (
    <div style={panelStyle.container}>
      {/* Header */}
      <div style={panelStyle.header}>
        <span style={panelStyle.title}>🧠 PREDICTIONS</span>
        <span style={panelStyle.age}>{ageLabel}</span>
        <button style={panelStyle.closeBtn} onClick={onClose}>✕</button>
      </div>

      {/* Summary stats */}
      <div style={panelStyle.summaryRow}>
        <Stat value={s.totalPredictions} label="TOTAL" color="#4a9eff" />
        <Stat value={s.highRiskCount} label="HIGH" color="#ff8a4a" />
        <Stat value={s.criticalRiskCount} label="CRIT" color="#ff4a4a" />
        <Stat value={`${s.avgConfidence.toFixed(0)}%`} label="CONF" color="#4aff8a" />
      </div>

      {/* Severe weather alerts */}
      {prediction.severeWeather.length > 0 && (
        <Section icon="🚨" title="SEVERE WEATHER" count={prediction.severeWeather.length} color="#ff4a4a">
          {prediction.severeWeather.map((a, i) => (
            <AlertCard key={a.id || i} alert={a} />
          ))}
        </Section>
      )}

      {/* Storm tracks */}
      {prediction.stormTracks.length > 0 && (
        <Section icon="🌀" title="STORM TRACKS" count={prediction.stormTracks.length} color="#ff8a4a">
          {prediction.stormTracks.map((st, i) => (
            <StormCard key={st.stormId || i} storm={st} />
          ))}
        </Section>
      )}

      {/* Climate anomalies */}
      {prediction.climateAnomalies.length > 0 && (
        <Section icon="📈" title="CLIMATE ANOMALIES" count={prediction.climateAnomalies.length} color="#ffea4a">
          {prediction.climateAnomalies.map((a, i) => (
            <AlertCard key={a.id || i} alert={a} />
          ))}
        </Section>
      )}

      {/* Sensor failures */}
      {prediction.sensorFailures.length > 0 && (
        <Section icon="⚠️" title="SENSOR FAILURES" count={prediction.sensorFailures.length} color="#ffea4a">
          {prediction.sensorFailures.map((a, i) => (
            <AlertCard key={a.id || i} alert={a} />
          ))}
        </Section>
      )}

      {/* Precipitation */}
      {prediction.precipitation.length > 0 && (
        <Section icon="🌧️" title="PRECIPITATION" count={prediction.precipitation.length} color="#4a8aff">
          {prediction.precipitation.map((a, i) => (
            <AlertCard key={a.id || i} alert={a} />
          ))}
        </Section>
      )}

      {/* SST anomalies */}
      {prediction.sstAnomalies.length > 0 && (
        <Section icon="🌊" title="SST ANOMALIES" count={prediction.sstAnomalies.length} color="#4affd4">
          {prediction.sstAnomalies.slice(0, 10).map((a, i) => (
            <SstCard key={i} anomaly={a} />
          ))}
        </Section>
      )}

      {/* Teleconnection indices */}
      {Object.keys(prediction.teleconnectionIndices).length > 0 && (
        <Section icon="🌐" title="TELECONNECTION" count={Object.keys(prediction.teleconnectionIndices).length} color="#a04aff">
          <div style={panelStyle.teleGrid}>
            {Object.entries(prediction.teleconnectionIndices).map(([key, val]) => (
              <div key={key} style={panelStyle.teleItem}>
                <span style={panelStyle.teleKey}>{key}</span>
                <span style={panelStyle.teleVal}>{val.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Empty state */}
      {s.totalPredictions === 0 && (
        <div style={panelStyle.empty}>
          No active predictions. Engine will generate predictions as data arrives.
        </div>
      )}
    </div>
  )
}

function Stat({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div style={panelStyle.stat}>
      <span style={{ ...panelStyle.statVal, color }}>{value}</span>
      <span style={panelStyle.statLabel}>{label}</span>
    </div>
  )
}

function Section({ icon, title, count, color, children }: {
  icon: string; title: string; count: number; color: string; children: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div style={panelStyle.section}>
      <button style={panelStyle.sectionHeader(color)} onClick={() => setExpanded(!expanded)}>
        <span style={panelStyle.sectionIcon}>{icon}</span>
        <span style={panelStyle.sectionTitle}>{title}</span>
        <span style={panelStyle.sectionCount}>{count}</span>
        <span style={panelStyle.sectionArrow}>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && <div style={panelStyle.sectionBody}>{children}</div>}
    </div>
  )
}

function AlertCard({ alert }: { alert: PredictionAlert }) {
  const [expanded, setExpanded] = useState(false)
  const sevColor = riskColor(alert.severity)
  return (
    <div style={{ ...panelStyle.card, borderColor: sevColor + '40' }}>
      <div style={panelStyle.cardHeader} onClick={() => setExpanded(!expanded)}>
        <span style={panelStyle.cardTitle}>{alert.title}</span>
        <span style={{ ...panelStyle.badge, color: sevColor }}>{alert.severity.toUpperCase()}</span>
        <span style={{ ...panelStyle.badge, color: '#4aff8a' }}>{(alert.confidence * 100).toFixed(0)}%</span>
        <span style={panelStyle.cardArrow}>{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div style={panelStyle.cardBody}>
          {alert.lat !== 0 && alert.lon !== 0 && (
            <Row label="Center" value={`${alert.lat.toFixed(1)}°, ${alert.lon.toFixed(1)}°`} />
          )}
          {alert.radiusKm && <Row label="Radius" value={`${alert.radiusKm} km`} />}
          <Row label="Valid until" value={new Date(alert.validUntil).toLocaleString()} />
          {alert.description && <div style={panelStyle.cardDesc}>{alert.description}</div>}
        </div>
      )}
    </div>
  )
}

function StormCard({ storm }: { storm: StormTrackPrediction }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ ...panelStyle.card, borderColor: '#ff8a4a40' }}>
      <div style={panelStyle.cardHeader} onClick={() => setExpanded(!expanded)}>
        <span style={panelStyle.cardTitle}>{storm.stormName || storm.stormId}</span>
        <span style={{ ...panelStyle.badge, color: '#4aff8a' }}>{(storm.confidence * 100).toFixed(0)}%</span>
        <span style={panelStyle.cardArrow}>{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && storm.positions.length > 0 && (
        <div style={panelStyle.cardBody}>
          <div style={panelStyle.trackGrid}>
            {storm.positions.slice(0, 8).map((p, i) => (
              <div key={i} style={panelStyle.trackRow}>
                <span style={panelStyle.trackTime}>+{i}h</span>
                <span style={panelStyle.trackPos}>{p.lat.toFixed(1)}°, {p.lon.toFixed(1)}°</span>
                {p.windSpeedKt && <span style={panelStyle.trackWind}>{p.windSpeedKt}kt</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SstCard({ anomaly }: { anomaly: SstAnomaly }) {
  const color = anomaly.anomaly > 0 ? '#ff8a4a' : '#4a8aff'
  return (
    <div style={panelStyle.sstRow}>
      <span style={panelStyle.sstRegion}>{anomaly.region}</span>
      <span style={{ ...panelStyle.sstVal, color }}>
        {anomaly.anomaly > 0 ? '+' : ''}{anomaly.anomaly.toFixed(2)}°C
      </span>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={panelStyle.row}>
      <span style={panelStyle.rowLabel}>{label}</span>
      <span style={panelStyle.rowVal}>{value}</span>
    </div>
  )
}

function riskColor(risk: string): string {
  switch (risk) {
    case 'critical': return '#ff4a4a'
    case 'high': return '#ff8a4a'
    case 'moderate': return '#ffea4a'
    case 'low': return '#4a8aff'
    default: return '#6b7d92'
  }
}

// ── Styles ──

const panelStyle: Record<string, any> = {
  container: {
    position: 'absolute',
    top: 60,
    right: 12,
    zIndex: 200,
    width: 300,
    maxHeight: '70vh',
    overflowY: 'auto',
    background: 'rgba(11, 15, 20, 0.95)',
    border: '1px solid #1e2a3a',
    borderRadius: 4,
    padding: 8,
    color: '#c0c8d0',
    fontFamily: 'monospace',
    fontSize: 11,
    backdropFilter: 'blur(8px)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  title: {
    color: '#a04aff',
    letterSpacing: 1,
    fontSize: 10,
    fontWeight: 'bold',
    flex: 1,
  },
  age: {
    fontSize: 8,
    color: '#6b7d92',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#7a8a9a',
    cursor: 'pointer',
    fontSize: 12,
  },
  waiting: {
    textAlign: 'center',
    padding: '20px 0',
    color: '#6b7d92',
  },
  waitingIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  waitingSub: {
    fontSize: 8,
    marginTop: 4,
    color: '#3a4a5a',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-around',
    marginBottom: 6,
    padding: '4px 0',
    borderBottom: '1px solid #1e2a3a',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  statVal: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  statLabel: {
    fontSize: 7,
    color: '#6b7d92',
    letterSpacing: 0.5,
  },
  section: {
    marginBottom: 4,
  },
  sectionHeader: (color: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    width: '100%',
    padding: '3px 4px',
    background: 'transparent',
    border: 'none',
    color,
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'monospace',
    borderBottom: `1px solid ${color}20`,
  }),
  sectionIcon: { fontSize: 10 },
  sectionTitle: { flex: 1 },
  sectionCount: {
    fontSize: 8,
    color: '#6b7d92',
  },
  sectionArrow: { fontSize: 8, color: '#6b7d92' },
  sectionBody: {
    padding: '2px 0 4px',
  },
  card: {
    background: 'rgba(11, 15, 20, 0.6)',
    border: '1px solid',
    borderRadius: 2,
    marginBottom: 2,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 6px',
    cursor: 'pointer',
  },
  cardTitle: {
    flex: 1,
    fontSize: 9,
    color: '#c0c8d0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  badge: {
    fontSize: 7,
    fontWeight: 'bold',
    padding: '1px 3px',
    border: '1px solid currentColor',
    borderRadius: 1,
    letterSpacing: 0.5,
  },
  cardArrow: { fontSize: 8, color: '#6b7d92' },
  cardBody: {
    padding: '4px 6px 6px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1px 0',
  },
  rowLabel: {
    fontSize: 8,
    color: '#6b7d92',
  },
  rowVal: {
    fontSize: 9,
    color: '#c0c8d0',
  },
  cardDesc: {
    fontSize: 8,
    color: '#6b7d92',
    fontStyle: 'italic',
    marginTop: 3,
    lineHeight: 1.4,
  },
  trackGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  trackRow: {
    display: 'flex',
    gap: 6,
    fontSize: 8,
    padding: '1px 0',
  },
  trackTime: {
    color: '#6b7d92',
    minWidth: 28,
  },
  trackPos: {
    color: '#c0c8d0',
    flex: 1,
  },
  trackWind: {
    color: '#ff8a4a',
  },
  sstRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 4px',
    fontSize: 9,
  },
  sstRegion: {
    color: '#6b7d92',
  },
  sstVal: {
    fontWeight: 'bold',
  },
  teleGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 2,
    padding: '2px 0',
  },
  teleItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1px 4px',
    background: 'rgba(11, 15, 20, 0.5)',
    borderRadius: 2,
    fontSize: 8,
  },
  teleKey: {
    color: '#6b7d92',
  },
  teleVal: {
    color: '#a04aff',
    fontWeight: 'bold',
  },
  empty: {
    textAlign: 'center',
    padding: '12px 0',
    color: '#6b7d92',
    fontSize: 9,
    fontStyle: 'italic',
  },
}
