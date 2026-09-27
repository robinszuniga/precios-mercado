import type { Config, RegionGuardada } from '../../shared/src/config.ts'
import { diasEntre } from '../../shared/src/fechas.ts'
import { INFO_TIENDAS, TIENDAS_VTEX, type TiendaVtex } from '../../shared/src/tiendas.ts'
import type { ContextoTienda, Contextos } from '../../shared/src/vtex/plan.ts'
import { estaLocalizada, parseRegiones } from '../../shared/src/vtex/region.ts'
import { armarSegmento, segmentoDeSetCookie } from '../../shared/src/vtex/segmento.ts'
import { urlRegiones } from '../../shared/src/vtex/urls.ts'
import type { Servicios } from './puertos.ts'

const DIAS_REGION = 7

/**
 * Resuelve la región de Riohacha de una tienda: primero por código postal, si no trae sellers por coordenadas.
 * El channel sale de la cookie vtex_segment que manda la home. El regionId nunca se escribe a mano.
 */
export function resolverRegion(s: Servicios, tienda: TiendaVtex, cfg: Config): RegionGuardada {
  const [home, porCp] = s.http.todas([
    { url: INFO_TIENDAS[tienda].home! },
    { url: urlRegiones(tienda, { cp: cfg.ubicacion.cp }) },
  ])
  const seg = segmentoDeSetCookie(home.setCookie)
  const channel = String(seg?.channel ?? '1')
  let r = parseRegiones(porCp.status, porCp.cuerpo)
  if (!estaLocalizada(r)) {
    const [porGeo] = s.http.todas([{ url: urlRegiones(tienda, { lon: cfg.ubicacion.lon, lat: cfg.ubicacion.lat }) }])
    const r2 = parseRegiones(porGeo.status, porGeo.cuerpo)
    if (estaLocalizada(r2) || !r) r = r2
  }
  return {
    regionId: r?.regionId ?? null,
    channel,
    sellers: r?.sellers ?? [],
    localizada: estaLocalizada(r),
    fecha: s.reloj.ahora(),
  }
}

export function contextoDe(g: RegionGuardada | undefined): ContextoTienda {
  if (g?.localizada && g.regionId) {
    return { segmento: armarSegmento(g.regionId, g.channel), sellers: g.sellers, region: 'RIOHACHA' }
  }
  return { segmento: null, sellers: [], region: 'DEFAULT' }
}

export interface ContextosResueltos {
  contextos: Contextos
  regiones: Partial<Record<TiendaVtex, RegionGuardada>>
  /** Filas de Config a guardar (con el lock) si se resolvió algo nuevo. */
  cambiosConfig: { clave: string; valor: string }[]
  autoD1: boolean
}

/** Usa la región guardada si tiene menos de 7 días; si no (o si se fuerza), la vuelve a pedir. */
export function obtenerContextos(s: Servicios, cfg: Config, forzar: readonly TiendaVtex[] = []): ContextosResueltos {
  const ahora = s.reloj.ahora()
  const contextos: Contextos = {}
  const regiones: ContextosResueltos['regiones'] = {}
  const cambiosConfig: ContextosResueltos['cambiosConfig'] = []
  for (const t of TIENDAS_VTEX) {
    let g = cfg.regiones[t]
    const vieja = !g || diasEntre(g.fecha, ahora) >= DIAS_REGION
    if (vieja || forzar.includes(t)) {
      try {
        g = resolverRegion(s, t, cfg)
        cambiosConfig.push({ clave: `region.${t}`, valor: JSON.stringify(g) })
        if (t === 'D1') cambiosConfig.push({ clave: 'tienda_auto.D1', valor: g.localizada ? 'si' : 'no' })
      } catch (e) {
        s.log(`No se pudo resolver la región de ${t}: ${e}`)
      }
    }
    if (g) regiones[t] = g
    contextos[t] = contextoDe(g)
  }
  const autoD1 = regiones.D1 ? regiones.D1.localizada : cfg.autoD1
  return { contextos, regiones, cambiosConfig, autoD1 }
}
