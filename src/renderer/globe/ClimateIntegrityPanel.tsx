/**
 * Climate Integrity Panel — displays data source consistency, sensor health,
 * and cross-verification results.
 *
 * Subscribes to CLIMATE_INTEGRITY IPC channel and renders:
 * - Overall integrity score (0-100%)
 * - Check summary (passed / warnings / failed)
 * - Active storms count
 * - Space weather status
 * - Live feed counts (lightning, vessels, aircraft, earthquakes, wildfires)
 *
 * Ported from OSINT-Global-OS climate integrity concept, adapted for
 * the workstation's Cesium plugin architecture.
 */

import { useState, useEffect } from 'react'
import type { IntegrityUpdate } from '@shared/types'

export default function ClimateIntegrityPanel() {
  const [integrity, setIntegrity] = useState<IntegrityUpdate | null>(null)

  useEffect(() => {
    // Request current state immediately (don't wait up to 4 min for next broadcast)
    window.api.climate.getIntegrityCurrent?.().then((update: unknown) => {
      if (update) setIntegrity(update as IntegrityUpdate)
    }).catch(() => {})

    const unsub = window.api.climate.onIntegrity((update: unknown) => {
      setIntegrity(update as IntegrityUpdate)
    })
    return () => unsub()
  }, [])

  if (!integrity) {
    return (
      <div style={panelStyle.container}>
        <div style={panelStyle.header}>
          <span style={panelStyle.title}>CLIMATE INTEGRITY</span>
        </div>
        <div style={panelStyle.waiting}>Waiting for integrity data…</div>
      </div>
    )
  }

  const s = integrity.summary
  const score = Math.round(s.overallScore)
  const scoreColor = score > 75 ? '#4aff8a' : score > 50 ? '#ffea4a' : score > 25 ? '#ff8a4a' : '#ff4a4a'
  const scoreLabel = score > 75 ? 'NOMINAL' : score > 50 ? 'DEGRADED' : score > 25 ? 'POOR' : 'CRITICAL'

  const feeds = [
    { label: 'Storms', count: integrity.storms?.length ?? 0, color: '#ff8a4a' },
    { label: 'Lightning', count: integrity.lightningStrikes?.length ?? 0, color: '#ffea4a' },
    { label: 'Vessels', count: integrity.vessels?.length ?? 0, color: '#4a9eff' },
    { label: 'Aircraft', count: integrity.aircraft?.length ?? 0, color: '#4aff8a' },
    { label: 'Earthquakes', count: integrity.earthquakes?.length ?? 0, color: '#ff4a4a' },
    { label: 'Wildfires', count: integrity.wildfires?.length ?? 0, color: '#ff6a3a' },
  ]

  const sw = integrity.spaceWeather
  const swStatus = sw ? 'ACTIVE' : 'NO DATA'
  const swColor = sw ? '#4aff8a' : '#6b7d92'

  const ageMs = Date.now() - integrity.timestamp
  const ageSec = Math.round(ageMs / 1000)
  const ageLabel = ageSec < 60 ? `${ageSec}s ago` : ageSec < 3600 ? `${Math.round(ageSec / 60)}m ago` : `${Math.round(ageSec / 3600)}h ago`

  return (
    <div style={panelStyle.container}>
      <div style={panelStyle.header}>
        <span style={panelStyle.title}>CLIMATE INTEGRITY</span>
        <span style={panelStyle.age}>{ageLabel}</span>
      </div>

      {/* Score gauge */}
      <div style={panelStyle.scoreRow}>
        <div style={panelStyle.scoreBar}>
          <div
            style={{
              ...panelStyle.scoreFill,
              width: `${score}%`,
              background: scoreColor,
            }}
          />
        </div>
        <span style={{ ...panelStyle.scoreVal, color: scoreColor }}>
          {score}% {scoreLabel}
        </span>
      </div>

      {/* Check summary */}
      <div style={panelStyle.checkRow}>
        <div style={panelStyle.checkItem}>
          <span style={{ ...panelStyle.checkVal, color: '#4aff8a' }}>{s.sensorsVerified}</span>
          <span style={panelStyle.checkLabel}>VERIFIED</span>
        </div>
        <div style={panelStyle.checkItem}>
          <span style={{ ...panelStyle.checkVal, color: '#ffea4a' }}>{s.sensorsWarning}</span>
          <span style={panelStyle.checkLabel}>WARN</span>
        </div>
        <div style={panelStyle.checkItem}>
          <span style={{ ...panelStyle.checkVal, color: '#ff4a4a' }}>{s.sensorsFailed}</span>
          <span style={panelStyle.checkLabel}>FAILED</span>
        </div>
      </div>

      {/* Space weather */}
      <div style={panelStyle.sectionHeader}>SPACE WEATHER</div>
      <div style={panelStyle.swRow}>
        {sw ? (
          <>
            <span style={{ ...panelStyle.swBadge, color: swColor, borderColor: swColor }}>
              {swStatus}
            </span>
            {sw.kpIndex !== undefined && (
              <span style={panelStyle.swDetail}>Kp {sw.kpIndex.toFixed(1)}</span>
            )}
            {sw.solarWindSpeed !== undefined && (
              <span style={panelStyle.swDetail}>{sw.solarWindSpeed.toFixed(0)} km/s</span>
            )}
            {sw.xrayFlareClass && (
              <span style={panelStyle.swDetail}>Flare {sw.xrayFlareClass}</span>
            )}
          </>
        ) : (
          <span style={{ ...panelStyle.swBadge, color: swColor, borderColor: swColor }}>
            {swStatus}
          </span>
        )}
      </div>

      {/* Live feed counts */}
      <div style={panelStyle.sectionHeader}>LIVE FEEDS</div>
      <div style={panelStyle.feedGrid}>
        {feeds.map((f) => (
          <div key={f.label} style={panelStyle.feedCard}>
            <span style={{ ...panelStyle.feedCount, color: f.color }}>{f.count}</span>
            <span style={panelStyle.feedLabel}>{f.label}</span>
          </div>
        ))}
      </div>

      {/* Pipeline health */}
      <div style={panelStyle.sectionHeader}>DATA PIPELINES</div>
      <div style={panelStyle.checkRow}>
        <div style={panelStyle.checkItem}>
          <span style={{ ...panelStyle.checkVal, color: '#4aff8a' }}>{s.pipelinesActive}</span>
          <span style={panelStyle.checkLabel}>ACTIVE</span>
        </div>
        <div style={panelStyle.checkItem}>
          <span style={{ ...panelStyle.checkVal, color: '#ff8a4a' }}>{s.pipelinesDegraded}</span>
          <span style={panelStyle.checkLabel}>DEGRADED</span>
        </div>
        <div style={panelStyle.checkItem}>
          <span style={{ ...panelStyle.checkVal, color: '#4a9eff' }}>{s.resultsValidated}</span>
          <span style={panelStyle.checkLabel}>VALIDATED</span>
        </div>
      </div>

      {/* Verification flags */}
      <div style={panelStyle.sectionHeader}>VERIFICATION FLAGS</div>
      <div style={panelStyle.checkRow}>
        <div style={panelStyle.checkItem}>
          <span style={{ ...panelStyle.checkVal, color: '#ff4a4a' }}>{s.criticalFlags}</span>
          <span style={panelStyle.checkLabel}>CRITICAL</span>
        </div>
        <div style={panelStyle.checkItem}>
          <span style={{ ...panelStyle.checkVal, color: '#ffea4a' }}>{s.warningFlags}</span>
          <span style={panelStyle.checkLabel}>WARN</span>
        </div>
        <div style={panelStyle.checkItem}>
          <span style={{ ...panelStyle.checkVal, color: '#4aff8a' }}>{s.crossSourceMatches}</span>
          <span style={panelStyle.checkLabel}>MATCHED</span>
        </div>
      </div>
    </div>
  )
}

