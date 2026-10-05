import type { SupabaseClient } from '@supabase/supabase-js'
import { TABLAS, type NombreTabla, type PrecioActual } from '@shared/esquema.ts'
import { aMs, esIso, isoBogota } from '@shared/fechas.ts'
import { detectarCambio, type CambioPrecio } from '@shared/novedades.ts'
import { conservarOpcionales, ganaRemoto } from '@shared/sync.ts'
import { llamar, type Conexion } from './api.ts'
import { type BaseLocal, CuentaCambiada, db, generacionActual, guardarMeta, leerMeta, propietarioDb, TABLA_LOCAL, type EntradaOutbox } from './db.ts'
import { clienteDeCuenta, supabase } from './supabase.ts'

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

async function estado(parcial: Partial<EstadoSync>, base: BaseLocal = db) {
  const previo = await leerMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null }, base)
  await guardarMeta('estadoSync', { ...previo, ...parcial }, base)
}

/** Encola cambios para el servidor. Llamar dentro de la misma transacción que la escritura local. */
export async function encolar(tipo: EntradaOutbox['tipo'], payload: Record<string, unknown>) {
  await db.outbox.add({ tipo, payload, intentos: 0, proximo: 0, creado: Date.now() })
}

async function posponer(seqs: number[], motivo: string, base: BaseLocal = db) {
  const ahora = Date.now()
  await base.transaction('rw', base.outbox, async () => {
    for (const seq of seqs) {
      const e = await base.outbox.get(seq)
      if (!e) continue
      const intentos = e.intentos + 1
      await base.outbox.update(seq, { intentos, proximo: ahora + ESPERAS_MS[Math.min(intentos - 1, ESPERAS_MS.length - 1)], error: motivo })
    }
  })
}

async function rechazar(entradas: EntradaOutbox[], mensaje: string, base: BaseLocal = db) {
  await base.transaction('rw', base.outbox, base.rechazados, async () => {
    for (const e of entradas) {
      await base.rechazados.add({ tabla: e.tipo, filaId: String(e.seq), mensaje, fecha: Date.now(), payload: e.payload })
      await base.outbox.delete(e.seq!)
    }
  })
}

type ResultadoFila = { id: string; r: string; msg?: string; tabla?: NombreTabla; fila?: Record<string, unknown> }

/** `Observaciones` es una tabla virtual del API anterior: no tiene pestaña propia, pero la nube sí guarda cada observación. */
type TablaCloudApp = NombreTabla | 'Observaciones'
type CambioCloud = { tabla: TablaCloudApp; fila: Record<string, unknown> }

const COLUMNAS_OBSERVACION = [
  'obs_id', 'presentacion_id', 'tienda', 'origen', 'fuente', 'precio', 'precio_lista', 'disponible', 'region',
  'fecha_observado', 'compra_id',
] as const

