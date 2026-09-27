import { VERSION_API } from '../../shared/src/esquema.ts'
import * as A from './acciones.ts'
import { ErrorApi } from './acciones.ts'
import { Ocupado, type Servicios } from './puertos.ts'

export interface Respuesta {
  ok: boolean
  data: unknown
  error: { codigo: string; mensaje: string; datos?: unknown } | null
  v: number
  srv: string
}

type Accion = (s: Servicios, p: Record<string, unknown>) => unknown

/** Lista cerrada de acciones que requieren token. */
const ACCIONES: Record<string, Accion> = {
  ping: () => A.ping(),
  diag: (s) => A.diag(s),
  pull: A.pull,
  upsert: A.upsert,
  cerrarCompra: A.cerrarCompra,
  historialPrecios: A.historialPrecios,
  buscarEnTienda: A.buscarEnTienda,
  probarRegion: A.probarRegion,
  actualizarPrecios: A.actualizarPrecios,
  estadoJob: (s) => A.estadoJob(s),
}

function comparar(a: string, b: string): boolean {
  // Comparación en tiempo constante respecto al contenido.
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export function responder(s: Servicios, data: unknown, error: Respuesta['error'] = null): Respuesta {
  return { ok: !error, data: error ? null : data, error, v: VERSION_API, srv: s.reloj.ahora() }
}

/** doPost: cuerpo JSON enviado como text/plain (application/json dispara un preflight que Apps Script no atiende). */
export function manejarPost(s: Servicios, cuerpo: string): Respuesta {
  let p: Record<string, unknown>
  try {
    const v = JSON.parse(cuerpo)
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    p = v
  } catch {
    return responder(s, null, { codigo: 'json_invalido', mensaje: 'El cuerpo no es JSON' })
  }
  const token = s.props.get('TOKEN')
  if (!token) return responder(s, null, { codigo: 'sin_configurar', mensaje: 'Ejecuta inicializarHoja en el editor de Apps Script' })
  if (typeof p.t !== 'string' || !comparar(p.t, token)) return responder(s, null, { codigo: 'token_invalido', mensaje: 'Token inválido' })
  if (p.v != null && p.v !== VERSION_API) {
    return responder(s, null, { codigo: 'version', mensaje: `La app usa la versión ${p.v} del API y el backend la ${VERSION_API}` })
  }
  const nombre = typeof p.a === 'string' ? p.a : ''
  const accion = Object.prototype.hasOwnProperty.call(ACCIONES, nombre) ? ACCIONES[nombre] : undefined
  if (!accion) return responder(s, null, { codigo: 'accion_desconocida', mensaje: `Acción desconocida: ${nombre}` })
  const t0 = s.reloj.ms()
  try {
    return responder(s, accion(s, p))
  } catch (e) {
    if (e instanceof Ocupado) return responder(s, null, { codigo: 'ocupado', mensaje: 'El Sheet está ocupado, reintenta' })
    if (e instanceof ErrorApi) return responder(s, null, { codigo: e.codigo, mensaje: e.message, datos: e.datos })
    A.registrar(s, 'api', 'error', `${nombre}: ${e}`, undefined, s.reloj.ms() - t0)
    return responder(s, null, { codigo: 'interno', mensaje: String(e) })
  }
}

/** doGet: solo ping, sin token. Sin parámetros responde lo mismo (hay rebotes /exec → /echo que llegan como GET vacío). */
export function manejarGet(s: Servicios): Respuesta {
  return responder(s, A.ping())
}
