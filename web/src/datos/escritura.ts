import { claveActual, type Categoria, type Compra, type Detalle, type NombreTabla, type Observacion, type Presentacion, type Producto } from '@shared/esquema.ts'
import { aMs, compararIso, esIso, isoBogota } from '@shared/fechas.ts'
import { aplicarObservaciones } from '@shared/observaciones.ts'
import type { Tienda } from '@shared/tiendas.ts'
import { nuevoId } from './api.ts'
import { db, TABLA_LOCAL } from './db.ts'
import { ahoraIso, encolar, sincronizarPronto } from './sync.ts'

/** Escribe en local y deja el cambio en la cola, en la misma transacción. */
export async function guardar<T extends object>(tabla: NombreTabla, filas: T | T[]): Promise<T[]> {
  const local = TABLA_LOCAL[tabla]
  if (!local) throw new Error(`Tabla ${tabla} no se escribe desde la app`)
  const ahora = ahoraIso()
  // La fecha nueva siempre es posterior a la que traía la fila: si el reloj del celular va atrasado respecto a
  // quien la escribió antes, la edición igual gana (si no, el servidor la descartaría por "vieja").
  const despuesDe = (previa: unknown) =>
    esIso(previa) && compararIso(previa, ahora) >= 0 ? isoBogota(aMs(previa) + 1) : ahora
  const lista = (Array.isArray(filas) ? filas : [filas]).map((f) => ({ ...f, updated_at: despuesDe((f as { updated_at?: unknown }).updated_at) }))
  await db.transaction('rw', db.table(local), db.outbox, async () => {
    await db.table(local).bulkPut(lista)
    // En tandas de 100: una lista de 300 renglones en un solo envío la rechazaría el servidor entera.
    for (let i = 0; i < lista.length; i += 100) {
      await encolar('upsert', { cambios: lista.slice(i, i + 100).map((fila) => ({ tabla, fila })) })
    }
  })
  sincronizarPronto()
  return lista
}

export async function guardarConfig(clave: string, valor: string) {
  await guardar('Config', { clave, valor })
}

export function nuevoProducto(p: Partial<Producto> & Pick<Producto, 'nombre'>): Producto {
  return {
    producto_id: nuevoId(), categoria_id: '', unidad_base: 'g', recurrente: false, cantidad_habitual: 1, notas: '',
    activo: true, marca: '', updated_at: ahoraIso(), ...p,
  }
}

export function nuevaPresentacion(p: Partial<Presentacion> & Pick<Presentacion, 'producto_id' | 'tienda'>): Presentacion {
  return {
    presentacion_id: nuevoId(), nombre_en_tienda: '', marca: '', contenido: null, granel: false, sku_id: '', ean: '',
    vtex_product_id: '', url: '', auto: false, activo: true, ultimo_error: '', updated_at: ahoraIso(), ...p,
  }
}

export async function crearCategoria(nombre: string): Promise<Categoria> {
  const todas = await db.categorias.toArray()
  const existente = todas.find((c) => !c.borrado && c.nombre.trim().toLowerCase() === nombre.trim().toLowerCase())
  if (existente) return existente
  const orden = todas.reduce((m, c) => Math.max(m, c.orden), 0) + 1
  const [c] = await guardar<Categoria>('Categorias', { categoria_id: nuevoId(), nombre: nombre.trim(), orden, borrado: false, updated_at: '' })
  return c
}

export function observacion(p: {
  presentacion: Presentacion
  precio: number | null
  origen: Observacion['origen']
  fuente: Observacion['fuente']
  precioLista?: number | null
  disponible?: boolean
  region?: Observacion['region']
  compraId?: string
  id?: string
}): Observacion {
  return {
    obs_id: p.id ?? nuevoId(),
    presentacion_id: p.presentacion.presentacion_id,
    tienda: p.presentacion.tienda,
    origen: p.origen,
    fuente: p.fuente,
    precio: p.precio == null ? null : Math.round(p.precio),
    precio_lista: p.precioLista == null ? null : Math.round(p.precioLista),
    disponible: p.disponible ?? true,
    region: p.region ?? '',
    fecha_observado: ahoraIso(),
    compra_id: p.compraId ?? '',
  }
}