const TABLA_CLOUD: Partial<Record<TablaCloudApp, { tabla: string; id: string }>> = {
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

/** Una operación de sincronización trabaja siempre con una cuenta, su base local y un cliente fijos a esa sesión. */
interface ContextoCuenta {
  userId: string
  base: BaseLocal
  cliente: SupabaseClient
  generacion: number
}

const vigente = (ctx: ContextoCuenta) => ctx.generacion === generacionActual()

/**
 * Toma la cuenta activa. El cliente queda fijo al token de esa sesión: si el usuario cambia de cuenta mientras se
 * sincroniza, esta ronda sigue siendo de la cuenta anterior (y se descarta) en vez de pasar a medias a la nueva.
 * Si la base local y la sesión no son de la misma cuenta (en pleno cambio de cuenta), no se sincroniza.
 */
async function abrirContexto(): Promise<ContextoCuenta | null> {
  if (!supabase) return null
  const generacion = generacionActual()
  const { data } = await supabase.auth.getSession()
  const sesion = data.session
  if (!sesion || sesion.user.id !== propietarioDb || generacion !== generacionActual()) return null
  const cliente = clienteDeCuenta(sesion.access_token)
  return cliente ? { userId: sesion.user.id, base: db, cliente, generacion } : null
}

/** Error de Supabase con lo necesario para decidir si se reintenta: código de Postgres/PostgREST y estado HTTP. */
export class ErrorCloud extends Error {
  readonly codigo: string
  readonly http: number
  constructor(mensaje: string, codigo: string, http: number) {
    super(mensaje)
    this.codigo = codigo
    this.http = http
  }
}

export type ClaseError = 'sesion' | 'permanente' | 'transitorio'

/**
 * - sesion: el token venció o RLS no deja escribir; se reintenta cuando la persona vuelva a entrar.
 * - permanente: el servidor nunca aceptará ese dato (fuera de rango, CHECK, llave foránea, NOT NULL).
 * - transitorio: red, servidor caído, límites, esquema sin migrar. Se reintenta; el dato no se pierde.
 */
export function clasificarError(e: unknown): ClaseError {
  const codigo = e instanceof ErrorCloud ? e.codigo : ''
  const http = e instanceof ErrorCloud ? e.http : 0
  const mensaje = e instanceof Error ? e.message : String(e)
  if (http === 401 || /^PGRST30\d$/.test(codigo) || codigo === '42501' || /JWT/i.test(mensaje)) return 'sesion'
  if (/^(22|23)/.test(codigo) || codigo === 'PGRST102') return 'permanente'
  return 'transitorio'
}

const MENSAJE_SESION = 'Tu sesión venció o no tiene acceso a tus datos. Inicia sesión de nuevo.'

function columnasCloud(tabla: TablaCloudApp): ReadonlySet<string> {
  if (tabla === 'Observaciones') return new Set<string>(COLUMNAS_OBSERVACION)
  return new Set(Object.keys(TABLAS[tabla].cols).filter((col) => col !== '_srv'))
}

/** Las tablas editables desde el celular llevan `updated_at`; ver `editado_en` más abajo. */
function conFechaDeEdicion(tabla: TablaCloudApp): boolean {
  return tabla !== 'Observaciones' && 'updated_at' in TABLAS[tabla].cols
}

export function filaCloud(tabla: TablaCloudApp, fila: Record<string, unknown>) {
  const destino = TABLA_CLOUD[tabla]
  if (!destino) throw new Error(`No se puede sincronizar la tabla ${tabla}.`)
  const permitidas = columnasCloud(tabla)
  const limpia: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(fila)) if (permitidas.has(clave)) limpia[clave] = valor
  // Postgres espera NULL para fechas vacías; el modelo local usa '' en campos opcionales.
  if (limpia.fecha_cierre === '') limpia.fecha_cierre = null
  if (conFechaDeEdicion(tabla)) {
    // El servidor pone su propio `updated_at` (cursor de descarga) y su propia `version`. La fecha en que se editó
    // viaja aparte, en `editado_en`: solo sirve para decidir un choque real entre dos celulares (ver resolverConflictos).
    const edicion = limpia.updated_at
    delete limpia.updated_at
    limpia.editado_en = esIso(edicion) ? edicion : null
  }
  return { destino, fila: limpia }
}

const falloCloud = (error: { message: string; code?: string }, status: number | null | undefined) =>
  new ErrorCloud(error.message, error.code ?? '', status ?? 0)

async function guardarFilasCloud(ctx: ContextoCuenta, cambios: CambioCloud[]) {
  // Una misma fila dos veces en un envío haría fallar al servidor ("no puede afectar la misma fila dos veces"):
  // se queda la última, que es la más reciente.
  const grupos = new Map<string, { tabla: TablaCloudApp; id: string; filas: Map<string, Record<string, unknown>> }>()
  for (const cambio of cambios) {
    const { destino, fila } = filaCloud(cambio.tabla, cambio.fila)
    const grupo = grupos.get(destino.tabla) ?? { tabla: cambio.tabla, id: destino.id, filas: new Map() }
    grupo.filas.set(String(fila[destino.id]), fila)
    grupos.set(destino.tabla, grupo)
  }
  for (const [tablaCloud, grupo] of grupos) {
    if (!vigente(ctx)) throw new CuentaCambiada()
    const filas = [...grupo.filas.values()]
    if (conFechaDeEdicion(grupo.tabla)) {
      await guardarVersionadas(ctx, grupo.tabla as NombreTabla, { tabla: tablaCloud, id: grupo.id }, filas)
      continue
    }
    const { error, status } = await ctx.cliente.from(tablaCloud).upsert(filas, { onConflict: `user_id,${grupo.id}` })
    if (error) throw falloCloud(error, status)
    if (tablaCloud === 'precios_actuales') await reconciliarPrecios(ctx, filas.map((f) => String(f[grupo.id])))
  }
}