const panelStyle: Record<string, React.CSSProperties> = {
  container: {
    background: 'rgba(11, 15, 20, 0.95)',
    border: '1px solid #1e2a3a',
    borderRadius: 4,
    padding: 10,
    color: '#c0c8d0',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#4a9eff',
    letterSpacing: 1,
    fontSize: 10,
    fontWeight: 'bold' as const,
  },
  age: {
    color: '#6b7d92',
    fontSize: 9,
  },
  waiting: {
    color: '#6b7d92',
    fontSize: 11,
    fontStyle: 'italic' as const,
    padding: '12px 0',
    textAlign: 'center' as const,
  },
  scoreRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  scoreBar: {
    flex: 1,
    height: 8,
    background: '#1a2a3a',
    borderRadius: 4,
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.5s ease',
  },
  scoreVal: {
    fontSize: 10,
    fontWeight: 'bold' as const,
    whiteSpace: 'nowrap' as const,
    minWidth: 90,
    textAlign: 'right' as const,
  },
  checkRow: {
    display: 'flex',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  checkItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 2,
  },
  checkVal: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    fontFamily: 'monospace',
  },
  checkLabel: {
    fontSize: 8,
    color: '#6b7d92',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    fontSize: 9,
    color: '#6b7d92',
    letterSpacing: 1,
    fontWeight: 'bold' as const,
    marginTop: 8,
    marginBottom: 4,
    borderBottom: '1px solid #1e2a3a',
    paddingBottom: 3,
  },
  swRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  swBadge: {
    fontSize: 9,
    fontWeight: 'bold' as const,
    padding: '2px 6px',
    borderRadius: 2,
    border: '1px solid',
    letterSpacing: 0.5,
  },
  swDetail: {
    fontSize: 10,
    color: '#a0a8b0',
  },
  feedGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 4,
    marginTop: 4,
  },
  feedCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '4px 2px',
    background: 'rgba(11, 15, 20, 0.6)',
    borderRadius: 3,
    border: '1px solid #1e2a3a',
  },
  feedCount: {
    fontSize: 14,
    fontWeight: 'bold' as const,
    fontFamily: 'monospace',
  },
  feedLabel: {
    fontSize: 8,
    color: '#6b7d92',
    letterSpacing: 0.5,
  },
}
