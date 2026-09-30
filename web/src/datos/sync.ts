import { TABLAS, type NombreTabla, type PrecioActual } from '@shared/esquema.ts'
import { isoBogota } from '@shared/fechas.ts'
import { detectarCambio, type CambioPrecio } from '@shared/novedades.ts'
import { conservarOpcionales, ganaRemoto } from '@shared/sync.ts'
import { llamar, type Conexion } from './api.ts'
import { db, guardarMeta, leerMeta, TABLA_LOCAL, type EntradaOutbox } from './db.ts'

export interface EstadoSync {
  enCurso: boolean
  ultimoOk: number | null
  error: string | null
}

const ESPERAS_MS = [5_000, 15_000, 60_000, 300_000]
const MAX_CAMBIOS_LOTE = 100
const ERRORES_DE_CONFIG = new Set(['token_invalido', 'sin_conexion', 'sin_configurar', 'version'])

export async function conexion(): Promise<Conexion> {
  return leerMeta<Conexion>('conexion', { url: '', token: '' })
}

async function estado(parcial: Partial<EstadoSync>) {
  const previo = await leerMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  await guardarMeta('estadoSync', { ...previo, ...parcial })
}

/** Encola cambios para el servidor. Llamar dentro de la misma transacción que la escritura local. */
export async function encolar(tipo: EntradaOutbox['tipo'], payload: Record<string, unknown>) {
  await db.outbox.add({ tipo, payload, intentos: 0, proximo: 0, creado: Date.now() })
}

async function posponer(seqs: number[], motivo: string) {
  const ahora = Date.now()
  await db.transaction('rw', db.outbox, async () => {
    for (const seq of seqs) {
      const e = await db.outbox.get(seq)
      if (!e) continue
      const intentos = e.intentos + 1
      await db.outbox.update(seq, { intentos, proximo: ahora + ESPERAS_MS[Math.min(intentos - 1, ESPERAS_MS.length - 1)], error: motivo })
    }
  })
}

async function rechazar(entradas: EntradaOutbox[], mensaje: string) {
  await db.transaction('rw', db.outbox, db.rechazados, async () => {
    for (const e of entradas) {
      await db.rechazados.add({ tabla: e.tipo, filaId: String(e.seq), mensaje, fecha: Date.now() })
      await db.outbox.delete(e.seq!)
    }
  })
}

type ResultadoFila = { id: string; r: string; msg?: string; tabla?: NombreTabla; fila?: Record<string, unknown> }

/** Envía la cola en orden. Devuelve false si hay un problema de configuración que no se arregla reintentando. */
async function vaciarOutbox(c: Conexion): Promise<boolean> {
  for (;;) {
    const listas = (await db.outbox.orderBy('seq').toArray()).filter((e) => e.proximo <= Date.now())
    if (!listas.length) return true
    const primera = listas[0]
    let lote: EntradaOutbox[]
    let accion: string
    let params: Record<string, unknown>
    if (primera.tipo === 'cerrarCompra') {
      lote = [primera]
      accion = 'cerrarCompra'
      params = primera.payload
    } else {
      lote = []
      const cambios: unknown[] = []
      for (const e of listas) {
        if (e.tipo !== 'upsert') break
        const cs = (e.payload.cambios as unknown[]) ?? []
        if (lote.length && cambios.length + cs.length > MAX_CAMBIOS_LOTE) break
        lote.push(e)
        cambios.push(...cs)
      }
      accion = 'upsert'
      params = { cambios }
    }
    const r = await llamar<{ resultados: ResultadoFila[] }>(c, accion, params)
    const seqs = lote.map((e) => e.seq!)
    if (r.tipo === 'ok') {
      const errores = r.data.resultados.filter((x) => x.r === 'error')
      // El servidor tenía una versión más nueva (otro celular, o este con el reloj atrasado): se toma esa, si no
      // el celular se quedaría con la suya para siempre (el cursor de "traer" ya pasó esa fila).
      const vigentes = r.data.resultados.filter((x) => x.r === 'antiguo' && x.tabla && x.fila && TABLA_LOCAL[x.tabla])
      await db.transaction('rw', [db.outbox, db.rechazados, ...vigentes.map((x) => db.table(TABLA_LOCAL[x.tabla!]!))], async () => {
        for (const x of errores) await db.rechazados.add({ tabla: accion, filaId: x.id, mensaje: x.msg ?? 'error', fecha: Date.now() })
        for (const x of vigentes) {
          const tabla = db.table(TABLA_LOCAL[x.tabla!]!)
          const local = await tabla.get(x.id)
          if (ganaRemoto(local as { updated_at: string } | undefined, x.fila as { updated_at: string })) await tabla.put(x.fila)
        }
        await db.outbox.bulkDelete(seqs)
      })
      continue
    }
    if (r.tipo === 'desconocido') { await posponer(seqs, r.motivo); return true }
    if (ERRORES_DE_CONFIG.has(r.codigo)) { await estado({ error: r.mensaje }); return false }
    if (r.codigo === 'ocupado' || r.codigo === 'interno') { await posponer(seqs, r.mensaje); return true }
    await rechazar(lote, `${r.codigo}: ${r.mensaje}`)
  }
}

