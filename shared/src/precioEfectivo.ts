import type { Fuente, Origen, PrecioActual, Region } from './esquema.ts'
import { diasEntre } from './fechas.ts'

export interface Vigencias {
  /** Días que vale un precio online. */
  auto: number
  /** Hasta aquí un precio de tienda está al día. */
  tiendaAmarillo: number
  /** Más allá de esto un precio de tienda sale de la recomendación. */
  tiendaMax: number
}

export const VIGENCIAS_POR_DEFECTO: Vigencias = { auto: 3, tiendaAmarillo: 30, tiendaMax: 60 }

/** tienda: lo viste o pagaste en la tienda. online: API con región de Riohacha. online_nac: API sin región (precio nacional). */
export type Distintivo = 'tienda' | 'online' | 'online_nac'

export interface PrecioEfectivo {
  precio: number
  precio_lista: number | null
  oferta: boolean
  origen: Origen
  fuente: Fuente
  region: Region
  fecha: string
  edadDias: number
  /** amarillo = precio de tienda viejo (entre tiendaAmarillo y tiendaMax días). */
  estado: 'vigente' | 'amarillo'
  distintivo: Distintivo
}

export interface EvaluacionPrecio {
  efectivo: PrecioEfectivo | null
  /** El precio más reciente conocido aunque esté vencido, para mostrarlo en gris. */
  ultimo: PrecioActual | null
  agotadoOnline: boolean
}

function aEfectivo(a: PrecioActual, edad: number, estado: PrecioEfectivo['estado']): PrecioEfectivo {
  return {
    precio: a.precio!,
    precio_lista: a.precio_lista,
    oferta: a.precio_lista != null && a.precio! < a.precio_lista,
    origen: a.origen,
    fuente: a.fuente,
    region: a.region,
    fecha: a.fecha_verificado,
    edadDias: edad,
    estado,
    distintivo: a.origen === 'tienda' ? 'tienda' : a.region === 'DEFAULT' ? 'online_nac' : 'online',
  }
}

/**
 * Qué precio vale para una presentación. El de tienda manda sobre el online:
 * 1. tienda al día  2. online al día  3. tienda viejo (amarillo)  4. nada.
 */
export function precioEfectivo(actuales: readonly PrecioActual[], v: Vigencias, ahora: string): EvaluacionPrecio {
  const tienda = actuales.find((a) => a.origen === 'tienda' && a.precio != null && a.precio > 0)
  const online = actuales.find((a) => a.origen === 'online')
  const conPrecio = actuales.filter((a) => a.precio != null && a.precio > 0)
  const ultimo = conPrecio.sort((a, b) => (a.fecha_verificado < b.fecha_verificado ? 1 : -1))[0] ?? null
  const agotadoOnline = online != null && !online.disponible

  const edadTienda = tienda ? diasEntre(tienda.fecha_verificado, ahora) : Infinity
  if (tienda && edadTienda <= v.tiendaAmarillo) return { efectivo: aEfectivo(tienda, edadTienda, 'vigente'), ultimo, agotadoOnline }

  if (online && online.disponible && online.precio != null && online.precio > 0) {
    const edad = diasEntre(online.fecha_verificado, ahora)
    if (edad <= v.auto) return { efectivo: aEfectivo(online, edad, 'vigente'), ultimo, agotadoOnline }
  }

  if (tienda && edadTienda <= v.tiendaMax) return { efectivo: aEfectivo(tienda, edadTienda, 'amarillo'), ultimo, agotadoOnline }

  return { efectivo: null, ultimo, agotadoOnline }
}
