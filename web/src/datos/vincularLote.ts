import { mismoEan } from '@shared/ean.ts'
import type { Presentacion, Producto, Region } from '@shared/esquema.ts'
import type { TiendaVtex } from '@shared/tiendas.ts'
import type { UnidadBase } from '@shared/unidades.ts'
import { esDeMarca, type Opcion } from '@shared/vtex/ordenar.ts'
import type { Candidato } from '@shared/vtex/parse.ts'
import { llamarVtex } from './apiVtex.ts'
import { CuentaCambiada, db, exigirCuenta, generacionActual, guardarMeta, leerMeta } from './db.ts'
import { compraAbierta, guardar, nuevaPresentacion, observacion, registrarObservaciones } from './escritura.ts'
import { sincronizar } from './sync.ts'

export type Cand = Candidato & { region: Region }
export type OpcionLote = Opcion<Cand>
type PorTienda = Partial<Record<TiendaVtex, OpcionLote[]>>

/**
 * Las tiendas con catálogo online que se buscan solas (Ara no vende online). D1 no atiende Riohacha: su precio en internet
 * es el nacional y la app lo marca como «precio nacional»; el que la persona anota en la tienda manda.
 */
export const TIENDAS_LOTE: TiendaVtex[] = ['OLIMPICA', 'EXITO', 'D1']
const LOTE = 8
const HORAS_ENTRE_AUTOMATICOS = 20
const DIAS_SIN_REPETIR = 7
const HORAS_TRAS_FALLO = 1
/** Si el servicio pidió esperar un minuto (cuota), se reintenta pronto: no hace falta esperar la hora de un fallo de red. */
const ESPERA_TRAS_LIMITE_MS = 2 * 60_000

let candado: Promise<unknown> = Promise.resolve()

/** La búsqueda automática y "Buscar precios" no corren a la vez (si no, vincularían dos veces lo mismo). */
export function exclusivo<T>(fn: () => Promise<T>): Promise<T> {
  const r = candado.then(fn, fn)
  candado = r.catch(() => undefined)
  return r
}

/**
 * Crea la presentación de la tienda para el producto y guarda el precio que trajo la búsqueda.
 * Si ese SKU ya está vinculado al producto no lo repite; si el usuario lo había quitado, solo lo vuelve a poner
 * cuando él mismo lo elige (`reactivar`), nunca la búsqueda automática.
 * `cuenta` es la cuenta con la que empezó la operación: si cambió, no se escribe nada (sería de otra cuenta).
 */
export async function crearDesdeCandidato(producto: Producto, c: Cand, contenido: number | null, opciones: { reactivar?: boolean; cuenta?: number } = {}): Promise<Presentacion | null> {
  // Sin `cuenta` explícita (vincular a mano), la cuenta es la de este momento: un cambio durante la llamada la corta.
  const cuenta = opciones.cuenta ?? generacionActual()
  const revisarCuenta = () => exigirCuenta(cuenta)
  revisarCuenta()
  const deLaTienda = (await db.presentaciones.where('producto_id').equals(producto.producto_id).toArray()).filter((x) => x.tienda === c.tienda)
  // Si la persona ya tiene en esa tienda el mismo producto (mismo código de barras) sin vínculo online —la que se crea al
  // escanear en el estante—, se vincula esa: dos presentaciones del mismo producto en una tienda competirían por precio y
  // la de internet (más barata, nacional) taparía el precio anotado en el estante.
  const delEstante = c.ean ? deLaTienda.filter((x) => !x.sku_id && mismoEan(x.ean, c.ean)).sort((a, b) => Number(b.activo) - Number(a.activo))[0] : undefined
  const previa = deLaTienda.find((x) => x.sku_id === c.skuId) ?? delEstante
  revisarCuenta()
  if (previa && !previa.activo && !opciones.reactivar) return null
  const vincula = !!previa && previa.sku_id !== c.skuId
  const [p] = previa
    ? previa.activo && !vincula ? [previa] : await guardar<Presentacion>('Presentaciones', {
      ...previa,
      activo: true,
      contenido: contenido ?? previa.contenido,
      ...(vincula ? { sku_id: c.skuId, vtex_product_id: c.productId, url: c.url || previa.url, auto: true, nombre_en_tienda: previa.nombre_en_tienda || c.nombre, marca: previa.marca || c.marca } : {}),
    })
    : await guardar<Presentacion>('Presentaciones', nuevaPresentacion({
      // Id fijo: si dos celulares vinculan lo mismo, en el Sheet queda una sola fila.
      presentacion_id: `auto-${producto.producto_id}-${c.tienda}-${c.skuId}`,
      producto_id: producto.producto_id,
      tienda: c.tienda,
      nombre_en_tienda: c.nombre,
      marca: c.marca,
      contenido,
      sku_id: c.skuId,
      ean: c.ean,
      vtex_product_id: c.productId,
      url: c.url,
      auto: true,
    }))
  if (c.precio != null) {
    revisarCuenta()
    await registrarObservaciones([observacion({ presentacion: p, precio: c.precio, precioLista: c.precioLista, origen: 'online', fuente: 'auto', disponible: c.disponible, region: c.region })])
  }
  return p
}