function actualMasNuevo(local: PrecioActual | undefined, remoto: PrecioActual): boolean {
  return !local || remoto.fecha_verificado >= local.fecha_verificado
}

const MAX_CAMBIOS_GUARDADOS = 300
/** Un dato que un script viejo no guarda (la marca) se reenvía a lo sumo una vez cada tanto, no en cada sincronización. */
const REENVIO_OPCIONALES_MS = 12 * 3600_000

/** Anota los precios que cambiaron (para "Novedades"): solo los que de verdad se guardaron, los más grandes primero. */
async function anotarCambios(guardados: PrecioActual[], anteriores: Map<string, PrecioActual | undefined>) {
  const ahora = Date.now()
  const nuevos: (CambioPrecio & { tam: number })[] = []
  for (const r of guardados) {
    const c = detectarCambio(anteriores.get(r.clave), r)
    if (c) nuevos.push({ presentacion_id: r.presentacion_id, tienda: r.tienda, origen: r.origen, ...c, fecha: ahora, tam: Math.abs(c.despues - c.antes) / c.antes })
  }
  if (!nuevos.length) return
  nuevos.sort((a, b) => b.tam - a.tam)
  await db.cambios.bulkAdd(nuevos.slice(0, MAX_CAMBIOS_GUARDADOS).map(({ tam: _tam, ...c }) => c))
  const sobran = (await db.cambios.count()) - MAX_CAMBIOS_GUARDADOS
  if (sobran > 0) await db.cambios.orderBy('fecha').limit(sobran).delete()
}