/** Aplica los precios en local (para verlos al instante) y los manda al servidor, que hace lo mismo. */
export async function registrarObservaciones(obs: Observacion[]) {
  if (!obs.length) return
  await db.transaction('rw', db.preciosActuales, db.historial, db.outbox, async () => {
    const previos = await db.preciosActuales.bulkGet(obs.map((o) => claveActual(o.presentacion_id, o.origen)))
    const mapa = new Map(previos.filter((p) => !!p).map((p) => [p!.clave, p!]))
    const r = aplicarObservaciones(mapa, obs)
    if (r.actuales.length) await db.preciosActuales.bulkPut(r.actuales)
    if (r.historial.length) await db.historial.bulkPut(r.historial)
    await encolar('upsert', { cambios: obs.map((fila) => ({ tabla: 'Observaciones', fila })) })
  })
  sincronizarPronto()
}

export async function registrarPrecioManual(presentacion: Presentacion, precio: number) {
  await registrarObservaciones([observacion({ presentacion, precio, origen: 'tienda', fuente: 'manual' })])
}

// ---------- Compras ----------

export async function compraAbierta(): Promise<Compra | undefined> {
  const xs = await db.compras.toArray()
  return xs.filter((c) => !c.borrado && (c.estado === 'en_curso' || c.estado === 'borrador')).sort((a, b) => (a.fecha_inicio < b.fecha_inicio ? 1 : -1))[0]
}

export function nuevoDetalle(compraId: string, p: Partial<Detalle>): Detalle {
  return {
    detalle_id: nuevoId(), compra_id: compraId, producto_id: '', nombre_libre: '', necesidad: null, presentacion_id: '', tienda: '',
    cantidad: null, precio_unitario: null, subtotal: null, estado: 'pendiente', orden: Date.now(), updated_at: ahoraIso(), borrado: false,
    ...p,
  }
}

let enCola: Promise<unknown> = Promise.resolve()

/**
 * Los pasos que leen la compra y luego escriben van de a uno: un doble toque en "+ Agregar" o en "Armar compra"
 * no puede crear dos compras abiertas ni el mismo producto dos veces.
 */
function enSerie<T>(fn: () => Promise<T>): Promise<T> {
  const r = enCola.then(fn, fn)
  enCola = r.catch(() => undefined)
  return r
}

/** Crea (o devuelve) la lista abierta, arrancando con los productos recurrentes. */
export function asegurarCompra(tiendasHoy: Tienda[]): Promise<Compra> {
  return enSerie(() => asegurarCompraAhora(tiendasHoy))
}

async function asegurarCompraAhora(tiendasHoy: Tienda[]): Promise<Compra> {
  const abierta = await compraAbierta()
  if (abierta) return abierta
  const compra: Compra = {
    compra_id: nuevoId(), estado: 'borrador', fecha_inicio: ahoraIso(), fecha_cierre: '', presupuesto: null,
    tiendas_hoy: tiendasHoy.join(','), total_final: null, tienda_referencia: '', total_referencia: null, items_comparados: null,
    items_total: null, ahorro: null, notas: '', updated_at: '', borrado: false,
  }
  const recurrentes = (await db.productos.toArray()).filter((p) => p.activo && p.recurrente)
  await guardar('Compras', compra)
  if (recurrentes.length) {
    await guardar('Compras_detalle', recurrentes.map((p, i) => nuevoDetalle(compra.compra_id, { producto_id: p.producto_id, necesidad: p.cantidad_habitual, orden: i })))
  }
  return compra
}