/**
 * El servidor ignora un precio actual más viejo que el que ya tiene (sin avisar). Después de subir, se trae lo que quedó
 * guardado y, si es más nuevo que lo de aquí, se toma: no depende de que la siguiente descarga (por cursor) lo alcance.
 */
async function reconciliarPrecios(ctx: ContextoCuenta, claves: string[]) {
  const { data, error, status } = await ctx.cliente.from('precios_actuales').select('*').in('clave', claves)
  if (error) throw falloCloud(error, status)
  const remotas = ((data ?? []) as Record<string, unknown>[]).map(filaLocalDeCloud)
  if (!remotas.length) return
  if (!vigente(ctx)) throw new CuentaCambiada()
  const tabla = ctx.base.preciosActuales
  await ctx.base.transaction('rw', tabla, async () => {
    const locales = await tabla.bulkGet(remotas.map((r) => String(r.clave)))
    const mas = remotas.filter((r, i) => !!locales[i] && instante(r.fecha_verificado) > instante(locales[i]!.fecha_verificado))
    if (mas.length) await tabla.bulkPut(mas as unknown as PrecioActual[])
  })
}

const versionDe = (fila: unknown): number => {
  const v = (fila as { version?: unknown } | undefined)?.version
  return typeof v === 'number' && v > 0 ? v : 0
}

const instante = (iso: unknown): number => (typeof iso === 'string' ? Date.parse(iso) : NaN)

async function fijarVersion(ctx: ContextoCuenta, tabla: NombreTabla, id: string, version: number) {
  const local = TABLA_LOCAL[tabla]
  if (local) await ctx.base.table(local).update(id, { version })
}

type Destino = { tabla: string; id: string }
type Pendiente = { fila: Record<string, unknown>; id: string; base: number }

/**
 * Las tablas editables llevan una `version` que pone el servidor (1 al crear, +1 en cada cambio). Cada envío dice
 * sobre qué versión se basó: si otro celular cambió la fila mientras tanto, el servidor no la toca y se resuelve aquí.
 * Así un cambio nunca pisa en silencio uno que el celular no había visto, y no depende de que los relojes coincidan.
 */
async function guardarVersionadas(ctx: ContextoCuenta, tabla: NombreTabla, destino: Destino, filas: Record<string, unknown>[]) {
  const local = TABLA_LOCAL[tabla]
  const ids = filas.map((f) => String(f[destino.id]))
  const locales = local ? await ctx.base.table(local).bulkGet(ids) : []
  const pendientes: Pendiente[] = []
  filas.forEach((fila, i) => {
    const actual = locales[i] as { updated_at?: string } | undefined
    // Si lo local ya es más nuevo que este envío (otra edición, o algo más nuevo que llegó de la nube), este quedó viejo.
    if (actual && instante(actual.updated_at) > instante(fila.editado_en)) {
      // Ya existe en el servidor: lo más nuevo llegará por su propia entrada de la cola.
      if (versionDe(actual) > 0) return
      // Todavía no existe allá: se sube lo último que hay aquí en el lugar de esta entrada. Si no, otra entrada que
      // depende de esta (una presentación de este producto) llegaría antes y el servidor la rechazaría.
      pendientes.push({ fila: filaCloud(tabla, actual as Record<string, unknown>).fila, id: ids[i], base: 0 })
      return
    }
    pendientes.push({ fila, id: ids[i], base: versionDe(actual) })
  })
  const conflictos: Pendiente[] = []

  const nuevas = pendientes.filter((x) => x.base === 0)
  if (nuevas.length) {
    const { data, error, status } = await ctx.cliente.from(destino.tabla)
      .upsert(nuevas.map((x) => x.fila), { onConflict: `user_id,${destino.id}`, ignoreDuplicates: true })
      .select(`${destino.id},version`)
    if (error) throw falloCloud(error, status)
    const aceptadas = new Map(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r[destino.id]), Number(r.version)]))
    for (const x of nuevas) {
      const version = aceptadas.get(x.id)
      if (version == null) conflictos.push(x)
      else await fijarVersion(ctx, tabla, x.id, version)
    }
  }
  for (const x of pendientes.filter((p) => p.base > 0)) {
    const { data, error, status } = await ctx.cliente.from(destino.tabla).update(x.fila)
      .eq(destino.id, x.id).eq('version', x.base).select(`${destino.id},version`)
    if (error) throw falloCloud(error, status)
    const aceptada = ((data ?? []) as unknown as Record<string, unknown>[])[0]
    if (aceptada) await fijarVersion(ctx, tabla, x.id, Number(aceptada.version))
    else conflictos.push(x)
  }
  if (conflictos.length) await resolverConflictos(ctx, tabla, destino, conflictos)
}