/**
 * Productos activos sin ninguna presentación online en Olímpica ni Éxito. Los que tuvieron un vínculo automático
 * que el usuario quitó ya se revisaron: no se vuelven a buscar solos (se pueden vincular a mano).
 */
export async function productosSinVincular(): Promise<Producto[]> {
  const [productos, presentaciones] = await Promise.all([db.productos.toArray(), db.presentaciones.toArray()])
  const online = presentaciones.filter((p) => p.sku_id && TIENDAS_LOTE.includes(p.tienda as TiendaVtex))
  const revisado = new Set(online.filter((p) => p.activo || p.auto).map((p) => p.producto_id))
  return productos.filter((p) => p.activo && !revisado.has(p.producto_id))
}

type Item = { id: string; q?: string; ean?: string; unidad: UnidadBase; marca?: string }

/** Lo que se busca de un producto: su nombre y, si tiene, su marca preferida. */
export function itemDe(p: Producto): Item {
  return { id: p.producto_id, q: p.nombre, unidad: p.unidad_base, ...(p.marca ? { marca: p.marca } : {}) }
}

/**
 * Un fallo de red o del servidor se reintenta pronto (a la hora); que el script sea viejo no se arregla esperando un rato:
 * eso se trata como una revisión hecha (una vez al día) y el aviso lo ve la persona al elegir una marca.
 */
const fallaLaRed = (f: string | null): boolean => !!f

/** Busca de a 8 productos por llamada. Si el servidor no responde, se detiene y lo dice. */
export async function buscarLote(items: Item[], tiendas: TiendaVtex[] = TIENDAS_LOTE, onAvance?: (hechos: number, total: number) => void, cuenta = generacionActual()) {
  const resultados = new Map<string, PorTienda>()
  const errores = new Set<string>()
  let sinMarcas = false
  for (let i = 0; i < items.length; i += LOTE) {
    onAvance?.(i, items.length)
    const lote = items.slice(i, i + LOTE)
    const r = await llamarVtex<{ resultados: { id: string; porTienda: PorTienda }[]; errores: string[]; marcas?: boolean }>('buscarVarios', { items: lote, tiendas }, undefined, cuenta)
    // Los resultados de otra cuenta no se usan para nada: la operación entera se corta.
    exigirCuenta(cuenta)
    if (r.tipo !== 'ok') {
      return { resultados, errores: [...errores], sinMarcas, fallo: r.tipo === 'error' ? r.mensaje : 'Sin respuesta. ¿Hay señal?', limite: r.tipo === 'error' && r.codigo === 'rate_limit' }
    }
    // Un script viejo ignora la marca y marcaría como segura otra: lo de los productos con marca no se usa.
    const confiar = r.data?.marcas === true
    const conMarca = new Set(lote.filter((x) => x.marca).map((x) => x.id))
    if (!confiar && conMarca.size) sinMarcas = true
    for (const x of r.data?.resultados ?? []) if (confiar || !conMarca.has(x.id)) resultados.set(x.id, x.porTienda)
    for (const e of r.data?.errores ?? []) errores.add(e)
  }
  onAvance?.(items.length, items.length)
  return { resultados, errores: [...errores], sinMarcas, fallo: null as string | null, limite: false }
}

