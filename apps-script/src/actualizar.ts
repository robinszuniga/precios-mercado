import type { Props } from './puertos.ts'
import { VERSION_CODIGO } from './version.ts'

/**
 * El script se actualiza con el cargador (apps-script/cargador/Cargador.js): es lo único pegado en Apps Script; baja
 * de los releases de GitHub el Code.js de la última versión publicada, lo guarda en las propiedades del script y lo
 * ejecuta. Este código solo le pide al cargador que revise; si se pegó el Code.js completo (sin cargador), lo dice.
 */

export const REPO = 'robinszuniga/precios-mercado'
const PROP = 'ACTUALIZACION'

export type EstadoActualizacion = 'al_dia' | 'actualizado' | 'necesita_permiso' | 'sin_cargador' | 'error'

export interface ResultadoActualizacion {
  estado: EstadoActualizacion
  actual: string
  nueva: string | null
  mensaje: string
  fecha: string
  /** Versión del cargador; null si el código se pegó completo, sin cargador. */
  cargador?: number | null
}

// Los define el cargador, que evalúa este código: existen solo si se pegó el cargador.
declare const pmActualizar_: (() => ResultadoActualizacion) | undefined
declare const PM_CARGADOR: number | undefined

export function versionCargador(): number | null {
  return typeof PM_CARGADOR === 'number' ? PM_CARGADOR : null
}

export function ultimaActualizacion(props: Props): ResultadoActualizacion | null {
  const v = props.get(PROP)
  if (!v) return null
  try { return JSON.parse(v) as ResultadoActualizacion } catch { return null }
}

export function actualizarCodigo(props: Props, ahora: string): ResultadoActualizacion {
  if (typeof pmActualizar_ === 'function') return pmActualizar_()
  const r: ResultadoActualizacion = {
    estado: 'sin_cargador',
    actual: VERSION_CODIGO,
    nueva: null,
    mensaje: 'Para que se actualice solo, pega el cargador (Cargador.js) en Apps Script en lugar de este código, una sola vez.',
    fecha: ahora,
    cargador: null,
  }
  props.set(PROP, JSON.stringify(r))
  return r
}
