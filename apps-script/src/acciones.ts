import { leerConfig } from '../../shared/src/config.ts'
import { NOMBRES_TABLAS, TABLAS_SYNC, VERSION_API, VERSION_ESQUEMA, type Presentacion } from '../../shared/src/esquema.ts'
import { aMs, compararIso, esIso, sumarSegundos } from '../../shared/src/fechas.ts'
import type { Fila } from '../../shared/src/seguridad.ts'
import { esTiendaVtex, TIENDAS_VTEX, type TiendaVtex } from '../../shared/src/tiendas.ts'
import { catalogoLegacy } from '../../shared/src/vtex/adaptador.ts'
import type { Candidato } from '../../shared/src/vtex/parse.ts'
import { aplicarCambios, registrar, type Cambio } from './datos.ts'
import { ejecutarJob, guardarJob, leerJob, nuevoJob, type Job } from './job.ts'
import type { Servicios } from './puertos.ts'
import { obtenerContextos } from './regiones.ts'

export class ErrorApi extends Error {
  codigo: string
  datos?: unknown
  constructor(codigo: string, mensaje: string, datos?: unknown) {
    super(mensaje)
    this.codigo = codigo
    this.datos = datos
  }
}

type Params = Record<string, unknown>
const MAX_CAMBIOS = 300
const MARGEN_PULL_S = 120
const ESPERA_BOTON_MIN = 15

function config(s: Servicios) {
  return leerConfig(s.repo.leer('Config') as { clave: string; valor: string }[])
}

function guardarCambiosConfig(s: Servicios, cambios: { clave: string; valor: string }[]) {
  if (!cambios.length) return
  const ahora = s.reloj.ahora()
  s.lock.con(30_000, () =>
    aplicarCambios(s, cambios.map((c) => ({ tabla: 'Config', fila: { ...c, updated_at: ahora } })), new Set(['Config'])),
  )
}

/** Público (sin token): dice qué proyecto responde y si está configurado, para detectar una URL /exec equivocada. */
export function ping(s: Servicios) {
  return {
    app: 'precios-mercado',
    v: VERSION_API,
    proyecto: s.proyecto(),
    configurado: !!s.props.get('TOKEN'),
    hoja: !!s.props.get('SHEET_ID'),
  }
}

export function diag(s: Servicios) {
  const conteos: Record<string, number> = {}
  const faltantes = s.repo.pestanasFaltantes()
  for (const t of NOMBRES_TABLAS) if (!faltantes.includes(t)) conteos[t] = s.repo.leer(t).length
  const cfg = config(s)
  const log = faltantes.includes('Log') ? [] : s.repo.leer('Log').slice(-20).reverse()
  return {
    v: VERSION_API,
    esquema: VERSION_ESQUEMA,
    pestanasFaltantes: faltantes,
    triggers: s.triggers.listar(),
    job: leerJob(s),
    regiones: cfg.regiones,
    autoD1: cfg.autoD1,
    conteos,
    log,
  }
}

/** Todo lo que cambió en el servidor desde `desde` (o todo si es null). */
export function pull(s: Servicios, p: Params) {
  const desde = esIso(p.desde) ? p.desde : null
  const inicio = s.reloj.ahora()
  const tablas: Record<string, Fila[]> = {}
  for (const t of TABLAS_SYNC) {
    const filas = s.repo.leer(t)
    tablas[t] = desde ? filas.filter((f) => esIso(f._srv) && compararIso(f._srv as string, desde) > 0) : filas
  }
  return { tablas, cursor: sumarSegundos(inicio, -MARGEN_PULL_S) }
}

export function upsert(s: Servicios, p: Params) {
  const cambios = p.cambios
  if (!Array.isArray(cambios)) throw new ErrorApi('validacion', 'cambios debe ser una lista')
  if (cambios.length > MAX_CAMBIOS) throw new ErrorApi('validacion', `máximo ${MAX_CAMBIOS} cambios por lote`)
  const resultados = s.lock.con(30_000, () => aplicarCambios(s, cambios as Cambio[]))
  return { resultados }
}

/** Cierre atómico: compra, detalle, precios pagados y resumen congelado, bajo un solo lock. */
export function cerrarCompra(s: Servicios, p: Params) {
  const compra = p.compra
  const detalle = Array.isArray(p.detalle) ? p.detalle : []
  const observaciones = Array.isArray(p.observaciones) ? p.observaciones : []
  const resumen = Array.isArray(p.resumen) ? p.resumen : []
  if (!compra || typeof compra !== 'object') throw new ErrorApi('validacion', 'falta compra')
  const cambios: Cambio[] = [
    { tabla: 'Compras', fila: compra },
    ...detalle.map((fila) => ({ tabla: 'Compras_detalle', fila })),
    ...observaciones.map((fila) => ({ tabla: 'Observaciones', fila })),
    ...resumen.map((fila) => ({ tabla: 'Compras_resumen', fila: { ...(fila as object), updated_at: undefined } })),
  ]
  const permitidas = new Set(['Compras', 'Compras_detalle', 'Compras_resumen'])
  const resultados = s.lock.con(30_000, () => aplicarCambios(s, cambios, permitidas))
  return { resultados }
}