/**
 * La opción segura de cada tienda, si la hay. Con marca preferida, solo si es de esa marca (el servidor ya lo
 * cuida; esto protege también frente a un script que todavía no conoce las marcas).
 */
export function seguros(porTienda: PorTienda | undefined, marca?: string): OpcionLote[] {
  return TIENDAS_LOTE.flatMap((t) => porTienda?.[t]?.filter((o) => o.seguro && esDeMarca(o, marca)).slice(0, 1) ?? [])
}

/** Todas las opciones de un producto, de la más a la menos parecida. */
export function opcionesDe(porTienda: PorTienda | undefined): OpcionLote[] {
  return TIENDAS_LOTE.flatMap((t) => porTienda?.[t] ?? []).sort((a, b) => b.puntaje - a.puntaje)
}

export interface Elegido {
  producto: Producto
  opciones: OpcionLote[]
}

/**
 * Vincula lo elegido. Si un producto quedó sin alguna de las dos tiendas, busca su código de barras en la otra
 * y lo agrega si está (mismo producto, así que es seguro). Devuelve cuántos productos quedaron vinculados.
 */
export async function vincular(elegidos: Elegido[], onAvance?: (hechos: number, total: number) => void, opciones: { reactivar?: boolean } = {}, cuenta = generacionActual()): Promise<number> {
  try {
    return await vincularDeCuenta(elegidos, cuenta, onAvance, opciones)
  } catch (e) {
    // Si se cerró la sesión o se cambió de cuenta a mitad, lo que faltaba no se escribe en la cuenta nueva.
    if (e instanceof CuentaCambiada) return 0
    throw e
  }
}

async function vincularDeCuenta(elegidos: Elegido[], cuenta: number, onAvance: ((hechos: number, total: number) => void) | undefined, opciones: { reactivar?: boolean }): Promise<number> {
  const conEan = new Map<string, { item: Item; faltan: TiendaVtex[] }>()
  const hechos = new Set<string>()
  let n = 0
  for (const e of elegidos) {
    onAvance?.(n++, elegidos.length)
    for (const o of e.opciones) {
      if (await crearDesdeCandidato(e.producto, o, o.contenido!.valor, { ...opciones, cuenta })) hechos.add(e.producto.producto_id)
    }
    const faltan = TIENDAS_LOTE.filter((t) => !e.opciones.some((o) => o.tienda === t))
    const ean = e.opciones.find((o) => o.ean)?.ean
    if (faltan.length && ean) conEan.set(e.producto.producto_id, { item: { id: e.producto.producto_id, ean, unidad: e.producto.unidad_base }, faltan })
  }
  // Por código de barras se pide solo en las tiendas que le faltan a cada producto (cada tienda consultada gasta cuota), y
  // los productos con las mismas tiendas faltantes van juntos.
  const grupos = new Map<string, { faltan: TiendaVtex[]; items: Item[] }>()
  for (const { item, faltan } of conEan.values()) {
    const g = grupos.get(faltan.join(',')) ?? { faltan, items: [] }
    g.items.push(item)
    grupos.set(faltan.join(','), g)
  }
  for (const g of grupos.values()) {
    const { resultados } = await buscarLote(g.items, g.faltan, undefined, cuenta)
    for (const e of elegidos) {
      if (!g.items.some((i) => i.id === e.producto.producto_id)) continue
      for (const o of seguros(resultados.get(e.producto.producto_id)).filter((x) => g.faltan.includes(x.tienda))) {
        if (await crearDesdeCandidato(e.producto, o, o.contenido!.valor, { cuenta })) hechos.add(e.producto.producto_id)
      }
    }
  }
  onAvance?.(elegidos.length, elegidos.length)
  return hechos.size
}

