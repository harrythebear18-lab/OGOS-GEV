/* Notification service for alerts — ported from OGOS.
 * Email/SMS are placeholders; desktop notifications via Electron. */
import type { NetworkHealth } from '@shared/types'
import type { OutageEvent } from './types'

export class NotificationService {
  private emailConfig: {
    enabled: boolean
    recipient: string
    smtpHost?: string
    smtpPort?: number
    smtpUser?: string
    smtpPassword?: string
  } | null = null

  private smsConfig: {
    enabled: boolean
    recipient: string
    twilioAccountSid?: string
    twilioAuthToken?: string
    twilioPhoneNumber?: string
  } | null = null

  setEmailConfig(config: {
    enabled: boolean
    recipient: string
    smtpHost?: string
    smtpPort?: number
    smtpUser?: string
    smtpPassword?: string
  }): void {
    this.emailConfig = config
  }

  setSMSConfig(config: {
    enabled: boolean
    recipient: string
    twilioAccountSid?: string
    twilioAuthToken?: string
    twilioPhoneNumber?: string
  }): void {
    this.smsConfig = config
  }

  async sendEmailAlert(subject: string, message: string): Promise<boolean> {
    if (!this.emailConfig?.enabled || !this.emailConfig.recipient) return false
    console.log(`[network/notification] EMAIL To: ${this.emailConfig.recipient}, Subject: ${subject}`)
    console.log(`[network/notification] EMAIL Message: ${message}`)
    return true
  }

  async sendSMSAlert(message: string): Promise<boolean> {
    if (!this.smsConfig?.enabled || !this.smsConfig.recipient) return false
    console.log(`[network/notification] SMS To: ${this.smsConfig.recipient}, Message: ${message}`)
    return true
  }

  async sendOutageAlert(outage: OutageEvent): Promise<boolean> {
    const subject = `Network Outage Alert: ${outage.severity.toUpperCase()} - ${outage.type}`
    const message = [
      'Network Outage Detected',
      '',
      `Type: ${outage.type}`,
      `Severity: ${outage.severity}`,
      `Description: ${outage.description}`,
      `Start Time: ${new Date(outage.startTime).toISOString()}`,
      `Scope: ${outage.scope}`,
      `ISP: ${outage.isp || 'Unknown'}`,
      `Failure Point: ${outage.failurePoint || 'Unknown'}`,
    ].join('\n')

    const results = await Promise.allSettled([this.sendEmailAlert(subject, message), this.sendSMSAlert(message)])
    return results.some((r) => r.status === 'fulfilled' && r.value === true)
  }

  async sendHealthAlert(health: NetworkHealth): Promise<boolean> {
    const subject = `Network Health Alert: ${health.status.toUpperCase()}`
    const message = [
      'Network Health Status Changed',
      '',
      `Status: ${health.status}`,
      `Connectivity Score: ${health.connectivityScore}%`,
      `Latency: ${health.latency}ms`,
      `Packet Loss: ${health.packetLoss}%`,
    ].join('\n')

    const results = await Promise.allSettled([this.sendEmailAlert(subject, message), this.sendSMSAlert(message)])
    return results.some((r) => r.status === 'fulfilled' && r.value === true)
  }
}