export function agregarALaCompra(producto: Producto, tiendasHoy: Tienda[]): Promise<Detalle> {
  return enSerie(async () => {
    const compra = await asegurarCompraAhora(tiendasHoy)
    const ya = (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).find((d) => !d.borrado && d.producto_id === producto.producto_id)
    if (ya) return ya
    const [d] = await guardar('Compras_detalle', nuevoDetalle(compra.compra_id, { producto_id: producto.producto_id, necesidad: producto.cantidad_habitual }))
    return d
  })
}

/** Quita un producto de la compra abierta (con Deshacer en la pantalla). Devuelve el ítem quitado. */
export function quitarDeLaCompra(productoId: string): Promise<Detalle | undefined> {
  return enSerie(async () => {
    const compra = await compraAbierta()
    if (!compra) return undefined
    const d = (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).find((x) => !x.borrado && x.producto_id === productoId)
    if (!d) return undefined
    await guardar('Compras_detalle', { ...d, borrado: true })
    return d
  })
}

/** Deshacer: vuelve a poner el ítem, salvo que el producto ya se haya agregado otra vez (no duplica). */
export function restaurarDetalle(d: Detalle): Promise<void> {
  return enSerie(async () => {
    const otro = d.producto_id && (await db.detalle.where('compra_id').equals(d.compra_id).toArray())
      .some((x) => !x.borrado && x.detalle_id !== d.detalle_id && x.producto_id === d.producto_id)
    if (!otro) await guardar('Compras_detalle', { ...d, borrado: false })
  })
}

type Base = [nombre: string, unidad: Producto['unidad_base'], cantidad: number]

/** Para no empezar de cero: los productos que casi todo el mundo compra en la costa, por pasillo. */
export const LISTA_TIPICA: [pasillo: string, productos: Base[]][] = [
  ['Frutas y verduras', [['Tomate', 'g', 1], ['Cebolla cabezona', 'g', 1], ['Plátano verde', 'unidad', 6], ['Papa', 'g', 2], ['Limón', 'unidad', 10]]],
  ['Granos', [['Arroz', 'g', 5], ['Fríjol', 'g', 1], ['Lentejas', 'g', 0.5]]],
  ['Lácteos y huevos', [['Leche entera', 'ml', 6], ['Huevos AA', 'unidad', 30], ['Queso costeño', 'g', 0.5]]],
  ['Despensa', [['Aceite', 'ml', 1], ['Azúcar', 'g', 2], ['Sal', 'g', 1], ['Café', 'g', 0.5], ['Pasta', 'g', 1]]],
  ['Carnes', [['Pollo', 'g', 2], ['Carne molida', 'g', 1]]],
  ['Aseo', [['Papel higiénico', 'unidad', 12], ['Jabón en barra', 'unidad', 3], ['Detergente en polvo', 'g', 1]]],
]

export async function crearListaTipica() {
  const ahora = ahoraIso()
  const categorias: Categoria[] = []
  const productos: Producto[] = []
  LISTA_TIPICA.forEach(([pasillo, items], i) => {
    const c: Categoria = { categoria_id: nuevoId(), nombre: pasillo, orden: i + 1, borrado: false, updated_at: ahora }
    categorias.push(c)
    for (const [nombre, unidad_base, cantidad_habitual] of items) {
      productos.push(nuevoProducto({ nombre, categoria_id: c.categoria_id, unidad_base, cantidad_habitual, recurrente: true }))
    }
  })
  await guardar('Categorias', categorias)
  await guardar('Productos', productos)
  return productos.length
}

/** Lo que el usuario confirmó en "Pegar mi lista". `existente` = producto suyo que se actualiza en vez de duplicarlo. */
export interface ElegidoDeLista {
  nombre: string
  cantidad: number
  unidad_base: Producto['unidad_base']
  pasillo: string
  existente: Producto | null
}

/**
 * Crea los pasillos y productos de la lista pegada (marcados con ★) y, si se pide, los mete en la compra de hoy
 * con la cantidad de la lista. Los que ya existían se actualizan, no se duplican.
 */
