import { VERSION_API } from '@shared/esquema.ts'

export interface Conexion {
  url: string
  token: string
}

export type ResultadoApi<T> =
  | { tipo: 'ok'; data: T }
  | { tipo: 'error'; codigo: string; mensaje: string; datos?: unknown }
  /** No se sabe si el servidor lo hizo (sin señal, timeout, HTML, 404 de Google). Se reintenta: todo es idempotente. */
  | { tipo: 'desconocido'; motivo: string }

export function nuevoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/** Los errores de configuración dicen qué hacer, no solo qué pasó. */
const QUE_HACER: Record<string, string> = {
  sin_configurar: 'La dirección /exec es de un proyecto de Apps Script sin configurar. En Ajustes toca “Guardar y probar” para ver cuál es.',
  accion_desconocida: 'Tu script de Google está desactualizado: pega el Code.js nuevo y en Implementar → Gestionar implementaciones elige “Nueva versión”.',
  token_invalido: 'La clave (token) no coincide con la del script. Cópiala de Apps Script → Configuración del proyecto → Propiedades → TOKEN y pégala en Ajustes.',
}

function interpretar<T>(texto: string): ResultadoApi<T> {
  const t = texto.trimStart()
  if (!t.startsWith('{')) return { tipo: 'desconocido', motivo: `respuesta no es JSON: ${t.slice(0, 60)}` }
  try {
    const r = JSON.parse(t) as { ok: boolean; data: T; error: { codigo: string; mensaje: string; datos?: unknown } | null }
    if (r.ok) return { tipo: 'ok', data: r.data }
    const codigo = r.error?.codigo ?? 'interno'
    return { tipo: 'error', codigo, mensaje: QUE_HACER[codigo] ?? r.error?.mensaje ?? 'Error', datos: r.error?.datos }
  } catch {
    return { tipo: 'desconocido', motivo: 'JSON inválido' }
  }
}

/**
 * POST sin cabeceras propias: el cuerpo va como text/plain para que el navegador no mande el preflight
 * OPTIONS que Apps Script no sabe atender.
 */
export async function llamar<T>(c: Conexion, accion: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<ResultadoApi<T>> {
  if (!c.url || !c.token) return { tipo: 'error', codigo: 'sin_conexion', mensaje: 'Configura la URL y el token en Ajustes' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { tipo: 'desconocido', motivo: 'sin señal' }
  const ctrl = new AbortController()
  const reloj = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(c.url, {
      method: 'POST',
      body: JSON.stringify({ a: accion, t: c.token, v: VERSION_API, req: nuevoId(), ...params }),
      redirect: 'follow',
      signal: ctrl.signal,
    })
    return interpretar<T>(await res.text())
  } catch (e) {
    return { tipo: 'desconocido', motivo: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(reloj)
  }
}

/** Lo que responde el GET público. Los tres últimos campos no existen en backends anteriores. */
export interface InfoPing {
  app: string
  v: number
  /** Últimos 6 caracteres del id del proyecto de Apps Script. */
  proyecto?: string
  /** El proyecto tiene TOKEN (se ejecutó inicializarHoja). */
  configurado?: boolean
  hoja?: boolean
}

/** GET sin token: dice si la URL es la de este backend, de qué proyecto y si está configurado. */
export async function ping(url: string): Promise<ResultadoApi<InfoPing>> {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    return interpretar(await res.text())
  } catch (e) {
    return { tipo: 'desconocido', motivo: e instanceof Error ? e.message : String(e) }
  }
}