/** Trae lo que cambió en el servidor y lo mezcla: gana el updated_at mayor. */
export async function traer(c: Conexion, completo = false): Promise<boolean> {
  const desde = completo ? null : await leerMeta<string | null>('cursor', null)
  const r = await llamar<{ tablas: Record<string, Record<string, unknown>[]>; cursor: string }>(c, 'pull', { desde })
  if (r.tipo !== 'ok') {
    if (r.tipo === 'error') await estado({ error: r.mensaje })
    return false
  }
  const tablasLocales = Object.values(TABLA_LOCAL).map((t) => db.table(t!))
  const reenviar: { tabla: NombreTabla; fila: Record<string, unknown> }[] = []
  await db.transaction('rw', [...tablasLocales, db.meta, db.cambios, db.outbox], async () => {
    const ahoraMs = Date.now()
    const enviadas = { ...((await db.meta.get('reenviosOpcionales'))?.valor as Record<string, number> | undefined) }
    let tocoEnviadas = false
    for (const k of Object.keys(enviadas)) if (ahoraMs - enviadas[k] >= REENVIO_OPCIONALES_MS) { delete enviadas[k]; tocoEnviadas = true }
    for (const [nombre, filas] of Object.entries(r.data.tablas)) {
      const local = TABLA_LOCAL[nombre as NombreTabla]
      if (!local || !filas.length) continue
      const tabla = db.table(local)
      const idCol = TABLAS[nombre as NombreTabla].id
      const existentes = await tabla.bulkGet(filas.map((f) => f[idCol] as string))
      const aGuardar: Record<string, unknown>[] = []
      filas.forEach((f, i) => {
        const e = existentes[i] as Record<string, unknown> | undefined
        if (nombre === 'Precios_actuales') {
          if (actualMasNuevo(e as unknown as PrecioActual, f as unknown as PrecioActual)) aGuardar.push(f)
          return
        }
        if (!('updated_at' in TABLAS[nombre as NombreTabla].cols)) { aGuardar.push(f); return }
        if (!ganaRemoto(e as { updated_at: string } | undefined, f as { updated_at: string })) return
        // Un script viejo no guarda la marca: no se la quitamos al celular, y se vuelve a enviar cuando se pueda.
        const m = conservarOpcionales(nombre as NombreTabla, e as { updated_at: string } | undefined, f as { updated_at: string })
        if (m.reenviar) {
          // Ya se reenvió hace poco y el servidor volvió a descartarlo: se deja lo local como está (sin otro envío ni
          // otro updated_at). Sin esto, con un script viejo cada sincronización repetiría el ciclo para siempre.
          const clave = `${nombre}:${f[idCol]}`
          if (enviadas[clave] != null) return
          enviadas[clave] = ahoraMs
          tocoEnviadas = true
          const fila = { ...m.fila, updated_at: ahoraIso() }
          aGuardar.push(fila)
          reenviar.push({ tabla: nombre as NombreTabla, fila })
        } else aGuardar.push(f)
      })
      if (aGuardar.length) await tabla.bulkPut(aGuardar)
      if (nombre === 'Precios_actuales') {
        const antes = new Map((existentes as (PrecioActual | undefined)[]).map((x, i) => [(filas[i] as unknown as PrecioActual).clave, x]))
        await anotarCambios(aGuardar as unknown as PrecioActual[], antes)
      }
    }
    for (const x of reenviar) await encolar('upsert', { cambios: [x] })
    if (tocoEnviadas) await db.meta.put({ clave: 'reenviosOpcionales', valor: enviadas })
    await db.meta.put({ clave: 'cursor', valor: r.data.cursor })
  })
  return true
}

let enCurso: Promise<void> | null = null

/** Envía lo pendiente y trae lo nuevo. Si ya hay una sincronización corriendo, espera esa. */
export function sincronizar(opciones: { completo?: boolean } = {}): Promise<void> {
  if (enCurso) return enCurso
  enCurso = (async () => {
    try {
      const c = await conexion()
      if (!c.url || !c.token) return
      await estado({ enCurso: true })
      try {
        const ok = await vaciarOutbox(c)
        if (ok && (await traer(c, opciones.completo))) await estado({ ultimoOk: Date.now(), error: null })
      } catch (e) {
        await estado({ error: String(e) })
      } finally {
        await estado({ enCurso: false })
      }
    } finally {
      // Siempre se libera, también cuando todavía no hay conexión configurada.
      enCurso = null
    }
  })()
  return enCurso
}

let temporizador: ReturnType<typeof setTimeout> | null = null

/** Sincroniza 2 s después de la última escritura. */
export function sincronizarPronto() {
  if (temporizador) clearTimeout(temporizador)
  temporizador = setTimeout(() => { temporizador = null; void sincronizar() }, 2000)
}

/** Sin Background Sync en iOS: se sincroniza al abrir, al volver la señal, al volver a primer plano y cada minuto. */
export function arrancarSincronizacion() {
  void sincronizar()
  window.addEventListener('online', () => void sincronizar())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void sincronizar() })
  setInterval(() => { if (document.visibilityState === 'visible') void sincronizar() }, 60_000)
  void navigator.storage?.persist?.()
}

export function ahoraIso(): string {
  return isoBogota(Date.now())
}
