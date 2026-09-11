/**
 * EntityInfoBox — floating info panel for a picked Cesium entity.
 *
 * Appears when the user clicks on any entity (aircraft, vessel, fire, earthquake,
 * lightning, station, storm, grid asset, satellite, etc.) while not in a draw mode.
 * Shows the entity type, name, position, and all properties from its property bag.
 */

import { memo } from 'react'
import type { PickedEntity } from './DrawingManager'

interface EntityInfoBoxProps {
  entity: PickedEntity | null
  onClose: () => void
}

/** Human-readable labels for entity type prefixes. */
const TYPE_LABELS: Record<string, string> = {
  aircraft: 'AIRCRAFT (ADS-B)',
  vessel: 'VESSEL (AIS)',
  fire: 'FIRE (NASA FIRMS)',
  quake: 'EARTHQUAKE (USGS)',
  strike: 'LIGHTNING STRIKE',
  station: 'CLIMATE STATION',
  storm: 'TROPICAL STORM',
  'storm-track': 'STORM TRACK',
  'grid-asset': 'GRID ASSET',
  'grid-ic': 'GRID INTERCONNECT',
  'infra': 'INFRASTRUCTURE',
  'infra:airport': 'AIRPORT (OSM)',
  'infra:helipad': 'HELIPAD (OSM)',
  'infra:power_plant': 'POWER PLANT (OSM)',
  'infra:substation': 'SUBSTATION (OSM)',
  'infra:generator': 'GENERATOR (OSM)',
  'infra:transformer': 'TRANSFORMER (OSM)',
  'infra:tower': 'TRANSMISSION TOWER (OSM)',
  'infra:monitoring_station': 'MONITORING STATION (OSM)',
  'infra:lighthouse': 'LIGHTHOUSE (OSM)',
  'infra:navigation_buoy': 'NAVIGATION BUOY (OSM)',
  'infra:weather_station': 'WEATHER STATION (OSM)',
  pred: 'PREDICTION ALERT',
  'pred-track': 'PREDICTION TRACK',
  sst: 'SST ANOMALY',
  'net-endpoint': 'NETWORK ENDPOINT',
  aurora: 'AURORA OVAL',
  'lkp-pin': 'LKP PIN',
}

