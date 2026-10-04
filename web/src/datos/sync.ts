import { TABLAS, type NombreTabla, type PrecioActual } from '@shared/esquema.ts'
import { isoBogota } from '@shared/fechas.ts'
import { detectarCambio, type CambioPrecio } from '@shared/novedades.ts'
import { conservarOpcionales, ganaRemoto } from '@shared/sync.ts'
import { llamar, type Conexion } from './api.ts'
import { db, guardarMeta, leerMeta, TABLA_LOCAL, type EntradaOutbox } from './db.ts'
import { supabase } from './supabase.ts'

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

const TABLA_CLOUD: Partial<Record<NombreTabla, { tabla: string; id: string }>> = {
  Config: { tabla: 'config', id: 'clave' },
  Categorias: { tabla: 'categorias', id: 'categoria_id' },
  Productos: { tabla: 'productos', id: 'producto_id' },
  Presentaciones: { tabla: 'presentaciones', id: 'presentacion_id' },
  Precios: { tabla: 'precios_historial', id: 'precio_id' },
  Precios_actuales: { tabla: 'precios_actuales', id: 'clave' },
  Compras: { tabla: 'compras', id: 'compra_id' },
  Compras_detalle: { tabla: 'compras_detalle', id: 'detalle_id' },
  Compras_resumen: { tabla: 'compras_resumen', id: 'clave' },
  Observaciones: { tabla: 'observaciones', id: 'obs_id' },
}

function filaCloud(tabla: NombreTabla, fila: Record<string, unknown>) {
  const destino = TABLA_CLOUD[tabla]
  if (!destino) throw new Error(`No se puede sincronizar la tabla ${tabla}.`)
  const permitidas = new Set(Object.keys(TABLAS[tabla].cols).filter((col) => col !== '_srv'))
  const limpia: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(fila)) if (permitidas.has(clave)) limpia[clave] = valor
  // Postgres espera NULL para fechas vacías; el modelo local usa '' en campos opcionales.
  if (limpia.fecha_cierre === '') limpia.fecha_cierre = null
  return { destino, fila: limpia }
}

async function guardarFilasCloud(cambios: { tabla: NombreTabla; fila: Record<string, unknown> }[]) {
  if (!supabase) throw new Error('La base de datos no está configurada.')
  const grupos = new Map<string, { id: string; filas: Record<string, unknown>[] }>()
  for (const cambio of cambios) {
    const { destino, fila } = filaCloud(cambio.tabla, cambio.fila)
    const grupo = grupos.get(destino.tabla) ?? { id: destino.id, filas: [] }
    grupo.filas.push(fila)
    grupos.set(destino.tabla, grupo)
  }
  for (const [tabla, grupo] of grupos) {
    const { error } = await supabase.from(tabla).upsert(grupo.filas, { onConflict: `user_id,${grupo.id}` })
    if (error) throw new Error(error.message)
  }
}

async function guardarEventoCloud(entrada: EntradaOutbox) {
  if (entrada.tipo === 'upsert') {
    const cambios = (entrada.payload.cambios ?? []) as { tabla: NombreTabla; fila: Record<string, unknown> }[]
    await guardarFilasCloud(cambios)
    return
  }
  const compra = entrada.payload.compra as Record<string, unknown>
  const detalle = entrada.payload.detalle as Record<string, unknown>[]
  const observaciones = entrada.payload.observaciones as Record<string, unknown>[]
  const resumen = entrada.payload.resumen as Record<string, unknown>[]
  const preciosActuales = entrada.payload.preciosActuales as Record<string, unknown>[]
  const preciosHistorial = entrada.payload.preciosHistorial as Record<string, unknown>[]
  const cambios: { tabla: NombreTabla; fila: Record<string, unknown> }[] = [
    { tabla: 'Compras', fila: compra },
    ...detalle.map((fila) => ({ tabla: 'Compras_detalle' as const, fila })),
    ...observaciones.map((fila) => ({ tabla: 'Observaciones' as const, fila })),
    ...resumen.map((fila) => ({ tabla: 'Compras_resumen' as const, fila })),
    ...preciosActuales.map((fila) => ({ tabla: 'Precios_actuales' as const, fila })),
    ...preciosHistorial.map((fila) => ({ tabla: 'Precios' as const, fila })),
  ]
  await guardarFilasCloud(cambios)
}

/** Envía la cola. La sesión autenticada y RLS identifican la cuenta; el cliente nunca elige el propietario. */
async function vaciarOutbox(): Promise<boolean> {
  if (!supabase) return false
  for (;;) {
    const listas = (await db.outbox.orderBy('seq').toArray()).filter((e) => e.proximo <= Date.now())
    if (!listas.length) return true
    const primera = listas[0]
    const lote = primera.tipo === 'cerrarCompra' ? [primera] : listas.filter((e) => e.tipo === 'upsert').slice(0, MAX_CAMBIOS_LOTE)
    const seqs = lote.map((e) => e.seq!)
    try {
      for (const entrada of lote) await guardarEventoCloud(entrada)
      await db.outbox.bulkDelete(seqs)
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e)
      if (/JWT|token|auth|permission|row-level|violates row-level/i.test(mensaje)) await estado({ error: 'Tu sesión venció o no tiene acceso a tus datos. Inicia sesión de nuevo.' })
      await posponer(seqs, mensaje)
      return false
    }
  }
}

