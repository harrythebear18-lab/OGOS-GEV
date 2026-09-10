/* DNS resolution testing — ported from OGOS. */
import { exec } from 'child_process'
import type { DNSTestResult } from './types'

export class DNSTestService {
  private readonly defaultServers = [
    { name: 'Google DNS', ip: '8.8.8.8' },
    { name: 'Cloudflare DNS', ip: '1.1.1.1' },
    { name: 'OpenDNS', ip: '208.67.222.222' },
    { name: 'Quad9', ip: '9.9.9.9' },
    { name: 'Comodo DNS', ip: '8.26.56.26' },
  ]

  async testDNSServer(server: string, ip: string): Promise<DNSTestResult> {
    const startTime = Date.now()
    return new Promise((resolve) => {
      exec(
        `nslookup google.com ${ip}`,
        { windowsHide: true, timeout: 5000 },
        (error) => {
          const latency = Date.now() - startTime
          resolve({ server, ip, latency, success: !error, timestamp: Date.now() })
        },
      )
    })
  }

  async testAllServers(servers?: Array<{ name: string; ip: string }>): Promise<DNSTestResult[]> {
    const serversToTest = servers || this.defaultServers
    const settled = await Promise.allSettled(serversToTest.map((s) => this.testDNSServer(s.name, s.ip)))
    const results: DNSTestResult[] = []
    for (const r of settled) if (r.status === 'fulfilled') results.push(r.value)
    console.log(`[network/dns-test] tested ${results.length} servers`)
    return results.sort((a, b) => a.latency - b.latency)
  }

  async testCustomServers(servers: string[]): Promise<DNSTestResult[]> {
    return this.testAllServers(servers.map((ip, i) => ({ name: `Custom DNS ${i + 1}`, ip })))
  }

  getDefaultServers(): Array<{ name: string; ip: string }> {
    return [...this.defaultServers]
  }
}