interface EstadoAuto {
  ultimo: number
  /** Última vez que la búsqueda falló (sin señal, script viejo): se espera un rato antes de reintentar. */
  fallo?: number
  /** Cuánto esperar tras ese fallo (ms); sin esto, `HORAS_TRAS_FALLO`. Un límite de cuota se levanta en minutos. */
  espera?: number
  /** Productos revisados sin opción segura: no se vuelven a buscar solos por unos días. */
  revisados: Record<string, number>
}

let enCurso: Promise<ResultadoAuto | null> | null = null
export interface ResultadoAuto {
  vinculados: number
  dudosos: number
  sinResultado: number
  /** Productos que no se alcanzaron a buscar porque el servicio falló o pidió esperar. */
  sinBuscar?: number
  /** El servicio pidió esperar un minuto (cuota): lo que falta se busca en la próxima vuelta. */
  limite?: boolean
}

/**
 * Lo automático: busca los productos sin precio de internet y vincula solos los que coinciden sin duda.
 * Corre al abrir la app (una vez al día) y después de pegar la lista (forzar). Los dudosos quedan para revisar.
 * No corre en plena compra (movería los productos entre tiendas mientras marcas), salvo que se fuerce.
 */
export function autoVincular(opciones: { forzar?: boolean } = {}): Promise<ResultadoAuto | null> {
  // Si ya hay una corriendo y se pide forzar (acabas de pegar la lista), se corre otra después con lo nuevo.
  if (enCurso) return opciones.forzar ? enCurso.then(() => autoVincular(opciones)) : enCurso
  enCurso = exclusivo(() => correrAuto(opciones, generacionActual()))
    // Si la cuenta cambió a mitad, el resultado era de la cuenta anterior: no hay nada que informar.
    .catch((e: unknown) => { if (e instanceof CuentaCambiada) return null; throw e })
    .finally(() => { enCurso = null })
  return enCurso
}

async function correrAuto(opciones: { forzar?: boolean }, cuenta: number): Promise<ResultadoAuto | null> {
  const r = await correrAutoBase(opciones, cuenta)
  // Si no tocaba correr, tampoco se completa nada. Un fallo al completar no tumba el resultado de lo ya hecho.
  if (r) {
    try { await completarTiendas(cuenta) } catch (e) { if (e instanceof CuentaCambiada) throw e }
  }
  return r
}

/** Máximo de productos que se completan por vuelta (cada llamada del servicio tiene su cuota). */
const MAX_COMPLETAR = 40

/**
 * Productos que ya tienen vínculo online pero no tienen el de la tienda `t` (por ejemplo D1, que se agregó después de que
 * la persona vinculara los suyos). Si en esa tienda hubo un vínculo y la persona lo quitó, no se insiste.
 */
export async function productosSinTienda(t: TiendaVtex): Promise<Producto[]> {
  const [productos, presentaciones] = await Promise.all([db.productos.toArray(), db.presentaciones.toArray()])
  const vinculadas = presentaciones.filter((p) => p.activo && p.sku_id && TIENDAS_LOTE.includes(p.tienda as TiendaVtex))
  const vinculados = new Set(vinculadas.map((p) => p.producto_id))
  // «Ya está en la tienda»: tiene su vínculo online allí (aunque la persona lo quitara) o una presentación creada al escanear
  // en el estante, que es el mismo producto (mismo código de barras que una de sus presentaciones vinculadas).
  const delEstante = (p: Presentacion) => p.activo && !!p.ean && vinculadas.some((v) => v.producto_id === p.producto_id && mismoEan(v.ean, p.ean))
  const yaEnTienda = new Set(presentaciones.filter((p) => p.tienda === t && (p.sku_id || delEstante(p))).map((p) => p.producto_id))
  return productos.filter((p) => p.activo && vinculados.has(p.producto_id) && !yaEnTienda.has(p.producto_id))
}

