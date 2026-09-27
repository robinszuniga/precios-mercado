import { leerConfig } from '../../shared/src/config.ts'
import type { Observacion, Presentacion } from '../../shared/src/esquema.ts'
import { escaparFormula, type Fila } from '../../shared/src/seguridad.ts'
import type { TiendaVtex } from '../../shared/src/tiendas.ts'
import {
  peticionEan, peticionSku, planificarPeticiones, presentacionesAuto, procesarRespuesta,
  type Parche, type Peticion,
} from '../../shared/src/vtex/plan.ts'
import { aplicarCambios, guardarObservaciones, registrar } from './datos.ts'
import type { Servicios } from './puertos.ts'
import { obtenerContextos } from './regiones.ts'

export type EstadoJob = 'en_cola' | 'corriendo' | 'terminado' | 'error'

export interface Job {
  id: string
  estado: EstadoJob
  modo: 'manual' | 'diario'
  /** Presentaciones a actualizar; null = todas las automáticas. */
  ids: string[] | null
  total: number
  hechos: number
  actualizados: number
  errores: string[]
  inicio: string
  fin: string | null
  /** Índice en la lista base de peticiones (se reconstruye igual en cada tramo). */
  cursor: number
  /** Reintentos y búsquedas por EAN pendientes. */
  extras: { id: string; tipo: 'sku' | 'ean'; intento: number }[]
}

const PROP = 'JOB'
// 3 min de trabajo: Apps Script corta a los 6, y una tienda lenta (hasta 60 s por consulta) más la escritura final
// bajo el lock (hasta 30 s de espera) tienen que caber en el margen.
const LIMITE_MS = 180_000
/** Red de seguridad: si Google corta esta ejecución, la continuación arranca sola desde lo último guardado. */
const RESCATE_MS = 7 * 60_000
const MAX_INTENTOS = 2
const TAM_LOTE = 3

export function leerJob(s: Servicios): Job | null {
  const v = s.props.get(PROP)
  if (!v) return null
  try { return JSON.parse(v) as Job } catch { return null }
}

export function guardarJob(s: Servicios, job: Job) {
  s.props.set(PROP, JSON.stringify({ ...job, errores: job.errores.slice(-15), extras: job.extras.slice(0, 60) }))
}

export function nuevoJob(s: Servicios, modo: Job['modo'], ids: string[] | null): Job {
  return {
    id: s.uuid(), estado: 'en_cola', modo, ids, total: 0, hechos: 0, actualizados: 0, errores: [],
    inicio: s.reloj.ahora(), fin: null, cursor: 0, extras: [],
  }
}

/**
 * Corre un tramo del trabajo de actualización. Si se acerca el límite de Apps Script, guarda por dónde iba y
 * programa la continuación. El lock se toma solo para escribir, nunca mientras se consulta a las tiendas.
 */
