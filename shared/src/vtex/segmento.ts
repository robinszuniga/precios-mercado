import { aBase64, deBase64 } from '../base64.ts'

/** Contenido de la cookie vtex_segment. Solo se tocan regionId y channel; el resto se conserva. */
export type Segmento = Record<string, unknown> & { regionId?: string | null; channel?: string }

const BASE_COLOMBIA: Segmento = {
  campaigns: null,
  channel: '1',
  priceTables: null,
  regionId: null,
  utm_campaign: null,
  utm_source: null,
  utmi_campaign: null,
  currencyCode: 'COP',
  currencySymbol: '$',
  countryCode: 'COL',
  cultureInfo: 'es-CO',
  channelPrivacy: 'public',
}

export function decodificarSegmento(cookie: string): Segmento | null {
  try {
    const v = JSON.parse(deBase64(decodeURIComponent(cookie)))
    return v && typeof v === 'object' ? (v as Segmento) : null
  } catch {
    return null
  }
}

export function armarSegmento(regionId: string, channel?: string, base?: Segmento | null): string {
  const s: Segmento = { ...BASE_COLOMBIA, ...(base ?? {}), regionId }
  if (channel) s.channel = channel
  return aBase64(JSON.stringify(s))
}

/** Busca vtex_segment=... en uno o varios Set-Cookie. */
export function segmentoDeSetCookie(setCookie: string | string[] | undefined): Segmento | null {
  const lista = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  for (const c of lista) {
    const m = /(?:^|[;,\s])vtex_segment=([^;,\s]+)/.exec(c)
    if (m) {
      const s = decodificarSegmento(m[1])
      if (s) return s
    }
  }
  return null
}

export function cabeceraCookie(segmento: string): string {
  return `vtex_segment=${segmento}`
}