/**
 * Completa cada tienda de la búsqueda online en los productos ya vinculados: por código de barras (mismo producto, seguro) si
 * se conoce el de alguna de sus presentaciones, y si no, por nombre aceptando solo lo seguro (con su marca preferida, si
 * tiene). Cada producto se revisa en cada tienda a lo sumo una vez cada 7 días —también al pegar la lista: los productos
 * nuevos no tienen sello y entran solos—, empezando por los que hace más que no se miran, así que cada vuelta avanza.
 * Devuelve cuántas presentaciones creó.
 */
async function completarTiendas(cuenta: number): Promise<number> {
  const estado = await leerMeta<Record<string, number>>('completarTiendas', {})
  exigirCuenta(cuenta)
  const ahora = Date.now()
  let creadas = 0
  for (const t of TIENDAS_LOTE) {
    const sello = (p: Producto) => estado[`${t}:${p.producto_id}`] ?? 0
    const pendientes = (await productosSinTienda(t))
      .filter((p) => ahora - sello(p) >= DIAS_SIN_REPETIR * 86400_000)
      .sort((a, b) => sello(a) - sello(b))
      .slice(0, MAX_COMPLETAR)
    if (!pendientes.length) continue
    const presentaciones = await db.presentaciones.toArray()
    exigirCuenta(cuenta)
    /**
     * El código de barras de una presentación del producto. Con marca preferida solo vale el de esa marca: el de otra marca
     * (que quedó donde la preferida no apareció) llevaría a vincular esa otra marca en todas las tiendas.
     */
    const eanDe = (p: Producto, deOtraMarca = false) => presentaciones
      .find((x) => x.producto_id === p.producto_id && x.activo && x.ean
        && (deOtraMarca || !p.marca || esDeMarca({ nombre: x.nombre_en_tienda, marca: x.marca }, p.marca)))?.ean
    const items: Item[] = pendientes.map((p) => {
      const ean = eanDe(p)
      return ean ? { id: p.producto_id, ean, unidad: p.unidad_base } : itemDe(p)
    })
    const primera = await buscarLote(items, [t], undefined, cuenta)
    exigirCuenta(cuenta)
    // Con la marca preferida se buscó por nombre; si allí no está, se cae al código de barras de la otra marca.
    const segunda = new Map<string, PorTienda>()
    let falloSegunda: string | null = null
    if (!primera.fallo) {
      const otras = pendientes.filter((p) => p.marca && !eanDe(p) && eanDe(p, true) && !seguros(primera.resultados.get(p.producto_id), p.marca).some((o) => o.tienda === t))
      if (otras.length) {
        const r = await buscarLote(otras.map((p) => ({ id: p.producto_id, ean: eanDe(p, true), unidad: p.unidad_base })), [t], undefined, cuenta)
        exigirCuenta(cuenta)
        falloSegunda = r.fallo
        for (const [id, porTienda] of r.resultados) segunda.set(id, porTienda)
      }
    }
    // Lo que se alcanzó a buscar se aprovecha y se sella aunque el servicio haya fallado después (cuota a mitad de la lista);
    // lo que no, queda sin sello y se reintenta en la próxima vuelta.
    for (const p of pendientes) {
      const buscado = primera.resultados.get(p.producto_id)
      if (!buscado) continue
      const porEan = !!eanDe(p)
      let seguras = seguros(buscado, porEan ? undefined : p.marca).filter((o) => o.tienda === t)
      if (!seguras.length && p.marca && !porEan && eanDe(p, true)) {
        if (!segunda.has(p.producto_id)) continue // la segunda consulta no se hizo o falló: se reintenta
        seguras = seguros(segunda.get(p.producto_id)).filter((o) => o.tienda === t)
      }
      estado[`${t}:${p.producto_id}`] = ahora
      for (const o of seguras) {
        if (await crearDesdeCandidato(p, o, o.contenido?.valor ?? null, { cuenta })) creadas++
      }
    }
    exigirCuenta(cuenta)
    await guardarMeta('completarTiendas', estado)
    // Sin señal, sin respuesta o sin cuota: se detiene aquí; lo demás se reintenta en la próxima vuelta.
    if (primera.fallo || falloSegunda) return creadas
  }
  return creadas
}

