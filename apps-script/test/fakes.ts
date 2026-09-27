import { TABLAS, NOMBRES_TABLAS, type NombreTabla } from '../../shared/src/esquema.ts'
import { isoBogota } from '../../shared/src/fechas.ts'
import type { Fila } from '../../shared/src/seguridad.ts'
import { Ocupado, type PeticionHttp, type RespuestaHttp, type Servicios } from '../src/puertos.ts'

export class RepoMem {
  tablas = new Map<NombreTabla, Fila[]>(NOMBRES_TABLAS.map((t) => [t, []]))
  escrituras = 0
  leer(t: NombreTabla) { return this.tablas.get(t)!.map((f) => ({ ...f })) }
  guardar(t: NombreTabla, filas: readonly Fila[]) {
    this.escrituras++
    const id = TABLAS[t].id
    const xs = this.tablas.get(t)!
    for (const f of filas) {
      const i = xs.findIndex((x) => x[id] === f[id])
      if (i >= 0) xs[i] = { ...xs[i], ...f }
      else xs.push({ ...f })
    }
  }
  agregar(t: NombreTabla, filas: readonly Fila[]) { this.escrituras++; this.tablas.get(t)!.push(...filas.map((f) => ({ ...f }))) }
  recortar(t: NombreTabla, max: number) { const xs = this.tablas.get(t)!; if (xs.length > max) xs.splice(0, xs.length - max) }
  pestanasFaltantes() { return [] }
}

export type Responder = (p: PeticionHttp) => RespuestaHttp

export function crearServicios(opciones: { responder?: Responder; inicio?: number; lockOcupado?: boolean } = {}) {
  let ms = opciones.inicio ?? Date.parse('2026-09-27T10:00:00.000-05:00')
  const repo = new RepoMem()
  const props = new Map<string, string>([['TOKEN', 'secreto']])
  const cache = new Map<string, string>()
  const pedidas: PeticionHttp[] = []
  const triggers: string[] = []
  let n = 0
  const s: Servicios = {
    repo,
    http: {
      todas: (ps) => ps.map((p) => {
        pedidas.push(p)
        ms += 300
        return opciones.responder ? opciones.responder(p) : { status: 200, cuerpo: '[]', setCookie: [] }
      }),
    },
    lock: { con: (_t, fn) => { if (opciones.lockOcupado) throw new Ocupado(); return fn() } },
    cache: { get: (k) => cache.get(k) ?? null, put: (k, v) => { cache.set(k, v) } },
    props: { get: (k) => props.get(k) ?? null, set: (k, v) => { props.set(k, v) }, borrar: (k) => { props.delete(k) } },
    reloj: { ahora: () => isoBogota(ms), ms: () => ms, dormir: (d) => { ms += d } },
    triggers: {
      unaVez: (d) => { triggers.push(`unaVez:${d}`) },
      borrarUnaVez: () => { triggers.push('borrar') },
      asegurarDiario: () => {},
      listar: () => ['tareaDiaria (CLOCK)'],
    },
    uuid: () => `uuid-${++n}`,
    log: () => {},
  }
  return {
    s, repo, props, pedidas, triggers,
    avanzar: (d: number) => { ms += d },
  }
}

export const AHORA = '2026-09-27T10:00:00.000-05:00'