/**
 * Otro celular cambió estas filas desde la última versión que este conocía. Se trae la versión del servidor y se decide:
 * si lo de este celular se editó después (fecha de edición), se vuelve a enviar sobre la versión nueva; si no, gana la
 * del servidor y se guarda aquí enseguida (no se espera a la siguiente descarga). Solo en un choque real se usan las
 * fechas del celular: la versión es la que decide qué cambios se aceptan.
 */
async function resolverConflictos(ctx: ContextoCuenta, tabla: NombreTabla, destino: Destino, conflictos: Pendiente[]) {
  const local = TABLA_LOCAL[tabla]!
  const { data, error, status } = await ctx.cliente.from(destino.tabla).select('*').in(destino.id, conflictos.map((x) => x.id))
  if (error) throw falloCloud(error, status)
  const delServidor = new Map(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r[destino.id]), r]))
  const reintentar: Pendiente[] = []
  const quedanDelServidor: Record<string, unknown>[] = []
  for (const x of conflictos) {
    const s = delServidor.get(x.id)
    if (!s) throw new ErrorCloud('Otro dispositivo cambió este dato; se reintentará.', '', 409)
    const suyo = instante(x.fila.editado_en)
    const ajeno = instante(s.editado_en ?? s.updated_at)
    if (suyo > ajeno) reintentar.push({ ...x, base: versionDe(s) })
    else quedanDelServidor.push(filaLocalDeCloud(s))
  }
  if (quedanDelServidor.length) {
    if (!vigente(ctx)) throw new CuentaCambiada()
    const tabla = ctx.base.table(local)
    const llave = tabla.schema.primKey.name
    const enviadas = new Map(conflictos.map((x) => [x.id, instante(x.fila.editado_en)]))
    await ctx.base.transaction('rw', tabla, async () => {
      for (const s of quedanDelServidor) {
        const actual = await tabla.get(s[llave] as string) as { updated_at?: string } | undefined
        // Si mientras se consultaba la persona volvió a editar la fila, esa edición nueva se conserva: tiene su propia
        // entrada en la cola y se resolverá en su turno, sobre la versión actual.
        if (actual && instante(actual.updated_at) > (enviadas.get(String(s[llave])) ?? Infinity)) continue
        await tabla.put(s)
      }
    })
  }
  for (const x of reintentar) {
    const { data: ok, error: e2, status: st2 } = await ctx.cliente.from(destino.tabla).update(x.fila)
      .eq(destino.id, x.id).eq('version', x.base).select(`${destino.id},version`)
    if (e2) throw falloCloud(e2, st2)
    const aceptada = ((ok ?? []) as unknown as Record<string, unknown>[])[0]
    // Si en ese instante cambió otra vez, se deja para el siguiente intento con la versión nueva.
    if (!aceptada) throw new ErrorCloud('Otro dispositivo cambió este dato; se reintentará.', '', 409)
    await fijarVersion(ctx, tabla, x.id, Number(aceptada.version))
  }
}

async function guardarEventoCloud(ctx: ContextoCuenta, entrada: EntradaOutbox) {
  if (entrada.tipo === 'upsert') {
    const cambios = (entrada.payload.cambios ?? []) as CambioCloud[]
    await guardarFilasCloud(ctx, cambios)
    return
  }
  const compra = entrada.payload.compra as Record<string, unknown>
  const detalle = entrada.payload.detalle as Record<string, unknown>[]
  const observaciones = entrada.payload.observaciones as Record<string, unknown>[]
  const resumen = entrada.payload.resumen as Record<string, unknown>[]
  const preciosActuales = entrada.payload.preciosActuales as Record<string, unknown>[]
  const preciosHistorial = entrada.payload.preciosHistorial as Record<string, unknown>[]
  const cambios: CambioCloud[] = [
    { tabla: 'Compras', fila: compra },
    ...detalle.map((fila) => ({ tabla: 'Compras_detalle' as const, fila })),
    ...observaciones.map((fila) => ({ tabla: 'Observaciones' as const, fila })),
    ...resumen.map((fila) => ({ tabla: 'Compras_resumen' as const, fila })),
    ...preciosActuales.map((fila) => ({ tabla: 'Precios_actuales' as const, fila })),
    ...preciosHistorial.map((fila) => ({ tabla: 'Precios' as const, fila })),
  ]
  await guardarFilasCloud(ctx, cambios)
}

