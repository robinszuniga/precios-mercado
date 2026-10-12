import Dexie, { type EntityTable } from 'dexie'
import type {
  Categoria, Compra, Detalle, FilaConfig, NombreTabla, PrecioActual, PrecioHistorico, Presentacion, Producto, ResumenTienda,
} from '@shared/esquema.ts'
import type { CambioPrecio } from '@shared/novedades.ts'

export interface EntradaOutbox {
  seq?: number
  tipo: 'upsert' | 'cerrarCompra'
  payload: Record<string, unknown>
  intentos: number
  /** ms desde epoch: no reintentar antes. */
  proximo: number
  error?: string
  creado: number
}

export interface Rechazo {
  id?: number
  tabla: string
  filaId: string
  mensaje: string
  fecha: number
  /** Lo que no se aceptó, por si hay que recuperarlo a mano. */
  payload?: Record<string, unknown>
}

export interface Meta {
  clave: string
  valor: unknown
}

/** Copia local de todo: la app funciona sin señal y el Sheet es el respaldo. */
export class BaseLocal extends Dexie {
  config!: EntityTable<FilaConfig, 'clave'>
  categorias!: EntityTable<Categoria, 'categoria_id'>
  productos!: EntityTable<Producto, 'producto_id'>
  presentaciones!: EntityTable<Presentacion, 'presentacion_id'>
  preciosActuales!: EntityTable<PrecioActual, 'clave'>
  compras!: EntityTable<Compra, 'compra_id'>
  detalle!: EntityTable<Detalle, 'detalle_id'>
  resumen!: EntityTable<ResumenTienda, 'clave'>
  historial!: EntityTable<PrecioHistorico, 'precio_id'>
  outbox!: EntityTable<EntradaOutbox, 'seq'>
  rechazados!: EntityTable<Rechazo, 'id'>
  meta!: EntityTable<Meta, 'clave'>
  /** Cambios de precio que llegaron del servidor: para "Novedades". Solo en este celular. */
  cambios!: EntityTable<CambioPrecio, 'id'>

  constructor(nombre = 'precios-mercado') {
    super(nombre)
    this.version(1).stores({
      config: 'clave',
      categorias: 'categoria_id',
      productos: 'producto_id',
      presentaciones: 'presentacion_id, producto_id',
      preciosActuales: 'clave, presentacion_id',
      compras: 'compra_id, estado',
      detalle: 'detalle_id, compra_id',
      resumen: 'clave, compra_id',
      historial: 'precio_id, presentacion_id',
      outbox: '++seq',
      rechazados: '++id',
      meta: 'clave',
    })
    this.version(2).stores({ cambios: '++id, fecha' })
  }
}

/** La cuenta determina el nombre de IndexedDB: un cierre o cambio de cuenta no mezcla datos locales. */
export let db = new BaseLocal()
/** Cuenta dueña de `db` (null = base sin cuenta). */
export let propietarioDb: string | null = null

/**
 * Cuenta de la sesión: sube cada vez que se cierra o cambia la cuenta. Una operación larga (sincronizar, buscar precios)
 * la guarda al empezar y la revisa antes de escribir: si cambió, el resultado es de otra cuenta y se descarta.
 */
let generacionCuenta = 0

export class CuentaCambiada extends Error {
  constructor() { super('La cuenta cambió mientras se hacía la operación.') }
}

export function generacionActual(): number {
  return generacionCuenta
}

/** Marca que la cuenta ya no es la misma. Llamar apenas empieza un cierre o cambio de cuenta, antes de cerrar IndexedDB. */
export function invalidarCuenta() {
  generacionCuenta++
}

export function exigirCuenta(generacion: number) {
  if (generacion !== generacionCuenta) throw new CuentaCambiada()
}

export function usarBaseLocal(userId: string | null) {
  invalidarCuenta()
  propietarioDb = userId
  // UUID de Supabase; el nombre no contiene correo, nombre ni otro dato personal.
  db = new BaseLocal(userId ? `precios-mercado-${userId}` : 'precios-mercado')
}

/** Pestaña del Sheet → tabla local. */
export const TABLA_LOCAL: Partial<Record<NombreTabla, keyof BaseLocal & string>> = {
  Config: 'config',
  Categorias: 'categorias',
  Productos: 'productos',
  Presentaciones: 'presentaciones',
  Precios_actuales: 'preciosActuales',
  Precios: 'historial',
  Compras: 'compras',
  Compras_detalle: 'detalle',
  Compras_resumen: 'resumen',
}

export async function leerMeta<T>(clave: string, porDefecto: T, base: BaseLocal = db): Promise<T> {
  const m = await base.meta.get(clave)
  return m ? (m.valor as T) : porDefecto
}

