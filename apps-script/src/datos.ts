import { TABLAS, type NombreTabla, type Observacion, type PrecioActual } from '../../shared/src/esquema.ts'
import { compararIso, esIso, sumarSegundos } from '../../shared/src/fechas.ts'
import { aplicarObservaciones } from '../../shared/src/observaciones.ts'
import { escaparFormula, validarFila, type Fila } from '../../shared/src/seguridad.ts'
import { esTienda } from '../../shared/src/tiendas.ts'
import type { Servicios } from './puertos.ts'

export type ResultadoFila = {
  id: string
  r: 'aplicado' | 'igual' | 'antiguo' | 'error'
  msg?: string
  /** Con 'antiguo': la fila vigente del servidor, para que el celular la tome y no queden distintos. */
  tabla?: NombreTabla
  fila?: Fila
}

function sinSrv(f: Fila): string {
  const { _srv, ...resto } = f
  return JSON.stringify(Object.keys(resto).sort().map((k) => [k, resto[k] ?? null]))
}

/**
 * Decide qué filas entrantes se guardan (gana el updated_at mayor). Es idempotente: reenviar lo mismo da 'igual'.
 * Las filas ya vienen validadas.
 */
export function planUpsert(tabla: NombreTabla, existentes: readonly Fila[], entrantes: readonly Fila[], srv: string) {
  const idCol = TABLAS[tabla].id
  const porId = new Map(existentes.map((f) => [String(f[idCol]), f]))
  const aGuardar = new Map<string, Fila>()
  const resultados: ResultadoFila[] = []
  for (const e of entrantes) {
    const id = String(e[idCol])
    const previa = aGuardar.get(id) ?? porId.get(id)
    if (previa) {
      const pu = String(previa.updated_at ?? '')
      const eu = String(e.updated_at ?? '')
      if (esIso(pu) && esIso(eu) && compararIso(eu, pu) < 0) { resultados.push({ id, r: 'antiguo', tabla, fila: previa }); continue }
      if (sinSrv({ ...previa, ...e }) === sinSrv(previa)) { resultados.push({ id, r: 'igual' }); continue }
    }
    aGuardar.set(id, { ...(previa ?? {}), ...e, _srv: srv })
    resultados.push({ id, r: 'aplicado' })
  }
  return { aGuardar: [...aGuardar.values()], resultados }
}

export function validarObservacion(v: unknown): { ok: true; obs: Observacion } | { ok: false; error: string } {
  if (!v || typeof v !== 'object') return { ok: false, error: 'observación inválida' }
  const o = v as Record<string, unknown>
  const precio = o.precio == null || o.precio === '' ? null : Number(o.precio)
  const lista = o.precio_lista == null || o.precio_lista === '' ? null : Number(o.precio_lista)
  if (typeof o.obs_id !== 'string' || !o.obs_id) return { ok: false, error: 'falta obs_id' }
  if (typeof o.presentacion_id !== 'string' || !o.presentacion_id) return { ok: false, error: 'falta presentacion_id' }
  if (!esTienda(o.tienda)) return { ok: false, error: 'tienda inválida' }
  if (o.origen !== 'online' && o.origen !== 'tienda') return { ok: false, error: 'origen inválido' }
  if (o.fuente !== 'auto' && o.fuente !== 'manual' && o.fuente !== 'compra') return { ok: false, error: 'fuente inválida' }
  if (precio != null && !(Number.isFinite(precio) && precio >= 0)) return { ok: false, error: 'precio inválido' }
  if (lista != null && !Number.isFinite(lista)) return { ok: false, error: 'precio_lista inválido' }
  if (!esIso(o.fecha_observado)) return { ok: false, error: 'fecha_observado inválida' }
  const region = o.region === 'RIOHACHA' || o.region === 'DEFAULT' ? o.region : ''
  return {
    ok: true,
    obs: {
      obs_id: o.obs_id,
      presentacion_id: escaparFormula(o.presentacion_id),
      tienda: o.tienda,
      origen: o.origen,
      fuente: o.fuente,
      precio: precio == null ? null : Math.round(precio),
      precio_lista: lista == null ? null : Math.round(lista),
      disponible: o.disponible !== false,
      region,
      fecha_observado: o.fecha_observado,
      compra_id: typeof o.compra_id === 'string' ? escaparFormula(o.compra_id) : '',
    },
  }
}