/** Los errores que se reintentan se muestran en el aviso de sincronización (la señal inestable sale como pastilla). */
async function reportarFallo(ctx: ContextoCuenta, clase: ClaseError, mensaje: string) {
  await estado({ error: clase === 'sesion' ? MENSAJE_SESION : mensaje }, ctx.base)
}

/**
 * Envía la cola con la sesión fija del contexto; RLS identifica la cuenta y el cliente nunca elige el propietario.
 * Un dato que el servidor no acepta nunca (error permanente) pasa a `rechazados` y no frena el resto; lo demás
 * (red, sesión vencida, servidor caído) se pospone con espera creciente y se avisa.
 */
async function vaciarOutbox(ctx: ContextoCuenta): Promise<boolean> {
  for (;;) {
    if (!vigente(ctx)) return false
    const todas = await ctx.base.outbox.orderBy('seq').toArray()
    // El orden importa (un producto antes que su presentación): si lo más viejo espera un reintento, nada pasa por delante.
    if (!todas.length || todas[0].proximo > Date.now()) return true
    const primera = todas[0]
    // Un envío junta solo entradas seguidas, en orden: un cierre de compra no se salta ni se deja atrás.
    const lote: EntradaOutbox[] = []
    if (primera.tipo === 'cerrarCompra') lote.push(primera)
    else for (const e of todas) {
      if (e.tipo !== 'upsert' || e.proximo > Date.now() || lote.length >= MAX_CAMBIOS_LOTE) break
      lote.push(e)
    }
    try {
      for (const entrada of lote) await guardarEventoCloud(ctx, entrada)
      await ctx.base.outbox.bulkDelete(lote.map((e) => e.seq!))
    } catch (e) {
      if (!vigente(ctx)) return false
      const clase = clasificarError(e)
      const mensaje = e instanceof Error ? e.message : String(e)
      if (clase !== 'permanente') {
        await posponer(lote.map((x) => x.seq!), mensaje, ctx.base)
        await reportarFallo(ctx, clase, mensaje)
        return false
      }
      // Un solo dato malo no puede frenar ni descartar lo demás: se reenvía de a una entrada.
      if (lote.length === 1) {
        await rechazar(lote, mensaje, ctx.base)
        continue
      }
      for (const [i, entrada] of lote.entries()) {
        try {
          await guardarEventoCloud(ctx, entrada)
          await ctx.base.outbox.delete(entrada.seq!)
        } catch (e2) {
          if (!vigente(ctx)) return false
          const clase2 = clasificarError(e2)
          const mensaje2 = e2 instanceof Error ? e2.message : String(e2)
          if (clase2 === 'permanente') {
            await rechazar([entrada], mensaje2, ctx.base)
            continue
          }
          await posponer(lote.slice(i).map((x) => x.seq!), mensaje2, ctx.base)
          await reportarFallo(ctx, clase2, mensaje2)
          return false
        }
      }
    }
  }
}

