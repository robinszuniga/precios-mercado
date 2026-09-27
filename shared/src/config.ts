import type { FilaConfig } from './esquema.ts'
import type { Vigencias } from './precioEfectivo.ts'
import type { TiendaVtex } from './tiendas.ts'

export interface Ubicacion {
  cp: string
  lon: number
  lat: number
}

export interface RegionGuardada {
  regionId: string | null
  channel: string
  sellers: string[]
  localizada: boolean
  fecha: string
}

export interface Config {
  vigencias: Vigencias
  alertaPresupuesto: number
  ahorroMinimoTienda: number
  ubicacion: Ubicacion
  espaciadoMs: number
  horaTrigger: number
  regiones: Partial<Record<TiendaVtex, RegionGuardada>>
  /** D1 solo va automático si su API atiende Riohacha. */
  autoD1: boolean
}

export const CONFIG_POR_DEFECTO: Record<string, string> = {
  vigencia_auto_dias: '3',
  vigencia_tienda_amarillo_dias: '30',
  vigencia_tienda_max_dias: '60',
  alerta_presupuesto: '0.85',
  ahorro_minimo_tienda: '3000',
  ubicacion: JSON.stringify({ cp: '440001', lon: -72.907, lat: 11.544 }),
  espaciado_ms: '1500',
  hora_trigger: '6',
  'tienda_auto.D1': 'no',
}

function num(v: string | undefined, def: number): number {
  const n = Number(v)
  return v != null && v !== '' && Number.isFinite(n) ? n : def
}

function json<T>(v: string | undefined, def: T): T {
  if (!v) return def
  try { return JSON.parse(v) as T } catch { return def }
}

export function leerConfig(filas: readonly Pick<FilaConfig, 'clave' | 'valor'>[]): Config {
  const m = new Map<string, string>(Object.entries(CONFIG_POR_DEFECTO))
  for (const f of filas) m.set(f.clave, f.valor)
  const regiones: Config['regiones'] = {}
  for (const t of ['EXITO', 'OLIMPICA', 'D1'] as const) {
    const r = json<RegionGuardada | null>(m.get(`region.${t}`), null)
    if (r) regiones[t] = r
  }
  return {
    vigencias: {
      auto: num(m.get('vigencia_auto_dias'), 3),
      tiendaAmarillo: num(m.get('vigencia_tienda_amarillo_dias'), 30),
      tiendaMax: num(m.get('vigencia_tienda_max_dias'), 60),
    },
    alertaPresupuesto: num(m.get('alerta_presupuesto'), 0.85),
    ahorroMinimoTienda: num(m.get('ahorro_minimo_tienda'), 3000),
    ubicacion: json(m.get('ubicacion'), { cp: '440001', lon: -72.907, lat: 11.544 }),
    espaciadoMs: num(m.get('espaciado_ms'), 1500),
    horaTrigger: num(m.get('hora_trigger'), 6),
    regiones,
    autoD1: m.get('tienda_auto.D1') === 'si',
  }
}