async function correrAutoBase(opciones: { forzar?: boolean }, cuenta: number): Promise<ResultadoAuto | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  exigirCuenta(cuenta)
  const estado = await leerMeta<EstadoAuto>('autoVinculo', { ultimo: 0, revisados: {} })
  exigirCuenta(cuenta)
  const ahora = Date.now()
  if (!opciones.forzar) {
    if (ahora - estado.ultimo < HORAS_ENTRE_AUTOMATICOS * 3600_000) return null
    if (estado.fallo && ahora - estado.fallo < (estado.espera ?? HORAS_TRAS_FALLO * 3600_000)) return null
    if ((await compraAbierta())?.estado === 'en_curso') return null
  }
  // Primero lo último del Sheet: otro celular pudo haber vinculado ya estos productos.
  await sincronizar()
  exigirCuenta(cuenta)
  const recientes = (id: string) => ahora - (estado.revisados[id] ?? 0) < DIAS_SIN_REPETIR * 86400_000
  const pendientes = (await productosSinVincular()).filter((p) => opciones.forzar || !recientes(p.producto_id))
  // Marcas que se eligieron cuando no se pudo buscar (sin señal, script viejo): se reintentan aquí.
  const idsMarca = await leerMeta<string[]>('marcasPendientes', [])
  const conMarcaPendiente = idsMarca.length ? (await db.productos.bulkGet(idsMarca)).filter((p): p is Producto => !!p && p.activo && !!p.marca) : []
  exigirCuenta(cuenta)
  let falloMarca: string | null = null
  if (conMarcaPendiente.length) {
    const pend = new Set(idsMarca)
    for (const p of conMarcaPendiente) {
      const r = await vincularMarcaAhora(p, cuenta)
      if (r.tipo === 'ok') pend.delete(p.producto_id)
      else if (r.tipo === 'fallo') { falloMarca = r.motivo; break }
    }
    for (const id of idsMarca) if (!conMarcaPendiente.some((p) => p.producto_id === id)) pend.delete(id)
    exigirCuenta(cuenta)
    await guardarMeta('marcasPendientes', [...pend])
  }
  if (!pendientes.length) {
    exigirCuenta(cuenta)
    await guardarMeta('autoVinculo', fallaLaRed(falloMarca) ? { ...estado, fallo: ahora } : { ...estado, ultimo: ahora })
    return { vinculados: 0, dudosos: 0, sinResultado: 0, sinBuscar: 0, limite: false }
  }
  const { resultados, fallo: falloBusqueda, sinMarcas, limite } = await buscarLote(pendientes.map(itemDe), TIENDAS_LOTE, undefined, cuenta)
  const fallo = falloBusqueda ?? (sinMarcas ? 'El servicio de precios no pudo confirmar las marcas.' : null) ?? falloMarca
  const elegidos: Elegido[] = []
  let dudosos = 0
  let sinResultado = 0
  const revisados = { ...estado.revisados }
  for (const p of pendientes) {
    const porTienda = resultados.get(p.producto_id)
    if (!porTienda) continue
    const s = seguros(porTienda, p.marca)
    if (s.length) elegidos.push({ producto: p, opciones: s })
    else {
      revisados[p.producto_id] = ahora
      if (opcionesDe(porTienda).length) dudosos++
      else sinResultado++
    }
  }
  const vinculados = await vincularDeCuenta(elegidos, cuenta, undefined, {})
  exigirCuenta(cuenta)
  // Si el servicio pidió esperar (cuota), el reintento es en minutos; un fallo de red o de versión espera la hora de siempre.
  await guardarMeta('autoVinculo', fallaLaRed(fallo)
    ? { ...estado, revisados, fallo: ahora, ...(limite ? { espera: ESPERA_TRAS_LIMITE_MS } : { espera: undefined }) }
    : { ultimo: ahora, revisados })
  return { vinculados, dudosos, sinResultado, sinBuscar: pendientes.filter((p) => !resultados.has(p.producto_id)).length, limite }
}

