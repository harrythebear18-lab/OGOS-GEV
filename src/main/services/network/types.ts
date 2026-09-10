/* Local network types — supplements @shared/types with monitoring-specific
 * shapes that don't travel over IPC as top-level contracts. */

import type { NetworkHealth, VpnStatus } from '@shared/types'

export interface ConnectionAlert {
  id: string
  timestamp: number
  type: 'new_connection' | 'new_country' | 'suspicious'
  processName: string
  remoteAddress: string
  remotePort: number
  protocol: 'TCP' | 'UDP'
  geo?: import('@shared/types').GeoLocation
  message: string
}

export interface TrafficDataPoint {
  timestamp: number
  totalConnections: number
  activeConnections: number
  newConnections: number
}

export interface OutageEvent {
  id: string
  startTime: number
  endTime?: number
  duration?: number
  type: 'internet' | 'dns' | 'local' | 'high_latency' | 'packet_loss'
  severity: 'minor' | 'major' | 'critical'
  description: string
  resolved: boolean
  scope?: 'local' | 'isp' | 'area' | 'regional'
  isp?: string
  failurePoint?: string
  areaAffected?: string
}

export interface FaultDetectionConfig {
  checkInterval: number
  latencyThreshold: number
  packetLossThreshold: number
  consecutiveFailures: number
  testHosts: string[]
  dnsServers: string[]
}

export type NetworkMedium = 'copper' | 'fiber' | 'wireless' | 'unknown'

export type DetectionMethod = 'statistical' | 'adapter' | 'speed' | 'name' | 'hybrid'

export interface MediumDetection {
  medium: NetworkMedium
  method: DetectionMethod
  confidence: number
  details: string
}

export interface MediumThresholds {
  latencyThreshold: number
  packetLossThreshold: number
  expectedLatencyRange: { min: number; max: number }
}

export interface TracerouteHop {
  hopNumber: number
  ipAddress: string
  hostname?: string
  latency: number
  packetLoss: number
  attempts: number
}

export interface BandwidthUsage {
  processName: string
  processId: number
  bytesSent: number
  bytesReceived: number
  totalBytes: number
  connections: number
  timestamp: number
}

export interface ConnectionQuality {
  remoteAddress: string
  remotePort: number
  qualityScore: number
  latency: number
  packetLoss: number
  timestamp: number
}

export interface SpeedTestResult {
  downloadSpeed: number
  uploadSpeed: number
  latency: number
  jitter: number
  timestamp: number
}

export interface DNSTestResult {
  server: string
  ip: string
  latency: number
  success: boolean
  timestamp: number
}

export interface VPNVerificationDetail {
  check: string
  status: 'pass' | 'fail' | 'warning' | 'unknown'
  message: string
}

/** Extended VPN status with internal detail (the IPC contract uses the simpler VpnStatus) */
export interface VPNStatusExtended extends VpnStatus {
  adapterName: string | null
  adapterType: string | null
  dnsServers: string[]
  webrtcLeakDetected: boolean
  encryptedInterfaces: string[]
  verificationDetails: VPNVerificationDetail[]
}

/** Extended NetworkHealth with internal detail (the IPC contract uses the simpler NetworkHealth) */
export interface NetworkHealthExtended extends NetworkHealth {
  dnsResolution: boolean
  internetAccess: boolean
  localNetwork: boolean
  inferredMedium?: NetworkMedium
  latencyVariance?: number
  detectionMethod?: DetectionMethod
  detectionConfidence?: number
}