export function historialPrecios(s: Servicios, p: Params) {
  const productoId = typeof p.productoId === 'string' ? p.productoId : ''
  if (!productoId) throw new ErrorApi('validacion', 'falta productoId')
  const ids = new Set(
    (s.repo.leer('Presentaciones') as unknown as Presentacion[]).filter((x) => x.producto_id === productoId).map((x) => x.presentacion_id),
  )
  const desde = esIso(p.desde) ? aMs(p.desde) : 0
  const filas = s.repo.leer('Precios').filter((f) => ids.has(String(f.presentacion_id)) && esIso(f.fecha_observado) && aMs(f.fecha_observado as string) >= desde)
  const actuales = s.repo.leer('Precios_actuales').filter((f) => ids.has(String(f.presentacion_id)))
  return { filas, actuales }
}

/** Busca en las tiendas (la PWA no puede llamarlas directo por CORS). Con tienda '*' busca un EAN en todas. */
export function buscarEnTienda(s: Servicios, p: Params) {
  const q = typeof p.q === 'string' ? p.q.trim().slice(0, 80) : ''
  const ean = typeof p.ean === 'string' ? p.ean.replace(/\D/g, '') : ''
  const sku = typeof p.sku === 'string' ? p.sku.replace(/[^\w-]/g, '') : ''
  const tiendas: TiendaVtex[] = p.tienda === '*' ? [...TIENDAS_VTEX] : esTiendaVtex(p.tienda) ? [p.tienda] : []
  if (!tiendas.length) throw new ErrorApi('validacion', 'tienda inválida')
  if (!q && !ean && !sku) throw new ErrorApi('validacion', 'falta q, ean o sku')
  if (p.tienda === '*' && !ean) throw new ErrorApi('validacion', 'buscar en todas las tiendas requiere EAN')

  const clave = `buscar:${tiendas.join(',')}:${q}:${ean}:${sku}`
  const guardado = s.cache.get(clave)
  if (guardado) return JSON.parse(guardado)

  const cfg = config(s)
  const ctx = obtenerContextos(s, cfg)
  guardarCambiosConfig(s, ctx.cambiosConfig)
  const a = catalogoLegacy
  const peticiones = tiendas.map((t) => {
    const sc = ctx.contextos[t]?.sc
    const url = ean ? a.urlEan(t, ean, sc) : sku ? a.urlSku(t, sku, sc) : a.urlTexto(t, q, 0, sc)
    const seg = ctx.contextos[t]?.segmento
    const cabeceras: Record<string, string> = { Accept: 'application/json' }
    if (seg) cabeceras.Cookie = `vtex_segment=${seg}`
    return { url, cabeceras }
  })
  const resps = s.http.todas(peticiones)
  const candidatos: (Candidato & { region: string })[] = []
  const errores: string[] = []
  tiendas.forEach((t, i) => {
    const r = a.interpretar(t, resps[i].status, resps[i].cuerpo, ctx.contextos[t]?.sellers ?? [])
    if (r.tipo !== 'ok') { errores.push(`${t}: ${r.motivo}`); return }
    for (const c of r.candidatos.slice(0, 30)) candidatos.push({ ...c, region: ctx.contextos[t]?.region ?? 'DEFAULT' })
  })
  const salida = { candidatos, errores }
  if (!errores.length) s.cache.put(clave, JSON.stringify(salida).slice(0, 95_000), 600)
  return salida
}

export function probarRegion(s: Servicios, p: Params) {
  const tienda = p.tienda
  if (!esTiendaVtex(tienda)) throw new ErrorApi('validacion', 'tienda inválida')
  const ctx = obtenerContextos(s, config(s), [tienda])
  guardarCambiosConfig(s, ctx.cambiosConfig)
  return { region: ctx.regiones[tienda] ?? null, contexto: ctx.contextos[tienda], autoD1: ctx.autoD1 }
}

function publico(j: Job | null) {
  if (!j) return null
  const { extras, cursor, ...resto } = j
  return resto
}

/** Dispara el trabajo en segundo plano; la app consulta estadoJob. */
export function actualizarPrecios(s: Servicios, p: Params) {
  const ids = Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === 'string') : null
  const previo = leerJob(s)
  const ahora = s.reloj.ms()
  if (previo && (previo.estado === 'en_cola' || previo.estado === 'corriendo') && ahora - aMs(previo.inicio) < 30 * 60_000) {
    return { job: publico(previo) }
  }
  if (previo?.estado === 'terminado' && previo.fin && ahora - aMs(previo.fin) < ESPERA_BOTON_MIN * 60_000 && !ids) {
    throw new ErrorApi('rate_limit', `Los precios se actualizaron hace menos de ${ESPERA_BOTON_MIN} minutos`, { job: publico(previo) })
  }
  const job = nuevoJob(s, 'manual', ids && ids.length ? ids : null)
  guardarJob(s, job)
  s.triggers.unaVez(1000)
  return { job: publico(job) }
}

export function estadoJob(s: Servicios) {
  return { job: publico(leerJob(s)) }
}

// ---------- Entradas de triggers ----------

export function tareaDiaria(s: Servicios) {
  const previo = leerJob(s)
  if (previo && (previo.estado === 'en_cola' || previo.estado === 'corriendo') && s.reloj.ms() - aMs(previo.inicio) < 30 * 60_000) {
    return ejecutarJob(s)
  }
  guardarJob(s, nuevoJob(s, 'diario', null))
  return ejecutarJob(s)
}

export function continuarPrecios(s: Servicios) {
  s.triggers.borrarUnaVez()
  return ejecutarJob(s)
}

export { registrar }