export type ResultadoMarca =
  | { tipo: 'ok'; /** Tiendas donde quedó vinculada la marca preferida. */ con: TiendaVtex[]; /** Tiendas online donde no apareció esa marca (se deja lo que había). */ sin: TiendaVtex[] }
  | { tipo: 'fallo'; motivo: string }

async function vincularMarcaAhora(producto: Producto, cuenta: number): Promise<ResultadoMarca> {
  if (!producto.marca) return { tipo: 'ok', con: [], sin: [] }
  const { resultados, fallo, sinMarcas } = await buscarLote([itemDe(producto)], TIENDAS_LOTE, undefined, cuenta)
  if (fallo) return { tipo: 'fallo', motivo: fallo }
  if (sinMarcas) return { tipo: 'fallo', motivo: 'El servicio de precios no pudo confirmar las marcas.' }
  const antes = await db.presentaciones.where('producto_id').equals(producto.producto_id).toArray()
  const con: TiendaVtex[] = []
  for (const o of seguros(resultados.get(producto.producto_id), producto.marca)) {
    const nueva = await crearDesdeCandidato(producto, o, o.contenido!.valor, { reactivar: true, cuenta })
    if (!nueva) continue
    con.push(o.tienda)
    const otras = antes.filter((x) => x.tienda === o.tienda && x.activo && x.sku_id && x.presentacion_id !== nueva.presentacion_id
      && !esDeMarca({ nombre: x.nombre_en_tienda, marca: x.marca }, producto.marca))
    exigirCuenta(cuenta)
    if (otras.length) await guardar<Presentacion>('Presentaciones', otras.map((x) => ({ ...x, activo: false })))
  }
  return { tipo: 'ok', con, sin: TIENDAS_LOTE.filter((t) => !con.includes(t)) }
}

/**
 * Al elegir la marca preferida de un producto: la busca en Olímpica, Éxito y D1 y, donde la encuentra sin duda, la
 * vincula y quita el vínculo a otra marca en esa tienda. Donde no está, deja lo que había (mejor un precio de otra
 * marca que ninguno). Si no se pudo buscar, queda pendiente: la búsqueda automática lo reintenta.
 */
export function vincularMarca(producto: Producto): Promise<ResultadoMarca> {
  const cuenta = generacionActual()
  return exclusivo(async () => {
    try {
      const r = await vincularMarcaAhora(producto, cuenta)
      exigirCuenta(cuenta)
      const pend = new Set(await leerMeta<string[]>('marcasPendientes', []))
      exigirCuenta(cuenta)
      if (r.tipo === 'ok') pend.delete(producto.producto_id)
      else if (producto.marca) pend.add(producto.producto_id)
      await guardarMeta('marcasPendientes', [...pend])
      return r
    } catch (e) {
      // Cambió la cuenta: la marca pendiente era de la anterior y no se anota en la nueva.
      if (e instanceof CuentaCambiada) return { tipo: 'fallo', motivo: 'La cuenta cambió mientras se buscaba la marca.' } satisfies ResultadoMarca
      throw e
    }
  })
}
