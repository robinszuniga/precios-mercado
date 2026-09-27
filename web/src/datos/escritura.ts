import { claveActual, type Categoria, type Compra, type Detalle, type NombreTabla, type Observacion, type Presentacion, type Producto } from '@shared/esquema.ts'
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
  const lista = (Array.isArray(filas) ? filas : [filas]).map((f) => ({ ...f, updated_at: ahora }))
  await db.transaction('rw', db.table(local), db.outbox, async () => {
    await db.table(local).bulkPut(lista)
    await encolar('upsert', { cambios: lista.map((fila) => ({ tabla, fila })) })
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
    activo: true, updated_at: ahoraIso(), ...p,
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

/** Crea (o devuelve) la lista abierta, arrancando con los productos recurrentes. */
export async function asegurarCompra(tiendasHoy: Tienda[]): Promise<Compra> {
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

export async function agregarALaCompra(producto: Producto, tiendasHoy: Tienda[]) {
  const compra = await asegurarCompra(tiendasHoy)
  const ya = (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).find((d) => !d.borrado && d.producto_id === producto.producto_id)
  if (ya) return ya
  const [d] = await guardar('Compras_detalle', nuevoDetalle(compra.compra_id, { producto_id: producto.producto_id, necesidad: producto.cantidad_habitual }))
  return d
}