/** Property keys that get special formatting. */
function formatProperty(key: string, value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') {
    if (key === 'altitude' || key === 'height') return `${value.toFixed(0)} m`
    if (key === 'velocity') return `${value.toFixed(1)} m/s`
    if (key === 'heading') return `${value.toFixed(1)}°`
    if (key === 'speed') return `${value.toFixed(1)} kn`
    if (key === 'brightness') return `${value.toFixed(1)} K`
    if (key === 'frp') return `${value.toFixed(1)} MW`
    if (key === 'mag') return `${value.toFixed(1)}`
    if (key === 'depth') return `${value.toFixed(1)} km`
    if (key === 'intensity') return `${value.toFixed(0)} kA`
    if (key === 'confidence') return `${(value * 100).toFixed(0)}%`
    if (key === 'capacityMw') return `${value.toFixed(0)} MW`
    if (key === 'outputMw') return `${value.toFixed(0)} MW`
    if (key === 'voltageKv') return `${value.toFixed(0)} kV`
    if (key === 'windSpeedKt') return `${value.toFixed(0)} kt`
    if (key === 'pressureMB') return `${value.toFixed(0)} mb`
    if (key === 'waterTemp' || key === 'airTemp') return `${value.toFixed(1)} °C`
    if (key === 'windSpeed') return `${value.toFixed(1)} m/s`
    if (key === 'windDir') return `${value.toFixed(0)}°`
    if (key === 'waveHeight') return `${value.toFixed(1)} m`
    if (key === 'wavePeriod') return `${value.toFixed(1)} s`
    if (key === 'pressure') return `${value.toFixed(1)} hPa`
    if (key === 'salinity') return `${value.toFixed(2)} PSU`
    if (key === 'co2') return `${value.toFixed(1)} ppm`
    if (key === 'currentSpeed') return `${value.toFixed(2)} m/s`
    if (key === 'currentDir') return `${value.toFixed(0)}°`
    if (key === 'depth') return typeof value === 'number' && value > 1000 ? `${(value / 1000).toFixed(1)} km` : `${value.toFixed(1)} m`
    if (key === 'oxygen') return `${value.toFixed(1)} µmol/kg`
    if (key === 'ph') return `${value.toFixed(2)}`
    if (key === 'trajectoryPoints') return `${value} pts`
    if (key === 'anomaly') return `${value.toFixed(2)} °C`
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/** Property display order — important fields first. */
const PRIORITY_KEYS = [
  'callsign', 'icao24', 'mmsi', 'name', 'place', 'shipType',
  'origin', 'destination', 'satellite', 'confidence',
  'icao', 'iata', 'osmType', 'subtype', 'fuel', 'operator',
  'mag', 'brightness', 'frp', 'intensity', 'polarity',
  'velocity', 'heading', 'altitude', 'speed', 'depth',
  'windSpeedKt', 'pressureMB', 'classification', 'intensity',
  'type', 'source', 'capacityMw', 'outputMw', 'voltageKv', 'energyType', 'owner', 'active',
  'waterTemp', 'airTemp', 'windSpeed', 'windDir', 'waveHeight', 'wavePeriod',
  'pressure', 'salinity', 'co2', 'currentSpeed', 'currentDir', 'depth',
  'oxygen', 'ph', 'hasTrajectory', 'trajectoryPoints',
  'severity', 'confidence', 'description',
  'ip', 'port', 'country', 'city', 'process',
  'time', 'acqTime',
]

function EntityInfoBox({ entity, onClose }: EntityInfoBoxProps) {
  if (!entity) return null

  // For infra entities, use the specific subtype from the property bag if available
  let typeKey = entity.type
  if (entity.type === 'infra' && entity.properties?.type) {
    typeKey = `infra:${entity.properties.type}`
  }
  const typeLabel = TYPE_LABELS[typeKey] ?? TYPE_LABELS[entity.type] ?? entity.type.toUpperCase()
  const propKeys = Object.keys(entity.properties)

  // Sort properties: priority keys first (in defined order), then alphabetical
  const sortedKeys = [...propKeys].sort((a, b) => {
    const ai = PRIORITY_KEYS.indexOf(a)
    const bi = PRIORITY_KEYS.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  return (
    <div style={boxStyle.container}>
      {/* Header */}
      <div style={boxStyle.header}>
        <span style={boxStyle.typeBadge}>{typeLabel}</span>
        <button style={boxStyle.closeBtn} onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {/* Name */}
      {entity.name && (
        <div style={boxStyle.nameRow}>
          <span style={boxStyle.nameLabel}>NAME</span>
          <span style={boxStyle.nameValue}>{entity.name}</span>
        </div>
      )}

      {/* ID */}
      <div style={boxStyle.idRow}>
        <span style={boxStyle.idLabel}>ID</span>
        <span style={boxStyle.idValue}>{entity.id}</span>
      </div>

      {/* Position */}
      <div style={boxStyle.positionGrid}>
        <div style={boxStyle.positionRow}>
          <span style={boxStyle.positionLabel}>LAT</span>
          <span style={boxStyle.positionValue}>{entity.lat.toFixed(4)}°</span>
        </div>
        <div style={boxStyle.positionRow}>
          <span style={boxStyle.positionLabel}>LON</span>
          <span style={boxStyle.positionValue}>{entity.lng.toFixed(4)}°</span>
        </div>
        {entity.height !== 0 && (
          <div style={boxStyle.positionRow}>
            <span style={boxStyle.positionLabel}>ALT</span>
            <span style={boxStyle.positionValue}>{entity.height.toFixed(0)} m</span>
          </div>
        )}
      </div>

      {/* Properties */}
      {sortedKeys.length > 0 && (
        <div style={boxStyle.propertiesSection}>
          <div style={boxStyle.propertiesHeader}>PROPERTIES</div>
          <div style={boxStyle.propertiesGrid}>
            {sortedKeys.map((key) => (
              <div key={key} style={boxStyle.propertyRow}>
                <span style={boxStyle.propertyLabel}>{key.toUpperCase()}</span>
                <span style={boxStyle.propertyValue}>
                  {formatProperty(key, entity.properties[key])}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(EntityInfoBox)

// ── Styles ──

const boxStyle = {
  container: {
    position: 'absolute' as const,
    top: 60,
    right: 300,
    width: 280,
    maxHeight: '70vh',
    overflowY: 'auto' as const,
    background: 'rgba(8, 14, 22, 0.96)',
    border: '1px solid rgba(74, 158, 255, 0.3)',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 12px rgba(74, 158, 255, 0.1)',
    backdropFilter: 'blur(8px)',
    zIndex: 50,
    fontFamily: 'monospace' as const,
    fontSize: 11,
    color: '#c0c8d0',
    pointerEvents: 'auto' as const,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 10px',
    borderBottom: '1px solid rgba(74, 158, 255, 0.15)',
    background: 'rgba(74, 158, 255, 0.06)',
    borderRadius: '6px 6px 0 0',
  },
  typeBadge: {
    fontSize: 9,
    fontWeight: 'bold' as const,
    letterSpacing: 1,
    color: '#4a9eff',
    textTransform: 'uppercase' as const,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6b7d92',
    fontSize: 12,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
    transition: 'color 0.15s',
  },
  nameRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 10px',
    borderBottom: '1px solid #1e2a3a',
  },
  nameLabel: {
    fontSize: 8,
    color: '#6b7d92',
    letterSpacing: 0.5,
  },
  nameValue: {
    fontSize: 11,
    color: '#4a9eff',
    fontWeight: 'bold' as const,
    textAlign: 'right' as const,
    maxWidth: 200,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  idRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 10px',
    borderBottom: '1px solid #1e2a3a',
  },
  idLabel: {
    fontSize: 8,
    color: '#6b7d92',
    letterSpacing: 0.5,
  },
  idValue: {
    fontSize: 9,
    color: '#8b9dad',
    fontFamily: 'monospace' as const,
    textAlign: 'right' as const,
    maxWidth: 200,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  positionGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '6px 10px',
    borderBottom: '1px solid #1e2a3a',
    gap: 2,
  },
  positionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  positionLabel: {
    fontSize: 8,
    color: '#6b7d92',
    letterSpacing: 0.5,
  },
  positionValue: {
    fontSize: 10,
    color: '#4affd4',
    fontWeight: 'bold' as const,
  },
  propertiesSection: {
    padding: '6px 10px',
  },
  propertiesHeader: {
    fontSize: 9,
    color: '#4a9eff',
    letterSpacing: 1,
    fontWeight: 'bold' as const,
    marginBottom: 4,
  },
  propertiesGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  propertyRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '2px 0',
  },
  propertyLabel: {
    fontSize: 8,
    color: '#6b7d92',
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  propertyValue: {
    fontSize: 10,
    color: '#c0c8d0',
    textAlign: 'right' as const,
    maxWidth: 180,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
}