/** Compatibilidad del adaptador anterior. Acceso.tsx bloquea la app si no existe Supabase, así que no se usa en producción. */
async function vaciarOutboxAppsScript(c: Conexion): Promise<boolean> {
  if (!c.url || !c.token) return false
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
  if (supabase) return traerCloud(completo)
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

/** Descarga por páginas los registros de la cuenta autenticada y los combina con IndexedDB. */
async function traerCloud(completo = false): Promise<boolean> {
  if (!supabase) return false
  const tablasLocales = Object.entries(TABLA_LOCAL).filter(([nombre]) => !!TABLA_CLOUD[nombre as NombreTabla])
  const todas: { local: string; tablaCloud: string; remoto: Record<string, unknown>[]; cursor: string | null }[] = []
  for (const [nombre, local] of tablasLocales) {
    const destino = TABLA_CLOUD[nombre as NombreTabla]!
    const cursorPrevio = completo ? null : await leerMeta<string | null>(`cursorCloud:${destino.tabla}`, null)
    const filas: Record<string, unknown>[] = []
    let cursorMayor: string | null = null
    for (let desde = 0; ; desde += 500) {
      let consulta = supabase.from(destino.tabla).select('*')
      if (cursorPrevio) consulta = consulta.gt('updated_at', cursorPrevio)
      const { data, error } = await consulta.order('updated_at').order(destino.id).range(desde, desde + 499)
      if (error) { await estado({ error: error.message }); return false }
      const pagina = (data ?? []) as Record<string, unknown>[]
      filas.push(...pagina)
      for (const fila of pagina) {
        const marca = fila.updated_at as string
        if (!cursorMayor || marca > cursorMayor) cursorMayor = marca
      }
      if (pagina.length < 500) break
    }
    todas.push({ local: local!, tablaCloud: destino.tabla, remoto: filas, cursor: cursorMayor })
  }

  const instancias = todas.map(({ local }) => db.table(local))
  await db.transaction('rw', [...instancias, db.meta], async () => {
    for (const { local, tablaCloud, remoto, cursor } of todas) {
      const tabla = db.table(local)
      for (let i = 0; i < remoto.length; i += 500) {
        const lote = remoto.slice(i, i + 500).map((fila) => {
          const { user_id: _userId, ...propia } = fila
          if (propia.fecha_cierre == null) propia.fecha_cierre = ''
          return propia
        })
        const llave = tabla.schema.primKey.name
        const actuales = await tabla.bulkGet(lote.map((f) => f[llave] as string))
        const aceptar: Record<string, unknown>[] = []
        lote.forEach((fila, j) => {
          const previo = actuales[j] as Record<string, unknown> | undefined
          if (local === 'preciosActuales') {
            if (actualMasNuevo(previo as unknown as PrecioActual, fila as unknown as PrecioActual)) aceptar.push(fila)
          } else if (local === 'historial' || !('updated_at' in fila)) aceptar.push(fila)
          else if (ganaRemoto(previo as { updated_at: string } | undefined, fila as { updated_at: string })) aceptar.push(fila)
        })
        if (aceptar.length) await tabla.bulkPut(aceptar)
      }
      if (cursor) {
        // Cada tabla avanza por separado. El solape captura escrituras concurrentes mientras se leen otras tablas.
        const cursorConSolape = new Date(new Date(cursor).getTime() - 2000).toISOString()
        await db.meta.put({ clave: `cursorCloud:${tablaCloud}`, valor: cursorConSolape })
      }
    }
  })
  return true
}

let enCurso: Promise<void> | null = null

/** Envía lo pendiente y trae lo nuevo. Si ya hay una sincronización corriendo, espera esa. */
export function sincronizar(opciones: { completo?: boolean } = {}): Promise<void> {
  if (enCurso) return enCurso
  enCurso = (async () => {
    try {
      const c = supabase ? null : await conexion()
      if (!supabase && (!c?.url || !c.token)) return
      await estado({ enCurso: true })
      try {
        const ok = supabase ? await vaciarOutbox() : await vaciarOutboxAppsScript(c!)
        if (ok && (supabase ? await traerCloud(opciones.completo) : await traer(c!, opciones.completo))) await estado({ ultimoOk: Date.now(), error: null })
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
export function arrancarSincronizacion(): () => void {
  void sincronizar()
  const alConectar = () => void sincronizar()
  const alVolver = () => { if (document.visibilityState === 'visible') void sincronizar() }
  window.addEventListener('online', alConectar)
  document.addEventListener('visibilitychange', alVolver)
  const intervalo = setInterval(() => { if (document.visibilityState === 'visible') void sincronizar() }, 60_000)
  void navigator.storage?.persist?.()
  return () => {
    window.removeEventListener('online', alConectar)
    document.removeEventListener('visibilitychange', alVolver)
    clearInterval(intervalo)
    if (temporizador) { clearTimeout(temporizador); temporizador = null }
  }
}

/** Evita que una respuesta atrasada de la cuenta anterior se aplique a la siguiente IndexedDB. */
export async function esperarSincronizacion() {
  await enCurso
}

export function ahoraIso(): string {
  return isoBogota(Date.now())
}