function aActual(f: Fila): PrecioActual {
  return f as unknown as PrecioActual
}

/** Guarda observaciones: Precios_actuales y, si cambió algo, una fila en el histórico. Llamar con el lock tomado. */
export function guardarObservaciones(s: Servicios, obs: readonly Observacion[]): { aplicadas: number; sinEfecto: string[] } {
  if (obs.length === 0) return { aplicadas: 0, sinEfecto: [] }
  const actuales = new Map(s.repo.leer('Precios_actuales').map((f) => [String(f.clave), aActual(f)]))
  const ids = new Set(s.repo.leer('Precios').map((f) => String(f.precio_id)))
  const r = aplicarObservaciones(actuales, obs, ids)
  const srv = s.reloj.ahora()
  if (r.actuales.length) s.repo.guardar('Precios_actuales', r.actuales.map((a) => ({ ...a, _srv: srv }) as unknown as Fila))
  if (r.historial.length) s.repo.agregar('Precios', r.historial as unknown as Fila[])
  return { aplicadas: r.actuales.length, sinEfecto: r.sinEfecto }
}

export interface Cambio {
  tabla: string
  fila: unknown
}

/** Aplica un lote de cambios del cliente. Llamar con el lock tomado. */
export function aplicarCambios(s: Servicios, cambios: readonly Cambio[], tablasPermitidas?: ReadonlySet<string>): ResultadoFila[] {
  const srv = s.reloj.ahora()
  const resultados: ResultadoFila[] = []
  const porTabla = new Map<NombreTabla, Fila[]>()
  const observaciones: Observacion[] = []
  for (const c of cambios) {
    if (c.tabla === 'Observaciones') {
      const v = validarObservacion(c.fila)
      // Un celular con el reloj adelantado no puede dejar un precio "del futuro" que tape los siguientes.
      if (v.ok && compararIso(v.obs.fecha_observado, sumarSegundos(srv, 300)) > 0) v.obs.fecha_observado = srv
      if (v.ok) observaciones.push(v.obs)
      else resultados.push({ id: String((c.fila as Fila)?.obs_id ?? '?'), r: 'error', msg: v.error })
      continue
    }
    const tabla = c.tabla as NombreTabla
    const permitida = tablasPermitidas ? tablasPermitidas.has(tabla) : TABLAS[tabla]?.cliente
    if (!(tabla in TABLAS) || !permitida) {
      resultados.push({ id: '?', r: 'error', msg: `tabla ${c.tabla} no permitida` })
      continue
    }
    const v = validarFila(tabla, c.fila, !tablasPermitidas)
    if (!v.ok) {
      const id = (c.fila as Fila | null)?.[TABLAS[tabla].id]
      resultados.push({ id: String(id ?? '?'), r: 'error', msg: v.error })
      continue
    }
    porTabla.set(tabla, [...(porTabla.get(tabla) ?? []), v.fila])
  }
  for (const [tabla, filas] of porTabla) {
    const plan = planUpsert(tabla, s.repo.leer(tabla), filas, srv)
    if (plan.aGuardar.length) s.repo.guardar(tabla, plan.aGuardar)
    resultados.push(...plan.resultados)
  }
  if (observaciones.length) {
    const r = guardarObservaciones(s, observaciones)
    const sin = new Set(r.sinEfecto)
    for (const o of observaciones) resultados.push({ id: o.obs_id, r: sin.has(o.obs_id) ? 'igual' : 'aplicado' })
  }
  return resultados
}

export function registrar(s: Servicios, tipo: string, nivel: 'info' | 'aviso' | 'error', mensaje: string, datos?: unknown, duracionMs?: number) {
  const texto = datos === undefined ? '' : JSON.stringify(datos).slice(0, 1000)
  try {
    s.repo.agregar('Log', [{ fecha: s.reloj.ahora(), tipo, nivel, mensaje: escaparFormula(mensaje), datos: escaparFormula(texto), duracion_ms: duracionMs ?? null }])
    s.repo.recortar('Log', 500)
  } catch (e) {
    s.log(`No se pudo escribir el log: ${e}`)
  }
}