export function ejecutarJob(s: Servicios, limiteMs = LIMITE_MS): Job | null {
  const job = leerJob(s)
  if (!job || job.estado === 'terminado' || job.estado === 'error') return job
  const t0 = s.reloj.ms()
  job.estado = 'corriendo'
  guardarJob(s, job)
  s.triggers.unaVez(RESCATE_MS)

  try {
    const cfg = leerConfig(s.repo.leer('Config') as { clave: string; valor: string }[])
    const ctx = obtenerContextos(s, cfg)
    if (ctx.cambiosConfig.length) {
      const ahora = s.reloj.ahora()
      s.lock.con(30_000, () =>
        aplicarCambios(s, ctx.cambiosConfig.map((c) => ({ tabla: 'Config', fila: { ...c, updated_at: ahora } })), new Set(['Config'])),
      )
    }

    const todas = s.repo.leer('Presentaciones') as unknown as Presentacion[]
    const auto = presentacionesAuto(todas, ctx.autoD1).filter((p) => !job.ids || job.ids.includes(p.presentacion_id))
    const porId = new Map(auto.map((p) => [p.presentacion_id, p]))
    const base = planificarPeticiones(auto, ctx.contextos)
    if (job.cursor === 0 && job.hechos === 0) job.total = base.length

    type Item = { pet: Peticion; esBase: boolean }
    const cola: Item[] = base.slice(job.cursor).map((pet) => ({ pet, esBase: true }))
    for (const x of job.extras) {
      const p = porId.get(x.id)
      if (!p) continue
      const pet = x.tipo === 'sku' ? peticionSku(p, ctx.contextos[p.tienda as TiendaVtex]) : peticionEan(p, ctx.contextos[p.tienda as TiendaVtex])
      cola.push({ pet: { ...pet, intento: x.intento }, esBase: false })
    }
    job.extras = []

    const obs: Observacion[] = []
    const parches = new Map<string, Parche>()
    const espaciado = cfg.espaciadoMs
    while (cola.length) {
      if (s.reloj.ms() - t0 > limiteMs) break
      const lote = cola.splice(0, TAM_LOTE)
      const resps = s.http.todas(lote.map((x) => ({ url: x.pet.url, cabeceras: x.pet.cabeceras })))
      let hubo429 = false
      lote.forEach((x, i) => {
        if (x.esBase) job.cursor++
        const p = porId.get(x.pet.presentacion_id)!
        const resp = resps[i]
        if (resp.status === 429) hubo429 = true
        const r = procesarRespuesta(x.pet, resp.status, resp.cuerpo, p, ctx.contextos[x.pet.tienda], s.reloj.ahora())
        if (r.tipo === 'obs') {
          obs.push(r.obs)
          if (r.parche) parches.set(p.presentacion_id, { ...parches.get(p.presentacion_id), ...r.parche })
          job.hechos++
        } else if (r.tipo === 'respaldo') {
          cola.push({ pet: r.peticion, esBase: false })
        } else if (r.tipo === 'reintentar' && x.pet.intento < MAX_INTENTOS) {
          cola.push({ pet: { ...x.pet, intento: x.pet.intento + 1 }, esBase: false })
        } else {
          job.hechos++
          job.errores.push(`${p.tienda} ${p.nombre_en_tienda || p.presentacion_id}: ${r.tipo === 'error' ? r.motivo : r.motivo + ' (sin más reintentos)'}`)
          if (r.tipo === 'error' && r.parche) parches.set(p.presentacion_id, { ...parches.get(p.presentacion_id), ...r.parche })
        }
      })
      if (cola.length) s.reloj.dormir(hubo429 ? Math.max(espaciado, 5000) : espaciado)
    }

    s.lock.con(30_000, () => {
      const r = guardarObservaciones(s, obs)
      job.actualizados += r.aplicadas
      if (parches.size) {
        // Se relee dentro del lock y solo se tocan los campos del servidor: si el usuario cambió la presentación
        // mientras corría el trabajo (la quitó, corrigió el tamaño), su cambio se respeta. updated_at no se toca
        // para que una edición del celular hecha antes no pierda contra este parche.
        const ahora = s.reloj.ahora()
        const frescas = new Map(s.repo.leer('Presentaciones').map((f) => [String(f.presentacion_id), f]))
        const filas: Fila[] = []
        for (const [id, parche] of parches) {
          const actual = frescas.get(id)
          // Lo que viene de la tienda también puede empezar por "=" o "+": nunca se escribe como fórmula.
          const seguro = Object.fromEntries(Object.entries(parche).map(([k, v]) => [k, typeof v === 'string' ? escaparFormula(v) : v]))
          if (actual) filas.push({ ...actual, ...seguro, _srv: ahora })
        }
        s.repo.guardar('Presentaciones', filas)
      }
    })

    if (cola.length) {
      job.extras = cola.filter((x) => !x.esBase).map((x) => ({ id: x.pet.presentacion_id, tipo: x.pet.tipo, intento: x.pet.intento }))
      job.estado = 'en_cola'
      guardarJob(s, job)
      s.triggers.unaVez(60_000)
    } else {
      job.estado = 'terminado'
      job.fin = s.reloj.ahora()
      guardarJob(s, job)
      s.triggers.borrarUnaVez()
    }
    registrar(s, 'precios', job.errores.length ? 'aviso' : 'info',
      `${job.modo}: ${job.hechos}/${job.total} consultados, ${job.actualizados} precios movidos, ${job.errores.length} errores`,
      { estado: job.estado, errores: job.errores.slice(-5) }, s.reloj.ms() - t0)
    return job
  } catch (e) {
    job.estado = 'error'
    job.fin = s.reloj.ahora()
    job.errores.push(String(e))
    guardarJob(s, job)
    s.triggers.borrarUnaVez()
    registrar(s, 'precios', 'error', `Falló la actualización: ${e}`)
    return job
  }
}
