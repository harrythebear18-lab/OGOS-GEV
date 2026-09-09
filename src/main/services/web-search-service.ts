/**
 * Web Search Service — targeted OSINT queries via free, keyless APIs.
 * Ported from OSINT-Global-OS.
 * Sources: DuckDuckGo, Wikipedia, NWS, Nominatim.
 */

import type { LngLat, WebSearchRequest, WebSearchResponse, WebSearchResult } from '@shared/types'

async function searchDuckDuckGo(query: string): Promise<WebSearchResult[]> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OSINT-Sentinel-Workstation/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const data = await res.json() as any

    const results: WebSearchResult[] = []
    if (data.AbstractText) {
      results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || '' })
    }
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text) {
          results.push({ title: topic.Text.split(' - ')[0] || 'Related', snippet: topic.Text, url: topic.FirstURL || '' })
        }
      }
    }
    return results
  } catch {
    return []
  }
}

async function searchWikipedia(query: string): Promise<WebSearchResult[]> {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) })
    if (!searchRes.ok) return []
    const searchData = await searchRes.json() as any
    const articles = searchData?.query?.search
    if (!articles || articles.length === 0) return []

    const results: WebSearchResult[] = []
    for (const article of articles.slice(0, 3)) {
      const title = article.title
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      try {
        const sumRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(10000) })
        if (sumRes.ok) {
          const sum = await sumRes.json() as any
          results.push({
            title: sum.title || title,
            snippet: sum.extract || article.snippet || '',
            url: sum.content_urls?.desktop?.page || '',
          })
        }
      } catch { /* skip */ }
    }
    return results
  } catch {
    return []
  }
}

async function getNwsAlerts(lng: number, lat: number): Promise<WebSearchResult[]> {
  try {
    const alertUrl = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`
    const alertRes = await fetch(alertUrl, {
      headers: { 'User-Agent': 'OSINT-Sentinel-Workstation/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!alertRes.ok) return []
    const alertData = await alertRes.json() as any
    const results: WebSearchResult[] = []
    for (const feature of (alertData.features || []).slice(0, 5)) {
      const props = feature.properties
      results.push({
        title: `${props.event} — ${props.areaDesc}`,
        snippet: props.description?.slice(0, 500) || props.headline || 'Active weather alert',
        url: props.id || '',
      })
    }
    return results
  } catch {
    return []
  }
}

async function reverseGeocode(lng: number, lat: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=12`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OSINT-Sentinel-Workstation/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json() as any
    return data.display_name || null
  } catch {
    return null
  }
}

export async function webSearch(req: WebSearchRequest, location?: LngLat): Promise<WebSearchResponse> {
  const results: WebSearchResult[] = []

  if (location) {
    const nws = await getNwsAlerts(location.lng, location.lat)
    results.push(...nws)

    const place = await reverseGeocode(location.lng, location.lat)
    if (place) results.push({ title: 'Location', snippet: place, url: '' })
  }

  const [ddg, wiki] = await Promise.all([
    searchDuckDuckGo(req.query),
    searchWikipedia(req.query),
  ])
  results.push(...ddg, ...wiki)

  const limit = req.limit ?? 10
  return { results: results.slice(0, limit) }
}