/** Mientras haya cambios rechazados sin revisar (Ajustes → Borrar la lista), el aviso se mantiene. */
async function avisoRechazados(ctx: ContextoCuenta): Promise<string | null> {
  const n = await ctx.base.rechazados.count()
  return n ? `${n} ${n === 1 ? 'cambio no fue aceptado' : 'cambios no fueron aceptados'} por el servidor (revisa Ajustes).` : null
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

/** Las fechas se comparan como instantes: la nube las devuelve en UTC y el celular las guarda en -05:00, y como texto no se ordenan igual. */
export function actualMasNuevo(local: PrecioActual | undefined, remoto: PrecioActual): boolean {
  if (!local) return true
  const r = Date.parse(remoto.fecha_verificado)
  const l = Date.parse(local.fecha_verificado)
  // Una fecha ilegible no debe abortar toda la descarga: la remota ilegible no gana; la local ilegible sí se reemplaza.
  if (Number.isNaN(r)) return false
  return Number.isNaN(l) || r >= l
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

const TAM_PAGINA = 500
/**
 * El cursor retrocede este tiempo: una transacción que empezó antes pero confirmó después de la descarga queda con un
 * `updated_at` menor que lo ya leído y, sin el margen, no se descargaría nunca. Releer filas es inocuo (se combinan por fecha).
 */
const SOLAPE_CURSOR_MS = 10_000
const CAMPOS_FECHA_CLOUD = ['updated_at', 'fecha_inicio', 'fecha_cierre', 'fecha_observado', 'fecha_verificado', 'created_at']

const entreComillas = (valor: string) => `"${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Una página después de (updated_at, id): el orden es total, así que una fila que cambia a mitad de la descarga no corre las demás. */
function paginaCloud(cliente: SupabaseClient, destino: { tabla: string; id: string }, despues: { marca: string | null; id: string | null }) {
  let consulta = cliente.from(destino.tabla).select('*')
  if (despues.marca && despues.id != null) {
    const marca = entreComillas(despues.marca)
    consulta = consulta.or(`updated_at.gt.${marca},and(updated_at.eq.${marca},${destino.id}.gt.${entreComillas(despues.id)})`)
  } else if (despues.marca) {
    consulta = consulta.gt('updated_at', despues.marca)
  }
  return consulta.order('updated_at').order(destino.id).limit(TAM_PAGINA)
}

/**
 * Convierte una fila de la nube al modelo local: quita el dueño, deja como `updated_at` la fecha de edición del celular
 * que la escribió (la misma que el celular compara al combinar) y normaliza las fechas a -05:00, porque Postgres
 * las devuelve en UTC y las comparaciones de texto del resto de la app suponen un solo formato.
 */
export function filaLocalDeCloud(fila: Record<string, unknown>): Record<string, unknown> {
  const { user_id: _userId, editado_en: editadoEn, ...propia } = fila
  if ('editado_en' in fila && editadoEn != null) propia.updated_at = editadoEn
  for (const campo of CAMPOS_FECHA_CLOUD) {
    const valor = propia[campo]
    if (typeof valor === 'string' && esIso(valor)) propia[campo] = isoBogota(aMs(valor))
  }
  if ('fecha_cierre' in propia && propia.fecha_cierre == null) propia.fecha_cierre = ''
  return propia
}

/** Las filas (`tablaLocal:id`) que tienen un cambio esperando en la cola. */
async function filasPendientes(base: BaseLocal): Promise<Set<string>> {
  const claves = new Set<string>()
  const anotar = (tabla: NombreTabla, fila: unknown) => {
    const local = TABLA_LOCAL[tabla]
    const id = (fila as Record<string, unknown> | undefined)?.[TABLAS[tabla].id]
    if (local && id != null) claves.add(`${local}:${String(id)}`)
  }
  for (const e of await base.outbox.toArray()) {
    if (e.tipo === 'upsert') {
      for (const c of (e.payload.cambios ?? []) as { tabla: NombreTabla; fila: unknown }[]) if (c.tabla in TABLAS) anotar(c.tabla, c.fila)
    } else {
      anotar('Compras', e.payload.compra)
      for (const d of (e.payload.detalle ?? []) as unknown[]) anotar('Compras_detalle', d)
    }
  }
  return claves
}

/** Descarga por páginas los registros de la cuenta del contexto y los combina con su IndexedDB. */
async function traerCloud(ctx: ContextoCuenta, completo = false): Promise<boolean> {
  const tablasLocales = Object.entries(TABLA_LOCAL).filter(([nombre]) => !!TABLA_CLOUD[nombre as NombreTabla])
  const todas: { local: string; tablaCloud: string; remoto: Record<string, unknown>[]; cursor: string | null; versionada: boolean }[] = []
  for (const [nombre, local] of tablasLocales) {
    const destino = TABLA_CLOUD[nombre as NombreTabla]!
    const cursorPrevio = completo ? null : await leerMeta<string | null>(`cursorCloud:${destino.tabla}`, null, ctx.base)
    const filas: Record<string, unknown>[] = []
    let despues: { marca: string | null; id: string | null } = { marca: cursorPrevio, id: null }
    for (;;) {
      if (!vigente(ctx)) return false
      const { data, error, status } = await paginaCloud(ctx.cliente, destino, despues)
      if (error) {
        if (vigente(ctx)) await reportarFallo(ctx, clasificarError(new ErrorCloud(error.message, error.code ?? '', status ?? 0)), error.message)
        return false
      }
      const pagina = (data ?? []) as Record<string, unknown>[]
      filas.push(...pagina)
      if (pagina.length < TAM_PAGINA) break
      const ultima = pagina[pagina.length - 1]
      despues = { marca: String(ultima.updated_at), id: String(ultima[destino.id]) }
    }
    // Van ordenadas por updated_at: la última es la mayor.
    const cursor = filas.length ? String(filas[filas.length - 1].updated_at) : null
    todas.push({ local: local!, tablaCloud: destino.tabla, remoto: filas, cursor, versionada: conFechaDeEdicion(nombre as NombreTabla) })
  }

  // Si la cuenta cambió mientras se descargaba, esto es de la cuenta anterior: no se escribe nada.
  if (!vigente(ctx)) return false
  const base = ctx.base
  const instancias = todas.map(({ local }) => base.table(local))
  await base.transaction('rw', [...instancias, base.meta, base.outbox], async () => {
    // Filas con cambios sin enviar: de esas decide el envío (por versión). Las demás son iguales a las del servidor.
    const sucias = await filasPendientes(base)
    for (const { local, tablaCloud, remoto, cursor, versionada } of todas) {
      const tabla = base.table(local)
      for (let i = 0; i < remoto.length; i += 500) {
        const lote = remoto.slice(i, i + 500).map(filaLocalDeCloud)
        const llave = tabla.schema.primKey.name
        const actuales = await tabla.bulkGet(lote.map((f) => f[llave] as string))
        const aceptar: Record<string, unknown>[] = []
        lote.forEach((fila, j) => {
          const previo = actuales[j] as Record<string, unknown> | undefined
          if (local === 'preciosActuales') {
            if (actualMasNuevo(previo as unknown as PrecioActual, fila as unknown as PrecioActual)) aceptar.push(fila)
            return
          }
          // Una fila sin cambios pendientes aquí simplemente toma la versión más nueva del servidor: la fecha de edición
          // (reloj del celular que la escribió) no puede dejarla desactualizada.
          if (versionada) {
            // Con un cambio sin enviar aquí no se reemplaza nada: el envío lo resuelve por versión, con su versión original.
            if (sucias.has(`${local}:${fila[llave]}`)) return
            // Solo una versión más nueva reemplaza; una igual o más vieja (respuesta atrasada) nunca, sin mirar fechas.
            if (versionDe(fila) > versionDe(previo)) aceptar.push(fila)
            return
          }
          // Sin `updated_at` en la fila o en lo local (histórico, resumen de compra) no hay nada que comparar: no cambian.
          const comparable = local !== 'historial' && 'updated_at' in fila && !!previo && 'updated_at' in previo
          if (!comparable || ganaRemoto(previo as { updated_at: string }, fila as { updated_at: string })) aceptar.push(fila)
        })
        if (aceptar.length) await tabla.bulkPut(aceptar)
      }
      if (cursor) {
        // Cada tabla avanza por separado.
        const cursorConSolape = new Date(new Date(cursor).getTime() - SOLAPE_CURSOR_MS).toISOString()
        await base.meta.put({ clave: `cursorCloud:${tablaCloud}`, valor: cursorConSolape })
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
      const ctx = supabase ? await abrirContexto() : null
      // Con Supabase: sin sesión, o con una base local de otra cuenta (cambio de cuenta en curso), no se sincroniza.
      if (supabase && !ctx) return
      const c = supabase ? null : await conexion()
      if (!supabase && (!c?.url || !c.token)) return
      const base = ctx?.base ?? db
      await estado({ enCurso: true }, base)
      try {
        if (ctx) {
          if (await vaciarOutbox(ctx) && await traerCloud(ctx, opciones.completo)) await estado({ ultimoOk: Date.now(), error: await avisoRechazados(ctx) }, base)
        } else {
          const ok = await vaciarOutboxAppsScript(c!)
          if (ok && await traer(c!, opciones.completo)) await estado({ ultimoOk: Date.now(), error: null })
        }
      } catch (e) {
        // Si la cuenta cambió, la base puede estar cerrada y el error no es de esta sesión: se descarta.
        if (!ctx || vigente(ctx)) await estado({ error: String(e) }, base).catch(() => undefined)
      } finally {
        await estado({ enCurso: false }, base).catch(() => undefined)
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