/**
 * Con `reemplazar`, la lista pegada pasa a ser toda tu lista: los productos que no están en ella se archivan (no se
 * borran: conservan su historial de precios y sus vínculos, y reviven si vuelven a aparecer en una lista) y salen
 * de la compra abierta, salvo lo que ya está en el carrito.
 */
export async function crearDesdeLista(
  xs: ElegidoDeLista[],
  opciones: { recurrentes: boolean; aLaCompra: boolean; tiendasHoy: Tienda[]; reemplazar?: boolean },
) {
  const categorias = (await db.categorias.toArray()).filter((c) => !c.borrado)
  const porNombre = new Map(categorias.map((c) => [c.nombre.trim().toLowerCase(), c]))
  let orden = categorias.reduce((m, c) => Math.max(m, c.orden), 0)
  const nuevas: Categoria[] = []
  const pasilloDe = (nombre: string): string => {
    const k = nombre.trim().toLowerCase()
    if (!k) return ''
    let c = porNombre.get(k)
    if (!c) {
      c = { categoria_id: nuevoId(), nombre: nombre.trim(), orden: ++orden, borrado: false, updated_at: '' }
      porNombre.set(k, c)
      nuevas.push(c)
    }
    return c.categoria_id
  }

  const productos = xs.map((x) => {
    const categoria_id = pasilloDe(x.pasillo)
    if (x.existente) {
      return {
        ...x.existente,
        activo: true,
        cantidad_habitual: x.cantidad,
        recurrente: x.existente.recurrente || opciones.recurrentes,
        categoria_id: x.existente.categoria_id || categoria_id,
      }
    }
    return nuevoProducto({ nombre: x.nombre.trim(), categoria_id, unidad_base: x.unidad_base, cantidad_habitual: x.cantidad, recurrente: opciones.recurrentes })
  })
  if (nuevas.length) await guardar('Categorias', nuevas)
  await guardar('Productos', productos)

  // Antes de armar la compra: así una compra nueva no arranca con los productos que se van a archivar.
  let archivados: Producto[] = []
  let quitados: Detalle[] = []
  if (opciones.reemplazar) {
    const quedan = new Set(productos.map((p) => p.producto_id))
    archivados = (await db.productos.toArray()).filter((p) => p.activo && !quedan.has(p.producto_id))
    if (archivados.length) {
      await guardar('Productos', archivados.map((p) => ({ ...p, activo: false })))
      const compra = await compraAbierta()
      if (compra) {
        const fuera = new Set(archivados.map((p) => p.producto_id))
        quitados = (await db.detalle.where('compra_id').equals(compra.compra_id).toArray())
          .filter((d) => !d.borrado && !!d.producto_id && fuera.has(d.producto_id) && d.estado !== 'en_carrito')
        if (quitados.length) await guardar('Compras_detalle', quitados.map((d) => ({ ...d, borrado: true })))
      }
    }
  }

  if (opciones.aLaCompra && productos.length) {
    const compra = await asegurarCompra(opciones.tiendasHoy)
    const ya = new Map((await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).filter((d) => !d.borrado).map((d) => [d.producto_id, d]))
    const base = Date.now()
    await guardar('Compras_detalle', productos.map((p, i) => {
      const d = ya.get(p.producto_id)
      return d ? { ...d, necesidad: p.cantidad_habitual } : nuevoDetalle(compra.compra_id, { producto_id: p.producto_id, necesidad: p.cantidad_habitual, orden: base + i })
    }))
  }
  return { creados: xs.filter((x) => !x.existente).length, actualizados: xs.filter((x) => x.existente).length, pasillos: nuevas.length, archivados, quitados }
}

/** Deshacer de "Reemplazar mi lista": vuelve a activar lo archivado y a poner en la compra lo que se quitó. */
export async function deshacerReemplazo(archivados: Producto[], quitados: Detalle[]) {
  if (archivados.length) await guardar('Productos', archivados.map((p) => ({ ...p, activo: true })))
  for (const d of quitados) await restaurarDetalle(d)
}