export async function guardarMeta(clave: string, valor: unknown, base: BaseLocal = db) {
  await base.meta.put({ clave, valor })
}

/**
 * Lo que cuelga de un producto eliminado dentro de un envío pendiente: sus presentaciones y, de ellas, los precios.
 * `presentaciones` son los ids de las presentaciones que se van; las nuevas que solo existen en la cola se suman solas.
 */
function cuelgaDeEliminado(tabla: string, fila: Record<string, unknown>, productos: ReadonlySet<string>, presentaciones: Set<string>): boolean {
  if (tabla === 'Presentaciones') {
    if (!productos.has(String(fila.producto_id))) return false
    presentaciones.add(String(fila.presentacion_id))
    return true
  }
  return (tabla === 'Observaciones' || tabla === 'Precios_actuales' || tabla === 'Precios') && presentaciones.has(String(fila.presentacion_id))
}

/**
 * Saca de un envío (de la cola o de los rechazados) lo que depende de productos eliminados. Devuelve el payload sin eso,
 * o `null` si no queda nada que enviar. Si no había nada que sacar devuelve el mismo objeto (para saber que no cambió).
 */
export function sinLoEliminado(tipo: string, payload: Record<string, unknown>, productos: ReadonlySet<string>, presentaciones: Set<string>): Record<string, unknown> | null {
  if (tipo === 'upsert') {
    const cambios = (payload.cambios ?? []) as { tabla: string; fila: Record<string, unknown> }[]
    // Las presentaciones primero: así se conocen sus ids antes de mirar sus precios, vengan en el orden que vengan.
    for (const c of cambios) if (c.tabla === 'Presentaciones') cuelgaDeEliminado(c.tabla, c.fila, productos, presentaciones)
    const quedan = cambios.filter((c) => !cuelgaDeEliminado(c.tabla, c.fila, productos, presentaciones))
    if (quedan.length === cambios.length) return payload
    return quedan.length ? { ...payload, cambios: quedan } : null
  }
  // Cierre de compra: la compra, sus líneas y el resumen se quedan; solo salen las observaciones y precios de lo eliminado.
  let cambio = false
  const filtrado: Record<string, unknown> = { ...payload }
  for (const campo of ['observaciones', 'preciosActuales', 'preciosHistorial']) {
    const filas = (payload[campo] ?? []) as Record<string, unknown>[]
    const quedan = filas.filter((f) => !presentaciones.has(String(f.presentacion_id)))
    if (quedan.length !== filas.length) { filtrado[campo] = quedan; cambio = true }
  }
  return cambio ? filtrado : payload
}

/**
 * Borra de este celular lo que depende de productos eliminados: sus marcas y tamaños, su precio actual, su historial de
 * precios, lo que había en "Novedades" y lo que seguía esperando en la cola de envío o en los rechazados (si no, volvería a
 * subir lo que la nube ya borró, o dejaría un aviso rojo que ya no se puede arreglar). Va dentro de la transacción de quien
 * la llama (esas tablas, y `outbox` y `rechazados`, deben estar en ella). En la nube lo hace un disparador de la base.
 */
export async function purgarDatosDeProductos(base: BaseLocal, ids: ReadonlySet<string>): Promise<void> {
  if (!ids.size) return
  const presentaciones = (await base.presentaciones.where('producto_id').anyOf([...ids]).primaryKeys()) as string[]
  const fuera = new Set(presentaciones)
  if (presentaciones.length) {
    await base.presentaciones.bulkDelete(presentaciones)
    await base.preciosActuales.where('presentacion_id').anyOf(presentaciones).delete()
    await base.historial.where('presentacion_id').anyOf(presentaciones).delete()
    const novedades = (await base.cambios.toArray()).filter((c) => fuera.has(c.presentacion_id)).map((c) => c.id!)
    if (novedades.length) await base.cambios.bulkDelete(novedades)
  }
  for (const e of await base.outbox.toArray()) {
    const quedan = sinLoEliminado(e.tipo, e.payload, ids, fuera)
    if (quedan === e.payload) continue
    if (quedan) await base.outbox.update(e.seq!, { payload: quedan })
    else await base.outbox.delete(e.seq!)
  }
  for (const r of await base.rechazados.toArray()) {
    if (!r.payload) continue
    const quedan = sinLoEliminado(r.tabla, r.payload, ids, fuera)
    if (quedan === r.payload) continue
    if (quedan) await base.rechazados.update(r.id!, { payload: quedan })
    else await base.rechazados.delete(r.id!)
  }
}
